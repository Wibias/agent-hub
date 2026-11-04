#!/usr/bin/env node
// Minimal, bounded, local-only Stop-hook diagnostic journal.
// Never persist prompts, paths, commands, tokens, session IDs, or tool outputs.
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, renameSync, unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const MAX_JOURNAL_BYTES = 256 * 1024;
const CAUSES = new Set([
  "NOT_STOP", "INVALID_EVENT", "TRANSCRIPT_UNAVAILABLE", "TRANSCRIPT_SCAN_ERROR",
  "NO_TURN_BOUNDARY", "READ_ONLY_OR_OUT_OF_SCOPE", "SKILL_NOT_OBSERVED",
  "VERIFIED_COMPLETE", "VERIFIED_INCOMPLETE", "MISSING_VERIFIED_GATE_PROOF",
  "RETRY_LIMIT_NOT_VERIFIED",
]);
const PROOFS = new Set([
  "NOT_CHECKED", "NO_GATE_COMMAND", "PATH_REJECTED", "PROOF_MISSING",
  "PROOF_INVALID_OR_STALE", "VALIDATOR_NONZERO", "VERIFIED_COMPLETE",
  "VERIFIED_INCOMPLETE", "INCOMPLETE_NOT_DISCLOSED", "NO_VALID_PROOF",
]);
const TRANSCRIPTS = new Set([
  "NOT_CHECKED", "UNAVAILABLE", "SCANNED", "SCAN_ERROR",
]);
const boundedCount = (value) => Number.isSafeInteger(value) && value >= 0
  ? Math.min(value, 100000) : 0;
const safeEnum = (value, values, fallback) => values.has(value) ? value : fallback;

export function createDiagnostic({ event, report, result, transcriptState }, clock = new Date()) {
  const decision = result?.decision === "block" ? "BLOCK" : "ALLOW";
  const cause = safeEnum(result?.status ?? (decision === "BLOCK"
    ? "MISSING_VERIFIED_GATE_PROOF" : "NOT_STOP"), CAUSES, "INVALID_EVENT");
  return {
    schemaVersion: 1,
    at: clock.toISOString(),
    event: "Stop",
    decision,
    cause,
    retry: event?.stop_hook_active === true,
    transcript: safeEnum(transcriptState, TRANSCRIPTS, "NOT_CHECKED"),
    turnBoundary: report?.userBoundary === true,
    skillFileReference: report?.readsSkill === true,
    gateCommandCandidates: boundedCount(report?.gateCommands?.length),
    proof: safeEnum(result?.proofStatus, PROOFS, "NOT_CHECKED"),
  };
}

function safeRegularFile(path) {
  if (!existsSync(path)) return true;
  const st = lstatSync(path);
  return st.isFile() && !st.isSymbolicLink();
}

export function appendStopDiagnostic(info, {
  root = join(homedir(), ".codex", "design-with-ai"),
  clock = new Date(),
} = {}) {
  if (process.env.DESIGN_WITH_AI_STOP_DIAGNOSTICS === "0") {
    return { written: false, reason: "DISABLED" };
  }
  // A running hook must not fail or block ordinary work because logging failed.
  try {
    const directory = resolve(root);
    if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() ||
        !lstatSync(directory).isDirectory())) return { written: false, reason: "INVALID_DIRECTORY" };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "stop-events.jsonl");
    const previous = join(directory, "stop-events.previous.jsonl");
    if (!safeRegularFile(file) || !safeRegularFile(previous)) {
      return { written: false, reason: "UNSAFE_FILE" };
    }
    const line = JSON.stringify(createDiagnostic(info, clock)) + "\n";
    if (Buffer.byteLength(line) > 4096) return { written: false, reason: "OVERSIZED_ENTRY" };
    if (existsSync(file) && lstatSync(file).size + Buffer.byteLength(line) > MAX_JOURNAL_BYTES) {
      if (existsSync(previous)) unlinkSync(previous);
      renameSync(file, previous);
    }
    appendFileSync(file, line, { encoding: "utf8", mode: 0o600, flag: "a" });
    return { written: true, reason: "APPENDED" };
  } catch {
    return { written: false, reason: "IO_ERROR" };
  }
}
