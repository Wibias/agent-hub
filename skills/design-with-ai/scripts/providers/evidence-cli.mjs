#!/usr/bin/env node
// Explicit evidence fusion / append-only sidecar journal, never a DWA gate.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fuseProviderEvidence } from "./fuse.mjs";
import {
  adjudicateProviderGroup, captureProviderFusion, initializeEvidenceJournal,
  previewLegacyImport, readEvidenceJournal,
} from "./evidence-journal.mjs";

const read = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
function writeFresh(path, value) {
  if (existsSync(resolve(path))) throw new Error("Output already exists; refusing to overwrite evidence");
  writeFileSync(resolve(path), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}
function parse(argv) {
  const [command, ...tail] = argv;
  if (!["fuse", "init", "capture", "adjudicate", "preview", "verify"].includes(command)) {
    throw new Error("Usage: evidence-cli.mjs fuse|init|capture|adjudicate|preview|verify [--option value]");
  }
  if (tail.length % 2) throw new Error("Expected --option value pairs");
  const opts = new Map();
  const allowed = new Set([
    "--journal", "--ledger", "--fusion", "--run-id", "--details",
    "--output", "--reports", "--required", "--optional",
  ]);
  for (let i = 0; i < tail.length; i += 2) {
    if (!allowed.has(tail[i]) || opts.has(tail[i]) ||
        !tail[i + 1] || tail[i + 1].startsWith("--")) {
      throw new Error("Unsupported or repeated CLI option");
    }
    opts.set(tail[i], tail[i + 1]);
  }
  const required = {
    fuse: ["--reports", "--output"],
    init: ["--journal", "--ledger"],
    capture: ["--journal", "--ledger", "--run-id", "--fusion"],
    adjudicate: ["--journal", "--ledger", "--details"],
    preview: ["--journal", "--ledger", "--run-id", "--output"],
    verify: ["--journal", "--ledger"],
  }[command];
  if (required.some((key) => !opts.has(key))) {
    throw new Error(command + " requires " + required.join(", "));
  }
  return { command, opts };
}

function list(raw) {
  return raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
}
function main() {
  const { command, opts } = parse(process.argv.slice(2));
  const o = (key) => opts.get(key);
  let result;
  if (command === "fuse") {
    const selected = list(o("--reports"));
    if (!selected.length || new Set(selected).size !== selected.length) {
      throw new Error("Reports must be a unique, nonempty comma-separated path list");
    }
    result = fuseProviderEvidence(selected.map(read), {
      required: list(o("--required")), optional: list(o("--optional")),
    });
    writeFresh(o("--output"), result);
  } else if (command === "init") {
    result = initializeEvidenceJournal(o("--journal"), o("--ledger"));
  } else if (command === "capture") {
    result = captureProviderFusion(o("--journal"), o("--ledger"),
      { runId: o("--run-id"), fusion: read(o("--fusion")) });
  } else if (command === "adjudicate") {
    result = adjudicateProviderGroup(o("--journal"), o("--ledger"), read(o("--details")));
  } else if (command === "preview") {
    result = previewLegacyImport(o("--journal"), o("--ledger"), { runId: o("--run-id") });
    writeFresh(o("--output"), result);
  } else {
    const journal = readEvidenceJournal(o("--journal"), o("--ledger"));
    result = { valid: true, schemaVersion: journal.schemaVersion,
      events: journal.events.length,
      legacyAnchor: journal.legacyAnchor,
      headSha256: journal.events.at(-1)?.sha256 ?? null };
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    process.stderr.write("Provider evidence: " + String(error.message ?? error) + "\n");
    process.exitCode = 2;
  }
}
