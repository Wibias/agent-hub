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
function getCommand(payload) {
  let args = payload?.arguments ?? payload?.input ?? payload?.command ?? "";
  if (obj(args)) return String(args.command ?? args.cmd ?? args.script ?? "");
  if (typeof args !== "string") return "";
  try {
    const json = JSON.parse(args);
    if (obj(json)) return String(json.command ?? json.cmd ?? json.script ?? "");
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
  const allow = (reason) => ({ continue: true, status: reason });
  if (!obj(event) || event.hook_event_name !== "Stop" ||
      typeof event.cwd !== "string" || typeof event.turn_id !== "string") return allow("INVALID_EVENT");
  if (event.stop_hook_active === true) return allow("RETRY_LIMIT");
  if (!report.userBoundary) return allow("NO_TURN_BOUNDARY");
  const prompt = report.userPrompt || "";
  const modifying = MODIFY.test(prompt) && !/^\s*(?:audit-surface|motion-audit|motion-review)\b/i.test(prompt);
  if (!modifying) return allow("READ_ONLY_OR_OUT_OF_SCOPE");
  if (!EXPLICIT.test(prompt) && !report.readsSkill) return allow("SKILL_NOT_OBSERVED");
  const cwd = resolve(event.cwd);
  for (const options of [...report.gateCommands].reverse()) {
    const raw = [options.receipt, options.baseline, options.proof].filter(Boolean);
    if (!raw.every((path) => localAllowed(path, cwd, home))) continue;
    if (!isValidArtifact(options.proof)) continue;
    let checked;
    try {
      checked = checkProof({
        receipt: options.receipt, baseline: options.baseline ?? null, checkProof: options.proof,
      });
    } catch { continue; }
    // A structurally coherent proof of a validator failure is not a passing
    // PARTIAL gate. Require the actual validator process to have exited 0.
    if (!checked.valid || checked.processExitCode !== 0) continue;
    if (checked.completionEligible) return allow("VERIFIED_COMPLETE");
    if (["PARTIAL", "NOT_VERIFIED"].includes(checked.verdict) &&
        new RegExp("\\b" + checked.verdict + "\\b", "i").test(event.last_assistant_message ?? "")) {
      return allow("VERIFIED_INCOMPLETE");
    }
  }
  return {
    decision: "block",
    reason: "The current modifying design-with-ai turn has no verified iteration-gate proof. " +
      "Before finishing, write the iteration receipt and independent pre-edit baseline (if applicable), " +
      "run scripts/run-iteration-gate.mjs with --receipt, --baseline (if applicable), and a new --proof path. " +
      "Check the proof with --check-proof and report the actual exit code. Do not invent a missing baseline. " +
      "If the work cannot be fully verified, use a truthful PARTIAL or NOT_VERIFIED receipt and final verdict. " +
      "Do not repeat unrelated UI edits. This hook allows only one automatic continuation.",
  };
}

export async function handleStop(event) {
  if (!obj(event) || event.hook_event_name !== "Stop" || event.stop_hook_active === true) {
    return { continue: true };
  }
  const path = event.transcript_path;
  if (typeof path !== "string" || !isAbsolute(path) ||
      !localAllowed(path, resolve(event.cwd || process.cwd()), homedir())) return { continue: true };
  try { return decideStop(event, await inspectTurnTranscript(path)); }
  catch { return { continue: true }; }
}

async function main() {
  try {
    let input = "";
    for await (const part of process.stdin) {
      input += part;
      if (input.length > 128 * 1024) throw new Error("Stop event input too large");
    }
    const event = JSON.parse(input);
    const output = await handleStop(event);
    // Only documented Codex hook response fields are sent to stdout.
    const result = output.decision === "block"
      ? { decision: "block", reason: output.reason }
      : { continue: true };
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    // Fail open for malformed input rather than interrupting unrelated work.
    process.stdout.write('{"continue":true}\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
