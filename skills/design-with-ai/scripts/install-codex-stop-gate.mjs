#!/usr/bin/env node
// Opt-in additive installer for Codex Stop hook. Dry-run by default.
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(import.meta.url);
const defaultSkill = resolve(dirname(file), "..");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const marker = /(?:^|[\\/])codex-stop-gate\.mjs(?:"|\s|$)/i;

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

export function planInstall({
  hooksPath = join(homedir(), ".codex", "hooks.json"),
  skillDir = defaultSkill,
} = {}) {
  const destination = resolve(hooksPath);
  const root = resolve(skillDir);
  const hookFile = join(root, "scripts", "codex-stop-gate.mjs");
  if (!existsSync(hookFile)) throw new Error("Stop hook script is missing: " + hookFile);
  if (/["\r\n]/.test(hookFile)) throw new Error("Unsafe hook script path");
  const config = readConfig(destination);
  const existing = config.hooks.Stop ?? [];
  if (!Array.isArray(existing)) throw new Error("hooks.Stop must be an array");
  const command = "node \"" + hookFile + "\"";
  const entries = [];
  for (const group of existing) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      entries.push(group); continue;
    }
    const filtered = group.hooks.filter((item) => {
      const matches = marker.test(String(item?.commandWindows ?? item?.command ?? ""));
      if (!matches) return true;
      return false;
    });
    if (filtered.length) entries.push({ ...group, hooks: filtered });
  }
  // Keep unrelated stop hooks unchanged. One canonical entry at the end.
  const newEntry = {
    hooks: [{ type: "command", command, commandWindows: command,
      timeout: 15, statusMessage: "Checking design iteration proof" }],
  };
  entries.push(newEntry);
  const expected = { ...config, hooks: { ...config.hooks, Stop: entries } };
  const unchanged = existing.length === entries.length &&
    JSON.stringify(existing) === JSON.stringify(entries);
  return { hooksPath: destination, skillDir: root, changed: !unchanged,
    config: expected, command };
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
    schemaVersion: 1, hooksPath: plan.hooksPath, skillDir: plan.skillDir,
    wouldChange: plan.changed, applied: apply && plan.changed, backupPath,
    nextAction: "Restart Codex if needed; run /hooks to review and trust this new Stop command.",
    warning: "Hooks are opt-in and not an unbreakable policy. Other Stop hooks can veto continuation.",
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
