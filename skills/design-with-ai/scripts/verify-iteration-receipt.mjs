#!/usr/bin/env node
// Checks internal consistency of a design iteration handoff. It cannot authenticate
// screenshots, source claims, or real behavior; the human/render review remains required.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dispositions = new Set([
  "RESOLVED", "IMPROVED_BUT_OPEN", "PERSISTS", "REGRESSED",
  "KEEP_JUSTIFIED", "DEFERRED", "UNVERIFIED",
]);
const closed = new Set(["RESOLVED", "KEEP_JUSTIFIED"]);
const verdicts = new Set(["COMPLETE", "PARTIAL", "NOT_VERIFIED"]);
const semanticVerdicts = new Set(["PASS", "REVISE", "NOT_VERIFIED"]);
const semanticKinds = ["phase", "filter", "count", "readiness", "action"];
const interactionKinds = new Set(["filter", "count", "readiness", "action"]);
const reliableMethods = new Set(["RUNTIME", "TEST"]);
const populated = (v) => typeof v === "string" && v.trim().length > 0;
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function matchedCandidate(before, after) {
  return ["route", "viewport", "stateKey", "dataKey"].every(
    (key) => populated(before?.[key]) && before[key] === after?.[key],
  );
}

// A separate pre-edit baseline is supplied by the task/previous review.
 // It is intentionally not sourced from the post-edit receipt being judged.
export function validateIterationReceipt(input, baseline = null) {
  const problems = [];
  const fail = (message) => problems.push(message);
  if (!record(input) || input.schemaVersion !== 1) {
    return { valid: false, verdict: null, problems: ["Expected schemaVersion: 1 receipt object"] };
  }

  const scope = Array.isArray(input.scope) ? input.scope : [];
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const carryover = Array.isArray(input.openCarryover) ? input.openCarryover : [];
  if (scope.length === 0) fail("scope must list at least one route or component");
  if (!Array.isArray(input.findings)) fail("findings must be an array");
  if (!Array.isArray(input.openCarryover)) fail("openCarryover must be an array");
  if (!verdicts.has(input.iterationVerdict)) fail("iterationVerdict must be COMPLETE, PARTIAL or NOT_VERIFIED");

  const scoped = new Set();
  for (const item of scope) {
    if (!record(item) || !populated(item.route)) {
      fail("every scope entry requires a nonempty route"); continue;
    }
    if (scoped.has(item.route)) fail("duplicate scope route: " + item.route);
    scoped.add(item.route);
    if (!populated(item.task)) fail(item.route + ": missing user task");
    if (!["INSPECTED", "DEFERRED", "NOT_INSPECTED"].includes(item.coverage)) {
      fail(item.route + ": invalid coverage");
    }
    if (item.coverage !== "INSPECTED" && !populated(item.coverageReason)) {
      fail(item.route + ": uninspected/deferred coverage requires a reason");
    }
    const semantics = item.semantics;
    if (!record(semantics) || typeof semantics.applicable !== "boolean") {
      fail(item.route + ": explicitly classify whether workflow semantics applies");
      continue;
    }
    if (!semantics.applicable) {
      if (!populated(semantics.reason)) fail(item.route + ": non-applicable semantics needs rationale");
      continue;
    }
    if (!semanticVerdicts.has(semantics.verdict)) fail(item.route + ": invalid semantics verdict");
    if (semantics.verdict === "PASS") {
      if (!populated(semantics.contractSource)) fail(item.route + ": PASS semantics needs a product contract source");
      const checks = Array.isArray(semantics.checks) ? semantics.checks : [];
      for (const kind of semanticKinds) {
        const matches = checks.filter((check) => record(check) && check.kind === kind);
        if (matches.length !== 1) {
          fail(item.route + ": PASS semantics needs exactly one " + kind + " check");
          continue;
        }
        const check = matches[0];
        if (check.result !== "PASS" || !populated(check.evidenceRef)) {
          fail(item.route + ": PASS " + kind + " requires passing evidence");
        }
        if (interactionKinds.has(kind) && !reliableMethods.has(check.method)) {
          fail(item.route + ": " + kind + " requires RUNTIME/TEST evidence, not a screenshot-only claim");
        }
      }
      const states = Array.isArray(semantics.testedStates) ? semantics.testedStates : [];
      if (states.length < 2 || states.some((v) => !populated(v))) {
        fail(item.route + ": PASS semantics needs at least two named representative states");
      }
    } else if (!populated(semantics.reason)) {
      fail(item.route + ": unresolved semantics needs a concrete reason");
    }
  }

  const seenFindings = new Set();
  const open = new Set();
  for (const item of findings) {
    if (!record(item) || !populated(item.id)) { fail("finding requires a stable id"); continue; }
    if (seenFindings.has(item.id)) fail("duplicate finding id: " + item.id);
    seenFindings.add(item.id);
    if (!scoped.has(item.route)) fail(item.id + ": finding route not in scope");
    for (const field of ["symptom", "acceptance", "decision"]) {
      if (!populated(item[field])) fail(item.id + ": missing " + field);
    }
    if (!dispositions.has(item.disposition)) {
      fail(item.id + ": invalid disposition");
      continue;
    }
    if (!closed.has(item.disposition)) open.add(item.id);
    if (item.disposition === "RESOLVED") {
      if (!record(item.before) || !record(item.after) ||
          !populated(item.before.ref) || !populated(item.after.ref) ||
          !matchedCandidate(item.before, item.after)) {
        fail(item.id + ": RESOLVED requires matched before/after route, viewport, stateKey, dataKey and evidence refs");
      }
      if (!record(item.verification) || item.verification.result !== "PASS" ||
          !populated(item.verification.evidenceRef)) {
        fail(item.id + ": RESOLVED requires a passing acceptance check with evidence");
      }
    } else if (item.disposition === "KEEP_JUSTIFIED") {
      if (!populated(item.justification) || !populated(item.after?.ref)) {
        fail(item.id + ": KEEP_JUSTIFIED needs a reason and inspected current-state reference");
      }
    } else if (!populated(item.reason)) {
      fail(item.id + ": an open/deferred finding needs a reason");
    }
  }

  if (new Set(carryover).size !== carryover.length ||
      carryover.some((id) => !populated(id))) fail("openCarryover must contain unique nonempty finding IDs");
  for (const id of open) if (!carryover.includes(id)) fail("open finding omitted from carryover: " + id);
  for (const id of carryover) if (!open.has(id)) fail("carryover references closed/unknown finding: " + id);

  if (baseline !== null) {
    const baselineIssues = Array.isArray(baseline?.findings) ? baseline.findings : [];
    const baselineScope = Array.isArray(baseline?.scope) ? baseline.scope : [];
    const intent = baseline?.intent;
    if (!record(baseline) || baseline.schemaVersion !== 1 ||
        !["IMPROVE", "RESTYLE", "SCOPED_COSMETIC"].includes(intent)) {
      fail("baseline must declare schemaVersion: 1 and a supported intent");
    }
    if (baselineScope.length === 0 || baselineScope.some((route) => !populated(route)) ||
        new Set(baselineScope).size !== baselineScope.length) {
      fail("baseline scope must contain unique nonempty in-scope routes");
    }
    const priorIds = new Set();
    const priorById = new Map();
    for (const issue of baselineIssues) {
      if (!record(issue) || !populated(issue.id)) {
        fail("baseline finding requires a stable id");
        continue;
      }
      if (priorIds.has(issue.id)) fail("duplicate baseline finding id: " + issue.id);
      priorIds.add(issue.id);
      priorById.set(issue.id, issue);
      if (!baselineScope.includes(issue.route)) fail(issue.id + ": baseline route not in baseline scope");
      if (!["HIGH", "MEDIUM", "LOW"].includes(issue.priority) ||
          !populated(issue.symptom) || !populated(issue.acceptance) ||
          !populated(issue.evidenceRef)) {
        fail(issue.id + ": baseline needs priority, symptom, acceptance and evidenceRef");
      }
      const matching = findings.filter((f) => f?.id === issue.id);
      if (matching.length !== 1) {
        fail("prior finding missing from final receipt: " + issue.id);
        continue;
      }
      const current = matching[0];
      if (current.route !== issue.route || current.acceptance !== issue.acceptance) {
        fail(issue.id + ": prior route/acceptance changed without an authorized baseline update");
      }
      if (current.disposition === "KEEP_JUSTIFIED") {
        if (!record(current.reassessment) ||
            !populated(current.reassessment.reason) ||
            !populated(current.reassessment.evidenceRef)) {
          fail(issue.id + ": a pre-existing defect cannot become KEEP_JUSTIFIED without reassessment evidence");
        }
      }
    }
    for (const route of baselineScope) {
      if (!scoped.has(route)) fail("baseline scope omitted from final receipt: " + route);
    }
    for (const item of scope) {
      if (record(item) && !baselineScope.includes(item.route)) {
        fail(item.route + ": final receipt has route outside pre-edit baseline scope");
      }
    }
    const summary = input.changeSummary;
    if (!record(summary) ||
        !["TASK_REPAIR", "COSMETIC_ONLY", "NO_CHANGE"].includes(summary.kind) ||
        !populated(summary.rationale)) {
      fail("baseline comparison requires changeSummary with kind and rationale");
    } else {
      const addressed = Array.isArray(summary.addressedFindingIds) ? summary.addressedFindingIds : [];
      if (new Set(addressed).size !== addressed.length ||
          addressed.some((id) => !populated(id) || !priorById.has(id))) {
        fail("changeSummary addressedFindingIds must be unique known baseline IDs");
      }
      if (summary.kind === "TASK_REPAIR" && addressed.length === 0) {
        fail("TASK_REPAIR must name at least one addressed prior finding");
      }
      if (summary.kind !== "TASK_REPAIR" && addressed.length > 0) {
        fail("only TASK_REPAIR may claim addressed prior findings");
      }
      if (summary.kind === "TASK_REPAIR" && !populated(summary.evidenceRef)) {
        fail("TASK_REPAIR needs actual implementation or runtime evidence");
      }
      const highOpen = baselineIssues.some((issue) => issue.priority === "HIGH" &&
        findings.some((f) => f?.id === issue.id && !closed.has(f.disposition)));
      if (intent === "IMPROVE" && summary.kind === "COSMETIC_ONLY" && highOpen) {
        fail("IMPROVE cannot substitute cosmetic-only changes for unresolved HIGH prior findings");
      }
      if (input.iterationVerdict === "COMPLETE" && summary.kind === "COSMETIC_ONLY" &&
          intent === "IMPROVE" && baselineIssues.length > 0) {
        fail("IMPROVE cannot claim prior finding closure from cosmetic changes alone");
      }
    }
  }

  if (input.iterationVerdict === "COMPLETE") {
    for (const item of scope) {
      if (!record(item)) continue;
      if (item.coverage !== "INSPECTED") fail(item.route + ": COMPLETE cannot include uninspected/deferred scope");
      if (!findings.some((f) => f.route === item.route)) {
        fail(item.route + ": COMPLETE requires at least one disposition (including KEEP_JUSTIFIED)");
      }
      if (item.semantics?.applicable && item.semantics.verdict !== "PASS") {
        fail(item.route + ": COMPLETE cannot claim unverified/failed workflow semantics");
      }
    }
    for (const id of open) fail("COMPLETE cannot include open finding: " + id);
    if (!record(input.gates) || !["PASS"].every((v) =>
      input.gates.render === v && input.gates.functional === v)) {
      fail("COMPLETE requires passing functional and rendered checks");
    }
  } else if (!populated(input.verdictReason)) {
    fail("PARTIAL/NOT_VERIFIED requires verdictReason");
  }

  return {
    valid: problems.length === 0,
    verdict: input.iterationVerdict ?? null,
    inScope: scope.length,
    findings: findings.length,
    openCarryover: [...open],
    problems,
    baselineChecked: baseline !== null,
    limitation: "This checks receipt consistency, not the authenticity or accuracy of cited evidence.",
  };
}

function main(argv) {
  const args = argv.slice(2);
  const hasBaseline = args.length === 4 && args[0] === "--receipt" && args[2] === "--baseline";
  const standalone = args.length === 2 && args[0] === "--receipt";
  if (!hasBaseline && !standalone) {
    process.stderr.write("Usage: node verify-iteration-receipt.mjs --receipt <receipt.json> [--baseline <pre-edit-findings.json>]\n");
    process.exitCode = 2;
    return;
  }
  try {
    const data = JSON.parse(readFileSync(resolve(args[1]), "utf8"));
    const baseline = hasBaseline ? JSON.parse(readFileSync(resolve(args[3]), "utf8")) : null;
    if (data.requiresPriorBaseline === true && !hasBaseline) {
      process.stderr.write("This iterative receipt requires --baseline from the pre-edit review\n");
      process.exitCode = 2;
      return;
    }
    const result = validateIterationReceipt(data, baseline);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write("Cannot validate receipt: " + error.message + "\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
