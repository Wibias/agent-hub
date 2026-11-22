#!/usr/bin/env node
// Process-produced native gate proof index. It is only a location hint; the
// Stop hook must fully verify any referenced proof and its current source.
// This removes reliance on PostToolUse forwarding nested functions.exec calls
// and avoids recursive searches across the user's workspace.
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const MAX_INDEX_ENTRIES = 128;
const MAX_ENTRY_BYTES = 4096;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const INDEX_NAME = /^[0-9a-f]{64}\.json$/;
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const at = v => typeof v === "string" && Number.isFinite(Date.parse(v));
const within = (file, root) => {
  const f = process.platform === "win32" ? resolve(file).toLowerCase() : resolve(file);
  const r = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  return f === r || f.startsWith(r + sep);
};
export const defaultNativeGateIndexRoot = () =>
  join(homedir(), ".codex", "design-with-ai", "gate-index");

function safeDirectory(path) {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch { return false; }
}
function validRecord(record) {
  return object(record) && record.schemaVersion === 1 &&
    typeof record.proofPath === "string" && isAbsolute(record.proofPath) &&
    typeof record.sourceRoot === "string" && isAbsolute(record.sourceRoot) &&
    at(record.executedAt) &&
    within(record.proofPath, join(record.sourceRoot, ".design-with-ai"));
}

/**
 * Call ONLY after the real gate wrote its immutable proof.
 * Sidecar failure must never rewrite gate outcomes or the proof itself.
 */
export function recordNativeGateProof({
  proofPath, sourceRoot, executedAt,
}, { indexRoot = defaultNativeGateIndexRoot() } = {}) {
  const record = { schemaVersion: 1, proofPath, sourceRoot, executedAt };
  if (!validRecord(record)) return { recorded: false, reason: "NOT_NATIVE" };
  const dir = resolve(indexRoot);
  let temporary = null;
  try {
    if (existsSync(dir) && !safeDirectory(dir)) return { recorded: false, reason: "UNSAFE_INDEX" };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!safeDirectory(dir)) return { recorded: false, reason: "UNSAFE_INDEX" };
    const hash = createHash("sha256").update(resolve(sourceRoot).toLowerCase()).digest("hex");
    const target = join(dir, hash + ".json");
    if (existsSync(target) && (lstatSync(target).isSymbolicLink() ||
        !lstatSync(target).isFile())) return { recorded: false, reason: "UNSAFE_ENTRY" };
    const payload = JSON.stringify(record) + "\n";
    if (Buffer.byteLength(payload) > MAX_ENTRY_BYTES) return { recorded: false, reason: "ENTRY_TOO_LARGE" };
    temporary = join(dir, hash + "." + randomUUID() + ".tmp");
    writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, target);
    return { recorded: true };
  } catch {
    return { recorded: false, reason: "INDEX_IO_ERROR" };
  } finally {
    if (temporary) {
      try { rmSync(temporary, { force: true }); } catch { /* best effort */ }
    }
  }
}

/**
 * Read a bounded, flat per-user index. The output is UNTRUSTED hints.
 * Stop validates each proof against its current source and full gate inputs.
 */
export function listRecentNativeGateProofs({
  cwd, startedAt, indexRoot = defaultNativeGateIndexRoot(), now = Date.now(),
} = {}) {
  if (typeof cwd !== "string" || !isAbsolute(cwd) || !at(startedAt) ||
      !safeDirectory(indexRoot)) return [];
  let files;
  try { files = readdirSync(indexRoot); }
  catch { return []; }
  if (files.length > MAX_INDEX_ENTRIES) return [];
  const records = [];
  for (const name of files) {
    if (!INDEX_NAME.test(name)) continue;
    const path = join(indexRoot, name);
    try {
      const st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() ||
          st.size <= 0 || st.size > MAX_ENTRY_BYTES) continue;
      const record = JSON.parse(readFileSync(path, "utf8"));
      if (!validRecord(record) ||
          !(within(record.sourceRoot, cwd) || within(cwd, record.sourceRoot))) continue;
      const executed = Date.parse(record.executedAt);
      if (executed < Date.parse(startedAt) - 1000 ||
          executed > now + 60000 || now - executed > MAX_AGE_MS) continue;
      // Never infer success from this record: the separate proof might have
      // changed, been deleted, or been generated with a nonzero gate.
      records.push(record);
    } catch { /* invalid hints are ignored */ }
  }
  return records.sort((a, b) => Date.parse(b.executedAt) -
    Date.parse(a.executedAt)).map(record => record.proofPath);
}
