#!/usr/bin/env node
// An actionable, platform-neutral DWA next-step controller.
// This decides what the executing agent must DO next. It does not edit the
// target, authenticate pixels, invent source evidence, or launch unapproved tools.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProof } from "./run-iteration-gate.mjs";

const open = new Set(["PERSISTS", "REGRESSED", "IMPROVED_BUT_OPEN", "UNVERIFIED", "DEFERRED"]);
const observedStates = new Set(["PERSISTS", "REGRESSED", "IMPROVED_BUT_OPEN"]);
const priority = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const filled = x => typeof x === "string" && x.trim().length > 0;
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const items = x => Array.isArray(x) ? x : [];
const validAction = new Set(["REPAIR_SOURCE", "VERIFY_CURRENT", "RERENDER", "RUN_GATES"]);

function isObserved(id, receipt, manifest) {
  return items(receipt.currentVisualObservations).some(x => x?.findingId === id && x?.observed === true) ||
    items(receipt.visualCarryoverReviews).some(x => x?.findingId === id && x?.status === "OBSERVED") ||
    items(receipt.findings).some(x => x?.id === id && x.reassessment?.observed === true) ||
    items(manifest?.captures).some(c =>
      Object.entries(c?.renderInspection?.findingRefs ?? {}).some(([flag, ref]) =>
        ref === id && c.renderInspection[flag] === true));
}
function blockedAction(id, receipt) {
  return items(receipt.persistentRepairActions).find(x =>
    x?.findingId === id && x.action === "BLOCKED" &&
    filled(x.blocker) && filled(x.nextStep) && filled(x.evidenceRef));
}
function recentUnverifiedBlock(id, receipt) {
  return items(receipt.visualCarryoverReviews).find(x =>
    x?.findingId === id && x?.status === "NOT_VERIFIED" &&
    filled(x.reason) && filled(x.evidenceRef) && filled(x.nextStep));
}
function passesFor(id, attempts) {
  return attempts.filter(x => x.findingId === id);
}
function next(phase, finding, why, extra = {}) {
  return {
    outcome: "CONTINUE", action: phase,
    findingId: finding?.id ?? null,
    acceptance: finding?.acceptance ?? null,
    reason: why,
    ...extra,
  };
}

/**
 * Pure decision function. The agent executes the action, appends an honest
 * attempt and re-invokes this function after re-render/testing; the function
 * does not replace Codex or any other host agent.
 *
 * Each attempt is {findingId, action, sourceBefore, sourceAfter,
 * renderBefore, renderAfter, result}, where result is PASS|REVISE|BLOCKED.
 * Source/render identities are actual evidence fingerprints, not fabricated.
 * The history is advisory for boundedness, never a proof of source repair.
 */
export function decideRepairLoop(receipt, baseline, {
  attempts = [], manifest = null, checkedProof = null, maxCycles = 8,
} = {}) {
  if (!object(receipt) || !Array.isArray(receipt.findings) ||
      !object(baseline) || !Array.isArray(baseline.findings) ||
      !Array.isArray(attempts) || !Number.isInteger(maxCycles) ||
      maxCycles < 1 || maxCycles > 32 ||
      attempts.some(a => !object(a) || !filled(a.findingId) ||
        !validAction.has(a.action) || !["PASS", "REVISE", "BLOCKED"].includes(a.result))) {
    return { outcome: "INVALID", reason: "Need actual receipt, frozen baseline, and structured bounded attempts" };
  }
  if (baseline.intent !== "IMPROVE") {
    return { outcome: "OUT_OF_SCOPE", reason: "Only authorized improve-existing runs use the automatic repair loop" };
  }
  if (receipt.iterationVerdict === "COMPLETE" && checkedProof?.completionEligible === true) {
    return { outcome: "COMPLETE", reason: "All required product gates passed with a verified final proof" };
  }
  if (attempts.length >= maxCycles) {
    return { outcome: "STOP_LIMIT", reason: "Bounded repair budget exhausted; report remaining work as PARTIAL, never COMPLETE",
      attempts: attempts.length };
  }
  const old = new Map(baseline.findings.map((x, i) => [x.id, { ...x, order: i }]));
  const issues = receipt.findings.filter(f => object(f) && filled(f.id) &&
    open.has(f.disposition));
  const ranked = issues.map((f, i) => {
    const prev = old.get(f.id);
    return { ...f, severity: priority[prev?.priority ?? f.priority] ?? 2,
      order: prev?.order ?? baseline.findings.length + i,
      seen: isObserved(f.id, receipt, manifest) };
  }).sort((a, b) => a.severity - b.severity || Number(b.seen) - Number(a.seen) || a.order - b.order);

  const pending = [];
  for (const issue of ranked) {
    if (blockedAction(issue.id, receipt)) continue;
    if (!issue.seen && recentUnverifiedBlock(issue.id, receipt)) continue;
    pending.push(issue);
  }
  if (!pending.length && ranked.length > 0) {
    return { outcome: "STOP_BLOCKED", reason: "Every open finding has a documented current blocker or inaccessible evidence",
      remaining: ranked.map(f => f.id) };
  }

  // Do not silently move to another feature while an attempted fix lacks a
  // matched rerender, or the current render has introduced a fresh regression.
  for (const issue of pending) {
    const history = passesFor(issue.id, attempts);
    const last = history.at(-1);
    if (last?.action === "REPAIR_SOURCE" && last.result !== "BLOCKED" &&
        (!filled(last.renderAfter) || last.renderAfter === last.renderBefore)) {
      return next("RERENDER", issue, "Source was edited but no distinct, current post-edit render was recorded",
        { verifyAtSameViewport: true });
    }
    const repairs = history.filter(a => a.action === "REPAIR_SOURCE");
    if (repairs.length >= 2) {
      const [before, after] = repairs.slice(-2);
      if (filled(after.sourceAfter) && filled(after.renderAfter) &&
          after.sourceAfter === before.sourceAfter &&
          after.renderAfter === before.renderAfter &&
          after.result === "REVISE" && before.result === "REVISE") {
        return { outcome: "STOP_STALLED", findingId: issue.id,
          reason: "Two consecutive unsuccessful source/render identities: do not loop without a new diagnosis; report PARTIAL and inspect the actual blocker" };
      }
    }
  }

  if (pending.length) {
    const issue = pending[0];
    if (!issue.seen || !observedStates.has(issue.disposition)) {
      return next("VERIFY_CURRENT", issue,
        "Inspect existing screenshots or capture the actual current UI state before editing; unavailable evidence must be recorded, not guessed",
        { inspectExistingEvidenceFirst: true });
    }
    return next("REPAIR_SOURCE", issue,
      "Confirmed open defect has priority over new features: inspect source, make the smallest authorized repair, build/test and rerender the identical state",
      { requireMatchedBeforeAfter: true });
  }
  if (receipt.iterationVerdict === "COMPLETE" && checkedProof?.completionEligible !== true) {
    return next("RUN_GATES", null, "Claimed COMPLETE still requires a real, fresh final gate proof");
  }
  return next("RUN_GATES", null,
    "No repairable visual defects remain in the submitted evidence; finish functional, visual, source and release acceptance without inventing missing coverage");
}

function cli(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--(?:receipt|baseline|attempts|render-evidence|proof|ledger|source-root)$/.test(argv[i]) ||
        !filled(argv[i + 1]) || args.has(argv[i])) throw new Error("Invalid or duplicate option");
    args.set(argv[i], resolve(argv[i + 1]));
  }
  if (!args.has("--receipt") || !args.has("--baseline")) {
    throw new Error("Usage: repair-loop-controller.mjs --receipt <json> --baseline <json> [--attempts <json>] [--render-evidence <json>] [--proof <json> --ledger <json> --source-root <dir>]");
  }
  const load = k => args.has(k) ? JSON.parse(readFileSync(args.get(k), "utf8")) : null;
  let proof = null;
  if (args.has("--proof")) {
    try {
      proof = checkProof({
        receipt: args.get("--receipt"), baseline: args.get("--baseline"),
        ledger: args.get("--ledger") ?? null,
        renderEvidence: args.get("--render-evidence") ?? null,
        sourceRoot: args.get("--source-root") ?? null,
        checkProof: args.get("--proof"),
      });
    } catch { proof = { valid: false, completionEligible: false }; }
  }
  const history = load("--attempts");
  const result = decideRepairLoop(load("--receipt"), load("--baseline"), {
    attempts: Array.isArray(history) ? history : history?.attempts ?? [],
    manifest: load("--render-evidence"), checkedProof: proof,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.outcome === "INVALID") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write("DWA repair controller: " + error.message + "\n");
    process.exitCode = 2;
  }
}
