#!/usr/bin/env node
// Opt-in additive Codex hook installer. Dry-run by default.
// The Stop hook cannot rely only on transcript_path: Codex permits null.
// Supporting UserPromptSubmit/PostToolUse hooks capture turn-scoped metadata.
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(import.meta.url);
const defaultSkill = resolve(dirname(file), "..");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const markers = {
  Stop: /(?:^|[\\/])codex-stop-gate\.mjs(?:"|\s|$)/i,
  UserPromptSubmit: /(?:^|[\\/])codex-turn-context\.mjs(?:"|\s|$)/i,
  PostToolUse: /(?:^|[\\/])codex-turn-context\.mjs(?:"|\s|$)/i,
};

function readConfig(path) {
  if (!existsSync(path)) return { hooks: {} };
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Refusing symlinked or non-file hooks.json: " + path);
  }
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(data) || (data.hooks !== undefined && !isObject(data.hooks))) {
    throw new Error("Existing hooks.json must be an object with an object hooks property");
  }
  return { ...data, hooks: { ...(data.hooks || {}) } };
}

function updateEvent(existing, marker, entry) {
  if (!Array.isArray(existing)) throw new Error("Hook event registry must be an array");
  const groups = [];
  for (const group of existing) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      groups.push(group);
      continue;
    }
    const remaining = group.hooks.filter((item) =>
      !marker.test(String(item?.commandWindows ?? item?.command ?? "")));
    if (remaining.length) groups.push({ ...group, hooks: remaining });
  }
  groups.push(entry);
  return groups;
}

export function planInstall({
  hooksPath = join(homedir(), ".codex", "hooks.json"),
  skillDir = defaultSkill,
} = {}) {
  const destination = resolve(hooksPath);
  const root = resolve(skillDir);
  const stopFile = join(root, "scripts", "codex-stop-gate.mjs");
  const contextFile = join(root, "scripts", "codex-turn-context.mjs");
  for (const source of [stopFile, contextFile]) {
    if (!existsSync(source)) throw new Error("Codex hook script is missing: " + source);
    if (/["\r\n]/.test(source)) throw new Error("Unsafe hook script path");
  }
  const config = readConfig(destination);
  const original = JSON.stringify(config);
  const stopCommand = "node \"" + stopFile + "\"";
  const contextCommand = "node \"" + contextFile + "\"";
  const entry = (command, statusMessage, matcher) => ({
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: "command", command, commandWindows: command,
      timeout: 15, statusMessage }],
  });
  config.hooks.Stop = updateEvent(config.hooks.Stop ?? [], markers.Stop,
    entry(stopCommand, "Checking design iteration proof"));
  config.hooks.UserPromptSubmit = updateEvent(config.hooks.UserPromptSubmit ?? [],
    markers.UserPromptSubmit, entry(contextCommand, "Recording design turn scope"));
  config.hooks.PostToolUse = updateEvent(config.hooks.PostToolUse ?? [],
    markers.PostToolUse, entry(contextCommand, "Recording design gate calls", "Bash"));
  return {
    hooksPath: destination, skillDir: root,
    changed: JSON.stringify(config) !== original,
    config, command: stopCommand, contextCommand,
  };
}

export function installCodexStopGate(options = {}) {
  const plan = planInstall(options);
  const apply = options.apply === true;
  let backupPath = null;
  if (apply && plan.changed) {
    mkdirSync(dirname(plan.hooksPath), { recursive: true });
    if (existsSync(plan.hooksPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = plan.hooksPath + ".backup-" + stamp;
      copyFileSync(plan.hooksPath, backupPath);
    }
    writeFileSync(plan.hooksPath, JSON.stringify(plan.config, null, 2) + "\n");
  }
  return {
    schemaVersion: 2, hooksPath: plan.hooksPath, skillDir: plan.skillDir,
    wouldChange: plan.changed, applied: apply && plan.changed, backupPath,
    hooks: ["UserPromptSubmit", "PostToolUse", "Stop"],
    nextAction: "Restart Codex if needed; run /hooks and review/trust all three design-with-ai commands.",
    warning: "Hooks are opt-in, may be disabled, and cannot certify actual UI correctness.",
  };
}

function main() {
  try {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--apply") parsed.apply = true;
      else if (arg === "--hooks" || arg === "--skill-dir") {
        const v = args[++i];
        if (!v || v.startsWith("--")) throw new Error(arg + " requires a path");
        parsed[arg === "--hooks" ? "hooksPath" : "skillDir"] = v;
      } else if (arg === "--help") {
        process.stdout.write("Usage: node install-codex-stop-gate.mjs [--apply] [--hooks <file>] [--skill-dir <skill-root>]\nDry-run by default.\n"); return;
      } else throw new Error("Unexpected argument: " + arg);
    }
    process.stdout.write(JSON.stringify(installCodexStopGate(parsed), null, 2) + "\n");
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === file) main();
