#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const cacheRoot = resolve(
  String(
    args["cache-root"] ||
      join(homedir(), ".agents", ".cache", "design-references"),
  ),
);
const retentionDays = Number(args.days || 180);
if (!Number.isInteger(retentionDays) || retentionDays < 1) {
  throw new Error("--days must be a positive integer");
}

function manifestsBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return manifestsBelow(full);
    return entry.name === "manifest.json" ? [full] : [];
  });
}

const cutoff = Date.now() - retentionDays * 86_400_000;
const candidates = [];
const retained = [];
for (const manifestPath of manifestsBelow(cacheRoot)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.retentionPolicy === "approved-comparison") {
    retained.push(manifest.recordId);
    continue;
  }
  const capturedAt = new Date(manifest.capturedAt).getTime();
  if (Number.isFinite(capturedAt) && capturedAt < cutoff) {
    candidates.push({
      recordId: manifest.recordId,
      directory: dirname(manifestPath),
      capturedAt: manifest.capturedAt,
    });
  }
}

if (args.apply) {
  for (const candidate of candidates) {
    rmSync(candidate.directory, { recursive: true, force: false });
  }
}
console.log(
  JSON.stringify(
    {
      ok: true,
      mode: args.apply ? "apply" : "dry-run",
      cacheRoot,
      retentionDays,
      candidates,
      retained,
      removed: args.apply ? candidates.length : 0,
    },
    null,
    2,
  ),
);
