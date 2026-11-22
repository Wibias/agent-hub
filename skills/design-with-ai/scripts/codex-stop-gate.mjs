#!/usr/bin/env node
// Read-only Codex Stop guard: one continuation for a modifying design-with-ai
// turn missing independently checked iteration-gate evidence.
// The hook cannot authenticate a host transcript or force other hooks to comply.
import { createReadStream, existsSync, readFileSync, statSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, resolve, sep, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProof } from "./run-iteration-gate.mjs";
import { decideRepairLoop } from "./repair-loop-controller.mjs";
import { appendStopDiagnostic } from "./stop-diagnostic-journal.mjs";
import { isGitProject, discoverProjectLedger } from "./findings-ledger.mjs";
import { discoverNativeSourceRoot } from "./project-source-snapshot.mjs";
import { readTurnContext } from "./codex-turn-context.mjs";
import { defaultNativeGateIndexRoot, listRecentNativeGateProofs } from "./native-gate-proof-index.mjs";

const SKILL_PATH = /(?:^|[\\/])design-with-ai[\\/]SKILL\.md/i;
const GATE_RUN = /(?:^|[\s;"'\\/])run-iteration-gate\.mjs/i;
const MODIFY = /\b(?:improve-existing|restyle-existing|redesign-existing|build-product-surface|verbesser(?:e|n|ung|t)?|überarbeit(?:e|en|ung)|optimier(?:e|en|ung)|redesign|rework|restyle|polish|implement|make .{0,35}better|fix .{0,35}(?:ui|design)|update .{0,35}(?:ui|design)|improve .{0,35}(?:ui|design))\b/i;
const EXPLICIT = /design-with-ai|design with ai/i;
const EXEC_TOOL = /exec|shell|command|terminal|powershell|bash|functions\.exec/i;
const ARG = /(?:^|\s)--(receipt|baseline|ledger|render-evidence|source-root|proof|check-proof)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;
const MAX_LOG_BYTES = 80 * 1024 * 1024;
const MAX_PROOF_BYTES = 128 * 1024;
const MAX_PATH_LENGTH = 2048;

const obj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const within = (path, parent) => {
  const a = process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  const b = process.platform === "win32" ? resolve(parent).toLowerCase() : resolve(parent);
  return a === b || a.startsWith(b + sep);
};
function commandValue(value) {
  if (Array.isArray(value)) return value.map((x) => String(x)).join(" ");
  if (typeof value === "string") return value;
  return "";
}
function getCommand(payload) {
  const args = payload?.arguments ?? payload?.input ?? payload?.command ?? "";
  if (obj(args)) return commandValue(args.command ?? args.cmd ?? args.script);
  if (typeof args !== "string") return "";
  try {
    const json = JSON.parse(args);
    if (obj(json)) return commandValue(json.command ?? json.cmd ?? json.script);
  } catch { /* raw shell command */ }
  return args;
}
function parseOptions(command) {
  const options = new Map();
  for (const m of command.matchAll(ARG)) {
    if (options.has(m[1])) return null;
    options.set(m[1], m[2] ?? m[3] ?? m[4]);
  }
  if (!options.has("receipt") || !options.has("proof") || options.has("check-proof")) return null;
  return Object.fromEntries(options);
}
function localAllowed(path, cwd, home) {
  if (typeof path !== "string" || !path.length || path.length > MAX_PATH_LENGTH ||
      !isAbsolute(path)) return false;
  return [cwd, home, tmpdir()].some((root) => within(path, root));
}
function isValidArtifact(path) {
  try {
    const st = statSync(path);
    return st.isFile() && st.size > 0 && st.size <= MAX_PROOF_BYTES;
  } catch { return false; }
}

/**
 * Native proof fallback for host tools that execute Node through nested
 * functions.exec JavaScript rather than a direct Bash/exec_command call.
 * Never infer successful execution from JavaScript source or stdout prose.
 * Recover only a current, locally generated, source-bound gate artifact.
 */
function nativeArtifactOptions(proofPath, cwd, home, promptAt) {
  if (typeof proofPath !== "string" || !localAllowed(proofPath, cwd, home) ||
      !/\.json$/i.test(proofPath) || !isValidArtifact(proofPath)) return null;
  let proof;
  try {
    if (lstatSync(proofPath).isSymbolicLink()) return null;
    proof = JSON.parse(readFileSync(proofPath, "utf8"));
  } catch { return null; }
  if (!obj(proof) || proof.generator !== "design-with-ai/run-iteration-gate.mjs" ||
      !obj(proof.receipt) || !obj(proof.baseline) || !obj(proof.ledger) ||
      typeof proof.sourceRoot !== "string" ||
      ![proof.receipt.path, proof.baseline.path, proof.ledger.path].every(x =>
        typeof x === "string" && x.length > 0 && isAbsolute(x)) ||
      (proof.renderEvidence && (typeof proof.renderEvidence.path !== "string" ||
        !isAbsolute(proof.renderEvidence.path)))) return null;
  const sourceRoot = resolve(proof.sourceRoot);
  if (!localAllowed(sourceRoot, cwd, home) ||
      !(within(cwd, sourceRoot) || within(sourceRoot, cwd))) return null;
  const artifacts = join(sourceRoot, ".design-with-ai");
  if (!within(proofPath, artifacts) || !within(proof.receipt.path, artifacts) ||
      !within(proof.baseline.path, artifacts) ||
      resolve(proof.ledger.path) !== join(artifacts, "findings-ledger.json")) return null;
  if (proof.renderEvidence && (!obj(proof.renderEvidence) ||
      !within(proof.renderEvidence.path, artifacts))) return null;
  try {
    if (lstatSync(artifacts).isSymbolicLink() ||
        !lstatSync(artifacts).isDirectory()) return null;
    const realDir = realpathSync(artifacts);
    for (const path of [proofPath, proof.receipt.path, proof.baseline.path,
      proof.ledger.path, proof.renderEvidence?.path].filter(Boolean)) {
      if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() ||
          !within(realpathSync(path), realDir)) return null;
    }
    if (discoverNativeSourceRoot({
      receipt: proof.receipt.path, ledger: proof.ledger.path,
    }) !== sourceRoot) return null;
  } catch { return null; }
  const started = Date.parse(promptAt);
  const executed = Date.parse(proof.executedAt);
  if (!Number.isFinite(started) || !Number.isFinite(executed) ||
      executed < started - 1000 || executed > Date.now() + 60000) return null;
  return {
    receipt: proof.receipt.path,
    baseline: proof.baseline.path,
    ledger: proof.ledger.path,
    ...(proof.renderEvidence ? { "render-evidence": proof.renderEvidence.path } : {}),
    "source-root": sourceRoot, proof: resolve(proofPath),
  };
}
function nativeProofFilesAt(root) {
  const artifacts = join(root, ".design-with-ai");
  try {
    if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory() ||
        lstatSync(artifacts).isSymbolicLink() || !lstatSync(artifacts).isDirectory() ||
        !existsSync(join(artifacts, "findings-ledger.json")) ||
        !readdirSync(root, { withFileTypes: true }).some(x =>
          x.isFile() && /\.csproj$/i.test(x.name))) return [];
    // The proof filename is only a candidate hint. checkProof() later
    // authenticates its bound source, ledger, receipt and validator.
    const entries = readdirSync(artifacts, { withFileTypes: true });
    if (entries.length > 256) return []; // fail closed on noisy artifact dirs
    return entries.filter(x => x.isFile() && /proof.*\.json$/i.test(x.name))
      .map(x => ({ path: join(artifacts, x.name),
        time: statSync(join(artifacts, x.name)).mtimeMs }))
      .sort((a, b) => b.time - a.time).slice(0, 32).map(x => x.path);
  } catch { return []; }
}
function nativeArtifactCandidates(cwd, home, promptAt, hints = [], gateIndexRoot = defaultNativeGateIndexRoot()) {
  if (!Number.isFinite(Date.parse(promptAt))) return [];
  // Explicit typed proof hints support nested functions.exec even when the
  // working directory sits above the product project. Never parse JS itself.
  const hinted = hints.filter(x => typeof x === "string").slice(-8);
  const anchored = [];
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const found = nativeProofFilesAt(dir);
    if (found.length) {
      anchored.push(...found);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Codex can start at the parent "work" folder while the native project
  // lives in its immediate child. Inspect *one* bounded directory level,
  // never recurse into the user's workspace or follow directory links.
  // A single unambiguous current project may supply proof candidates.
  const childCandidates = [];
  if (!anchored.some(x => nativeArtifactOptions(x, cwd, home, promptAt)) &&
      !within(cwd, join(home, ".codex"))) {
    try {
      const entries = readdirSync(resolve(cwd), { withFileTypes: true });
      if (entries.length <= 128) {
        const children = entries.filter(x => x.isDirectory());
        if (children.length <= 32) {
          for (const child of children) childCandidates.push(
            ...nativeProofFilesAt(join(resolve(cwd), child.name)));
        }
      }
    } catch { /* never traverse unknown or inaccessible roots */ }
  }
  const verifiedChildHints = childCandidates.map(x =>
    nativeArtifactOptions(x, cwd, home, promptAt)).filter(Boolean);
  const distinctChildRoots = new Set(verifiedChildHints.map(x => x["source-root"]));
  const fallback = distinctChildRoots.size === 1 ? verifiedChildHints.map(x => x.proof) : [];
  // A real gate writes a private proof hint without waiting for PostToolUse.
  // Unlike folder scanning this works at arbitrary project depth. Never
  // trust the index itself, and refuse ambiguous current project candidates.
  const indexed = listRecentNativeGateProofs({
    cwd, startedAt: promptAt, indexRoot: gateIndexRoot,
  }).map(x => nativeArtifactOptions(x, cwd, home, promptAt)).filter(Boolean);
  const roots = new Set(indexed.map(x => x["source-root"]));
  const registered = roots.size === 1 ? indexed.map(x => x.proof) : [];
  const unique = [...new Set([...registered, ...fallback, ...anchored, ...hinted]
    .map(x => resolve(x)))];
  // Stop evaluates candidates in reverse order: prefer explicit tool
  // outputs over scanned hints and newer artifacts over older ones.
  return unique.map(x => nativeArtifactOptions(x, cwd, home, promptAt)).filter(Boolean);
}

function latestUser(payload) {
  if (payload?.type === "user_message" && typeof payload.message === "string") return payload.message;
  if (payload?.type === "message" && payload.role === "user") {
    if (typeof payload.content === "string") return payload.content;
    if (Array.isArray(payload.content)) {
      return payload.content.filter((x) => x?.type === "input_text" || x?.type === "text")
        .map((x) => x.text ?? "").join("\n");
    }
  }
  return null;
}

export async function inspectTurnTranscript(file) {
  const report = { userPrompt: "", readsSkill: false, gateCommands: [], userBoundary: false, confidence: "NONE" };
  if (typeof file !== "string" || !existsSync(file) || statSync(file).size > MAX_LOG_BYTES) {
    return report;
  }
  for await (const line of createInterface({
    input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity,
  })) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const p = entry?.payload;
    if (entry.type === "event_msg" || entry.type === "response_item") {
      const next = latestUser(p);
      if (next !== null) {
        // Older skill mentions and gate calls cannot satisfy the latest turn.
        report.userBoundary = true;
        report.userPrompt = next;
        report.readsSkill = false;
        report.gateCommands = [];
        continue;
      }
    }
    if (entry?.type !== "response_item" ||
        !["function_call", "custom_tool_call"].includes(p?.type)) continue;
    const command = getCommand(p);
    const tool = String(p?.name ?? p?.recipient ?? "");
    if (SKILL_PATH.test(command)) report.readsSkill = true;
    if (EXEC_TOOL.test(tool) && GATE_RUN.test(command) &&
        /(?:^|[\s;"'])node(?:\.exe)?\b/i.test(command)) {
      const options = parseOptions(command);
      if (options) report.gateCommands.push(options);
    }
  }
  report.confidence = report.userBoundary ? "TURN_SCOPED" : "NO_USER_BOUNDARY";
  return report;
}

export function decideStop(event, report, { home = homedir(), gateIndexRoot = defaultNativeGateIndexRoot() } = {}) {
  const allow = (reason, proofStatus = "NOT_CHECKED") => ({ continue: true, status: reason, proofStatus });
  if (!obj(event) || event.hook_event_name !== "Stop" ||
      typeof event.cwd !== "string" || typeof event.turn_id !== "string") return allow("INVALID_EVENT");
  if (!report.userBoundary) return allow("NO_TURN_BOUNDARY");
  const prompt = report.userPrompt || "";
  const modifying = report.modifying === true || (MODIFY.test(prompt) && !/^\s*(?:audit-surface|motion-audit|motion-review)\b/i.test(prompt));
  if (!modifying) return allow("READ_ONLY_OR_OUT_OF_SCOPE");
  if (!report.explicit && !EXPLICIT.test(prompt) && !report.readsSkill) return allow("SKILL_NOT_OBSERVED");
  const cwd = resolve(event.cwd);
  const artifactOptions = nativeArtifactCandidates(cwd, home, report.promptAt,
    Array.isArray(report.proofHints) ? report.proofHints : [], gateIndexRoot);
  // Prefer the most recent artifact-backed candidate from this actual turn.
  // Direct command events remain supported for Git and legacy workflows.
  const commands = [...report.gateCommands, ...artifactOptions];
  let proofStatus = commands.length ? "NO_VALID_PROOF" : "NO_GATE_COMMAND";
  for (const options of [...commands].reverse()) {
    const sourceRoot = options["source-root"] ??
      discoverNativeSourceRoot({ receipt: options.receipt, ledger: options.ledger });
    const canonicalLedger = discoverProjectLedger(sourceRoot ?? cwd);
    const needsLedger = sourceRoot !== null || isGitProject(cwd);
    if (needsLedger && (!options.ledger ||
        (canonicalLedger && resolve(options.ledger) !== resolve(canonicalLedger)) ||
        (sourceRoot === null && !canonicalLedger))) {
      proofStatus = "NO_VALID_PROOF";
      continue;
    }
    const raw = [options.receipt, options.baseline, options.ledger, options["render-evidence"],
      sourceRoot, options.proof].filter(Boolean);
    if (!raw.every((path) => localAllowed(path, cwd, home))) {
      proofStatus = "PATH_REJECTED";
      continue;
    }
    if (!isValidArtifact(options.proof)) {
      proofStatus = "PROOF_MISSING";
      continue;
    }
    let checked;
    try {
      checked = checkProof({
        receipt: options.receipt, baseline: options.baseline ?? null,
        ledger: options.ledger ?? null, renderEvidence: options["render-evidence"] ?? null,
        sourceRoot, checkProof: options.proof, workspaceCwd: event.cwd,
      });
    } catch {
      proofStatus = "PROOF_INVALID_OR_STALE";
      continue;
    }
    if (!checked.valid) {
      // The gate returns stable, privacy-safe issue codes alongside human
      // messages. Never downgrade a changed receipt/ledger/worktree to a
      // generic "invalid proof" diagnosis.
      proofStatus = checked.issueCodes?.[0] ?? "PROOF_INVALID_OR_STALE";
      continue;
    }
    if (checked.processExitCode !== 0) {
      proofStatus = "VALIDATOR_NONZERO";
      continue;
    }
    // Native turn context prevents an older valid proof from being replayed
    // against a later design task. Legacy transcript-only runs lack this
    // timestamp and retain their previous conservative behavior.
    if (report.promptAt) {
      let finished;
      try {
        const proof = JSON.parse(readFileSync(options.proof, "utf8"));
        finished = Date.parse(proof.executedAt);
      } catch { finished = NaN; }
      const started = Date.parse(report.promptAt);
      if (!Number.isFinite(started) || !Number.isFinite(finished) ||
          finished < started - 1000) {
        proofStatus = "PROOF_TOO_OLD";
        continue;
      }
    }
    if (checked.completionEligible) return allow("VERIFIED_COMPLETE", "VERIFIED_COMPLETE");
    if (["PARTIAL", "NOT_VERIFIED"].includes(checked.verdict) &&
        new RegExp("\\b" + checked.verdict + "\\b", "i").test(event.last_assistant_message ?? "")) {
      // A valid PARTIAL proof does not end an authorized IMPROVE task with
      // actionable findings. This hook requests only ONE continuation.
      if (event.stop_hook_active !== true && options.baseline) {
        try {
          const receipt = JSON.parse(readFileSync(options.receipt, "utf8"));
          const baseline = JSON.parse(readFileSync(options.baseline, "utf8"));
          const manifest = options["render-evidence"]
            ? JSON.parse(readFileSync(options["render-evidence"], "utf8")) : null;
          const attempts = Array.isArray(receipt.repairLoop?.attempts)
            ? receipt.repairLoop.attempts : [];
          const action = decideRepairLoop(receipt, baseline, {
            attempts, manifest, checkedProof: checked,
          });
          if (action.outcome === "CONTINUE" &&
              ["VERIFY_CURRENT", "REPAIR_SOURCE", "RERENDER", "RUN_GATES"].includes(action.action)) {
            return {
              decision: "block",
              status: "ACTIONABLE_PARTIAL_CONTINUATION",
              proofStatus: "VERIFIED_INCOMPLETE",
              reason: "design-with-ai: a valid PARTIAL proof does not finish this IMPROVE request. " +
                "Execute the autonomous repair loop now: " + action.action +
                (action.findingId ? " for existing finding " + action.findingId + ". " : ". ") +
                action.reason + ". Reinspect the actual UI, repair authorized source if observed, " +
                "test and rerender the same state, then generate fresh proof. " +
                "Stop only on verified COMPLETE, real blocker, documented stall, or bounded iteration limit. " +
                "No unrelated features. This host Stop hook allows only one continuation.",
            };
          }
        } catch { /* Never infer an action from unavailable task evidence. */ }
      }
      return allow("VERIFIED_INCOMPLETE", "VERIFIED_INCOMPLETE");
    }
    proofStatus = "INCOMPLETE_NOT_DISCLOSED";
  }
  if (event.stop_hook_active === true) {
    return {
      continue: true,
      status: "RETRY_LIMIT_NOT_VERIFIED",
      proofStatus,
      systemMessage: "design-with-ai: the one automatic correction did not produce a current verified gate proof (" + proofStatus + "). The result remains NOT_VERIFIED; do not treat a completion claim as tested.",
    };
  }
  return {
    decision: "block",
    status: "MISSING_VERIFIED_GATE_PROOF",
    proofStatus,
    reason: "The current modifying design-with-ai turn has no verified iteration-gate proof (" + proofStatus + "). " +
      "Before finishing, write the iteration receipt and independent pre-edit baseline (if applicable), " +
      "initialize or locate the canonical .design-with-ai/findings-ledger.json in this project, import available earlier findings, then freeze a pre-edit snapshot. " +
      "Reconcile all old in-scope findings against the current receipt. " +
      "For a native desktop project, infer the source root from the canonical project-local ledger and C# project marker; keep the ancestor .git untouched. " +
      "Any newly observed visual anomaly requires a stable open finding in the receipt and durable ledger, including in verification-only passes. " +
      "Run scripts/run-iteration-gate.mjs with --receipt, --baseline, --ledger, and a new --proof path. " +
      "Check the proof with --check-proof, inspect issueCodes, and report the actual exit code. " +
      "If UI source, receipt, baseline or ledger changed after that proof, rerun the gate with a NEW proof path after the final edit. " +
      "Do not invent a missing baseline. " +
      "If the work cannot be fully verified, use a truthful PARTIAL or NOT_VERIFIED receipt and final verdict. " +
      "Do not repeat unrelated UI edits. This hook allows only one automatic continuation.",
  };
}

export async function handleStop(event, { onDiagnostic, turnRoot, gateIndexRoot } = {}) {
  let report = null;
  let result = { continue: true, status: "NOT_STOP" };
  let transcriptState = "NOT_CHECKED";
  try {
    if (!obj(event) || event.hook_event_name !== "Stop") return result;
    // Prefer official UserPromptSubmit/PostToolUse turn records. The Codex
    // transcript_path is explicitly nullable and its format is not stable.
    report = readTurnContext(event, turnRoot === undefined ? {} : { root: turnRoot });
    if (report) {
      transcriptState = "NATIVE_TURN_EVENTS";
      result = decideStop(event, report, gateIndexRoot ? { gateIndexRoot } : {});
      return result;
    }
    const path = event.transcript_path;
    if (typeof path !== "string" || !isAbsolute(path) ||
        !localAllowed(path, resolve(event.cwd || process.cwd()), homedir())) {
      transcriptState = "UNAVAILABLE";
      result = { continue: true, status: "TRANSCRIPT_UNAVAILABLE" };
      return result;
    }
    try {
      report = await inspectTurnTranscript(path);
      transcriptState = report.userBoundary || report.confidence === "NO_USER_BOUNDARY"
        ? "SCANNED" : "UNAVAILABLE";
      result = decideStop(event, report, gateIndexRoot ? { gateIndexRoot } : {});
      return result;
    } catch {
      transcriptState = "SCAN_ERROR";
      result = { continue: true, status: "TRANSCRIPT_SCAN_ERROR" };
      return result;
    }
  } finally {
    // Diagnostic failures must never change a Stop decision or leak content.
    if (typeof onDiagnostic === "function") {
      try { onDiagnostic({ event, report, result, transcriptState }); } catch { /* best effort */ }
    }
  }
}

async function main() {
  try {
    let input = "";
    for await (const part of process.stdin) {
      input += part;
      if (input.length > 128 * 1024) throw new Error("Stop event input too large");
    }
    const event = JSON.parse(input);
    const output = await handleStop(event, { onDiagnostic: appendStopDiagnostic });
    // Only documented Codex hook response fields are sent to stdout.
    const result = output.decision === "block"
      ? { decision: "block", reason: output.reason }
      : { continue: true, ...(output.systemMessage ? { systemMessage: output.systemMessage } : {}) };
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    // Fail open for malformed input rather than interrupting unrelated work.
    process.stdout.write('{"continue":true}\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
