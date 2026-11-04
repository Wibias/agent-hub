#!/usr/bin/env node
// Read-only Codex Stop guard: one continuation for a modifying design-with-ai
// turn missing independently checked iteration-gate evidence.
// The hook cannot authenticate a host transcript or force other hooks to comply.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProof } from "./run-iteration-gate.mjs";
import { appendStopDiagnostic } from "./stop-diagnostic-journal.mjs";
import { readTurnContext } from "./codex-turn-context.mjs";

const SKILL_PATH = /(?:^|[\\/])design-with-ai[\\/]SKILL\.md/i;
const GATE_RUN = /(?:^|[\s;"'\\/])run-iteration-gate\.mjs/i;
const MODIFY = /\b(?:improve-existing|restyle-existing|redesign-existing|build-product-surface|verbesser(?:e|n|ung|t)?|überarbeit(?:e|en|ung)|optimier(?:e|en|ung)|redesign|rework|restyle|polish|implement|make .{0,35}better|fix .{0,35}(?:ui|design)|update .{0,35}(?:ui|design)|improve .{0,35}(?:ui|design))\b/i;
const EXPLICIT = /design-with-ai|design with ai/i;
const EXEC_TOOL = /exec|shell|command|terminal|powershell|bash|functions\.exec/i;
const ARG = /(?:^|\s)--(receipt|baseline|proof|check-proof)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;
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

export function decideStop(event, report, { home = homedir() } = {}) {
  const allow = (reason, proofStatus = "NOT_CHECKED") => ({ continue: true, status: reason, proofStatus });
  if (!obj(event) || event.hook_event_name !== "Stop" ||
      typeof event.cwd !== "string" || typeof event.turn_id !== "string") return allow("INVALID_EVENT");
  if (!report.userBoundary) return allow("NO_TURN_BOUNDARY");
  const prompt = report.userPrompt || "";
  const modifying = report.modifying === true || (MODIFY.test(prompt) && !/^\s*(?:audit-surface|motion-audit|motion-review)\b/i.test(prompt));
  if (!modifying) return allow("READ_ONLY_OR_OUT_OF_SCOPE");
  if (!report.explicit && !EXPLICIT.test(prompt) && !report.readsSkill) return allow("SKILL_NOT_OBSERVED");
  const cwd = resolve(event.cwd);
  let proofStatus = report.gateCommands.length ? "NO_VALID_PROOF" : "NO_GATE_COMMAND";
  for (const options of [...report.gateCommands].reverse()) {
    const raw = [options.receipt, options.baseline, options.proof].filter(Boolean);
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
        receipt: options.receipt, baseline: options.baseline ?? null, checkProof: options.proof,
      });
    } catch {
      proofStatus = "PROOF_INVALID_OR_STALE";
      continue;
    }
    if (!checked.valid) {
      proofStatus = "PROOF_INVALID_OR_STALE";
      continue;
    }
    if (checked.processExitCode !== 0) {
      proofStatus = "VALIDATOR_NONZERO";
      continue;
    }
    if (checked.completionEligible) return allow("VERIFIED_COMPLETE", "VERIFIED_COMPLETE");
    if (["PARTIAL", "NOT_VERIFIED"].includes(checked.verdict) &&
        new RegExp("\\b" + checked.verdict + "\\b", "i").test(event.last_assistant_message ?? "")) {
      return allow("VERIFIED_INCOMPLETE", "VERIFIED_INCOMPLETE");
    }
    proofStatus = "INCOMPLETE_NOT_DISCLOSED";
  }
  if (event.stop_hook_active === true) {
    return {
      continue: true,
      status: "RETRY_LIMIT_NOT_VERIFIED",
      proofStatus,
      systemMessage: "design-with-ai: no valid gate proof after the single automatic retry. The result remains NOT_VERIFIED; do not treat a completion claim as tested.",
    };
  }
  return {
    decision: "block",
    status: "MISSING_VERIFIED_GATE_PROOF",
    proofStatus,
    reason: "The current modifying design-with-ai turn has no verified iteration-gate proof. " +
      "Before finishing, write the iteration receipt and independent pre-edit baseline (if applicable), " +
      "run scripts/run-iteration-gate.mjs with --receipt, --baseline (if applicable), and a new --proof path. " +
      "Check the proof with --check-proof and report the actual exit code. Do not invent a missing baseline. " +
      "If the work cannot be fully verified, use a truthful PARTIAL or NOT_VERIFIED receipt and final verdict. " +
      "Do not repeat unrelated UI edits. This hook allows only one automatic continuation.",
  };
}

export async function handleStop(event, { onDiagnostic, turnRoot } = {}) {
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
      result = decideStop(event, report);
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
      result = decideStop(event, report);
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
