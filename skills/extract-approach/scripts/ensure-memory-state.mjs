#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REGISTRY = `# Memory Registry\n\nLocal episodic lessons for this Agent Hub installation.\n\n## Registry\n\n| Date | Topic | Note | Status |\n|---|---|---|---|\n`;
const DEFAULT_PENDING = `# Pending Rules\n\nLocal staging for repeated lessons that may become durable rules or knowledge.\n\n## Candidates\n`;

function templateOrFallback(path, fallback) {
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
}

export function ensureMemoryState({ hubRoot = join(homedir(), ".agents") } = {}) {
  const root = resolve(hubRoot);
  const memoryDir = join(root, "memory");
  const notesDir = join(memoryDir, "notes");
  mkdirSync(notesDir, { recursive: true });

  const registryPath = join(memoryDir, "MEMORY.md");
  const pendingRulesPath = join(memoryDir, "pending-rules.md");
  const registryTemplate = join(memoryDir, "MEMORY.example.md");
  const pendingTemplate = join(memoryDir, "pending-rules.example.md");

  let createdRegistry = false;
  let createdPendingRules = false;

  if (!existsSync(registryPath)) {
    writeFileSync(registryPath, templateOrFallback(registryTemplate, DEFAULT_REGISTRY), { encoding: "utf8", flag: "wx" });
    createdRegistry = true;
  }
  if (!existsSync(pendingRulesPath)) {
    writeFileSync(pendingRulesPath, templateOrFallback(pendingTemplate, DEFAULT_PENDING), { encoding: "utf8", flag: "wx" });
    createdPendingRules = true;
  }

  return { root, memoryDir, notesDir, registryPath, pendingRulesPath, createdRegistry, createdPendingRules };
}

function parseArgs(argv) {
  let hubRoot;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--hub-root") {
      hubRoot = argv[i + 1];
      if (!hubRoot) throw new Error("--hub-root requires a path");
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { hubRoot };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = ensureMemoryState(args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`ensure-memory-state failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
