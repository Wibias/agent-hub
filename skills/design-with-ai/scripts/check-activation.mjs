#!/usr/bin/env node
// Read-only Codex local skill discovery and content check.
// This does not prove that a model actually selected or read the skill.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const skillName = "design-with-ai";
export const requiredFiles = [
  "SKILL.md",
  "references/existing-ui-workflows.md",
  "references/baseline-ui.md",
  "references/core-design-workflow.md",
  "references/verification-contract.md",
  "scripts/verify-iteration-receipt.mjs",
  "scripts/check-activation.mjs",
];

const safeRealpath = (p) => {
  try { return realpathSync(p); } catch { return resolve(p); }
};
const fileHash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const isDirectory = (p) => {
  try { return statSync(p).isDirectory(); } catch { return false; }
};
const pathIdentity = (p) => process.platform === "win32"
  ? safeRealpath(p).toLowerCase()
  : safeRealpath(p);

function localProjectDirectories(workspace) {
  const directories = [];
  let cursor = safeRealpath(workspace);
  while (true) {
    directories.push(cursor);
    if (existsSync(join(cursor, ".git"))) {
      return { directories, gitBoundaryFound: true };
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      // Without a detected repo root, we cannot accurately claim which
      // ancestor directories the host scans.
      return { directories: [directories[0]], gitBoundaryFound: false };
    }
    cursor = parent;
  }
}

export function checkActivation({ workspace, canonical, home = homedir() }) {
  if (!isDirectory(workspace)) throw new Error("Workspace directory does not exist: " + workspace);
  if (!isDirectory(canonical)) throw new Error("Canonical skill directory does not exist: " + canonical);
  if (!existsSync(join(canonical, "SKILL.md"))) {
    throw new Error("Canonical path is not a skill root: " + canonical);
  }
  const expected = new Map();
  for (const name of requiredFiles) {
    const full = join(canonical, name);
    if (!existsSync(full)) throw new Error("Canonical skill is missing required file: " + name);
    expected.set(name, fileHash(full));
  }

  const discovery = localProjectDirectories(workspace);
  const possible = [
    ...discovery.directories.map((dir) => ({
      source: "repository",
      path: join(dir, ".agents", "skills", skillName),
    })),
    { source: "user", path: join(home, ".agents", "skills", skillName) },
  ];
  const seen = new Map();
  for (const item of possible) {
    if (!isDirectory(item.path)) continue;
    const resolved = safeRealpath(item.path);
    const id = pathIdentity(item.path);
    if (seen.has(id)) {
      seen.get(id).discoveredAt.push(item.path);
      continue;
    }
    const differences = [];
    for (const [name, hash] of expected) {
      const p = join(item.path, name);
      if (!existsSync(p)) differences.push({ file: name, reason: "missing" });
      else if (fileHash(p) !== hash) differences.push({ file: name, reason: "different" });
    }
    seen.set(id, {
      source: item.source,
      path: item.path,
      resolvedPath: resolved,
      discoveredAt: [item.path],
      matchesCanonicalFiles: differences.length === 0,
      differences,
    });
  }

  const candidates = [...seen.values()];
  let status;
  if (candidates.length === 0) status = "NOT_DISCOVERABLE";
  else if (candidates.length > 1) status = "MULTIPLE_CANDIDATES";
  else if (!candidates[0].matchesCanonicalFiles) status = "DIFFERENT_OR_STALE";
  else status = "MATCHING_COPY_FOUND";

  const advice = status === "MATCHING_COPY_FOUND"
    ? "The discovered copy matches the supplied canonical files; inspect the actual agent tool trace to prove it read this skill and ran its gates."
    : status === "NOT_DISCOVERABLE"
      ? "Install or link the canonical skill into a user or repo .agents/skills directory, then rerun this check."
      : status === "MULTIPLE_CANDIDATES"
        ? "Multiple distinct skill roots are discoverable. Inspect or remove unneeded copies and inspect the host trace; this tool cannot determine which one the host loaded."
        : "A discoverable skill differs from the supplied canonical version. Sync the intended installation before evaluating behavior.";

  return {
    status,
    workspace: safeRealpath(workspace),
    canonicalRoot: safeRealpath(canonical),
    canonicalSkillHash: expected.get("SKILL.md"),
    gitBoundaryFound: discovery.gitBoundaryFound,
    candidates,
    modelInvokedThisSkill: "NOT_VERIFIED",
    gateExecutedInUserProject: "NOT_VERIFIED",
    warning: "Discovery and file equality do not prove skill selection, reference reads, command execution, or UI correctness.",
    advice,
  };
}

function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--workspace", "--canonical", "--home"].includes(args[i]) || !args[i + 1] ||
        args[i + 1].startsWith("--") || values.has(args[i])) {
      throw new Error("Expected --workspace <project-root> --canonical <hub-skill-root> [--home <user-home>]");
    }
    values.set(args[i], args[i + 1]);
  }
  if (!values.has("--workspace") || !values.has("--canonical")) {
    throw new Error("Both --workspace and --canonical are required to avoid comparing a stale skill with itself");
  }
  return {
    workspace: resolve(values.get("--workspace")),
    canonical: resolve(values.get("--canonical")),
    home: values.has("--home") ? resolve(values.get("--home")) : homedir(),
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write("Usage: node check-activation.mjs --workspace <project-root> --canonical <hub-skill-root> [--home <user-home>]\nRead-only; outputs JSON. Match is not proof the agent invoked the skill.\n");
      return;
    }
    const report = checkActivation(args);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.status !== "MATCHING_COPY_FOUND") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
