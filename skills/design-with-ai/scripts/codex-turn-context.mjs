#!/usr/bin/env node
// Host-native turn context for the design-with-ai Stop hook.
// UserPromptSubmit and PostToolUse have stable turn_id fields even when
// transcript_path is null. No prompt, command or tool output is persisted.
import { createHash } from "node:crypto";
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PATH_RE = /(?:^|[\\/])design-with-ai[\\/]SKILL\.md/i;
const MODIFY = /\b(?:improve-existing|restyle-existing|redesign-existing|build-product-surface|verbesser(?:e|n|ung|t)?|überarbeit(?:e|en|ung)|optimier(?:e|en|ung)|redesign|rework|restyle|polish|implement|make .{0,35}better|fix .{0,35}(?:ui|design)|update .{0,35}(?:ui|design)|improve .{0,35}(?:ui|design))\b/i;
const EXPLICIT = /design-with-ai|design with ai/i;
const ARG = /(?:^|\s)--(receipt|baseline|proof|check-proof)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;
const MAX_FILE = 48 * 1024;
const MAX_INPUT = 128 * 1024;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const token = (v) => typeof v === "string" && v.length > 0 && v.length <= 512;
const sha = (v) => createHash("sha256").update(v).digest("hex");

export function classifyPrompt(prompt) {
  const value = typeof prompt === "string" ? prompt : "";
  return {
    modifying: MODIFY.test(value) && !/^\s*(?:audit-surface|motion-audit|motion-review)\b/i.test(value),
    explicit: EXPLICIT.test(value),
  };
}
function commandText(payload) {
  const v = payload?.tool_input;
  if (typeof v === "string") return v;
  if (!obj(v)) return "";
  const command = v.command ?? v.cmd ?? v.script ?? "";
  if (Array.isArray(command)) {
    const first = String(command[0] ?? "");
    if (/^(?:bash|sh|pwsh|powershell)(?:\.exe)?$/i.test(first)) {
      return String(command.at(-1) ?? "");
    }
    return command.map(String).join(" ");
  }
  return typeof command === "string" ? command : "";
}
function gateOptions(command) {
  // Don't classify grep, echo, or arbitrary strings containing the filename
  // as an executed validator. Proof and original input hashes are checked at Stop.
  if (!/(?:^|[;&\n])\s*(?:(?:bash|sh)\s+-lc\s+["'])?\s*(?:&\s*)?node(?:\.exe)?\s+(?:"[^"]*run-iteration-gate\.mjs"|[^\s;"']*run-iteration-gate\.mjs)/i.test(command)) return null;
  const values = new Map();
  for (const match of command.matchAll(ARG)) {
    if (values.has(match[1])) return null;
    values.set(match[1], match[2] ?? match[3] ?? match[4]);
  }
  if (!values.has("receipt") || !values.has("proof") || values.has("check-proof")) return null;
  const options = Object.fromEntries(values);
  if (Object.values(options).some(x => typeof x !== "string" || x.length > 2048)) return null;
  return options;
}
function statePath(event, root) {
  if (!token(event?.session_id) || !token(event?.turn_id) ||
      typeof event.cwd !== "string" || !event.cwd.length) return null;
  const digest = sha(event.session_id + "\0" + event.turn_id + "\0" + resolve(event.cwd).toLowerCase());
  return join(resolve(root), digest + ".jsonl");
}
function safeFile(path) {
  if (!existsSync(path)) return true;
  const st = lstatSync(path);
  return !st.isSymbolicLink() && st.isFile();
}
function cleanup(dir, now) {
  // Best-effort, bounded cleanup of stale internal files; do not traverse.
  try {
    const files = readdirSync(dir).filter(s => /^[a-f0-9]{64}\.jsonl$/.test(s));
    for (const name of files.slice(0, 200)) {
      const file = join(dir, name);
      if (safeFile(file) && existsSync(file) &&
          now - statSync(file).mtimeMs > MAX_AGE_MS) rmSync(file, { force: true });
    }
  } catch { /* never stop user work for cleanup */ }
}

export function recordTurnHook(event, {
  root = join(homedir(), ".codex", "design-with-ai", "turns"),
  now = Date.now(),
} = {}) {
  if (!obj(event) || !["UserPromptSubmit", "PostToolUse"].includes(event.hook_event_name)) {
    return { recorded: false, cause: "IGNORED_EVENT" };
  }
  const target = statePath(event, root);
  if (!target) return { recorded: false, cause: "INVALID_IDENTITY" };
  try {
    const dir = resolve(root);
    if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() ||
        !lstatSync(dir).isDirectory())) return { recorded: false, cause: "UNSAFE_DIRECTORY" };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!safeFile(target)) return { recorded: false, cause: "UNSAFE_FILE" };

    let entry;
    if (event.hook_event_name === "UserPromptSubmit") {
      entry = { kind: "prompt", at: new Date(now).toISOString(), ...classifyPrompt(event.prompt) };
      // Start the current turn fresh: never reuse a previous prompt or gate.
      writeFileSync(target, JSON.stringify(entry) + "\n", { mode: 0o600, flag: "w" });
      cleanup(dir, now);
      return { recorded: true, cause: "PROMPT_CONTEXT" };
    }
    const command = commandText(event);
    if (PATH_RE.test(command)) entry = { kind: "skill" };
    const proof = event.tool_name === "Bash" ? gateOptions(command) : null;
    if (proof) {
      // The runner resolves relative input paths against the process cwd.
      // Store that same absolute interpretation for the Stop-side proof check.
      const options = Object.fromEntries(Object.entries(proof).map(([key, value]) =>
        [key, isAbsolute(value) ? value : resolve(event.cwd, value)]));
      entry = { kind: "gate", options };
    }
    if (!entry || !existsSync(target)) return { recorded: false, cause: "NOT_RELEVANT" };
    if (statSync(target).size > MAX_FILE) return { recorded: false, cause: "SIZE_LIMIT" };
    appendFileSync(target, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
    return { recorded: true, cause: entry.kind === "gate" ? "GATE_CANDIDATE" : "SKILL_CANDIDATE" };
  } catch {
    return { recorded: false, cause: "IO_ERROR" };
  }
}

export function readTurnContext(event, {
  root = join(homedir(), ".codex", "design-with-ai", "turns"),
  now = Date.now(),
} = {}) {
  const target = statePath(event, root);
  if (!target || !safeFile(target) || !existsSync(target)) return null;
  try {
    const st = statSync(target);
    if (!st.isFile() || st.size > MAX_FILE ||
        now - st.mtimeMs > MAX_AGE_MS || st.mtimeMs - now > 60000) return null;
    const lines = readFileSync(target, "utf8").trimEnd().split("\n");
    const parsed = lines.map(x => JSON.parse(x));
    if (parsed[0]?.kind !== "prompt" || typeof parsed[0].modifying !== "boolean" ||
        typeof parsed[0].explicit !== "boolean") return null;
    const gateCommands = parsed.filter(x => x.kind === "gate" && obj(x.options))
      .slice(-8).map(x => x.options);
    return {
      userBoundary: true, userPrompt: "", promptAt: parsed[0].at, modifying: parsed[0].modifying,
      explicit: parsed[0].explicit,
      readsSkill: parsed.some(x => x.kind === "skill"),
      gateCommands, confidence: "NATIVE_TURN_EVENTS",
    };
  } catch { return null; }
}

async function main() {
  try {
    let raw = "";
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > MAX_INPUT) throw new Error("Too much hook input");
    }
    recordTurnHook(JSON.parse(raw));
  } catch { /* fail open; never report a tool hook failure for diagnostic state */ }
  // Successful empty stdout is supported by both UserPromptSubmit and
  // PostToolUse. Do not send unsupported continuation fields to tool hooks.
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
