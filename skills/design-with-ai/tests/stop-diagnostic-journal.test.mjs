import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  appendStopDiagnostic, createDiagnostic, MAX_JOURNAL_BYTES,
} from "../scripts/stop-diagnostic-journal.mjs";
import { handleStop } from "../scripts/codex-stop-gate.mjs";

const hook = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/codex-stop-gate.mjs");

function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), "design-stop-diagnostics-test-"));
  try { return action(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function input({
  status = "MISSING_VERIFIED_GATE_PROOF", decision = "block",
  prompt = "Verbessere design-with-ai", command = "echo secret-token",
} = {}) {
  return {
    event: { hook_event_name: "Stop", session_id: "private-session-id", stop_hook_active: false,
      cwd: "C:/Users/private-name/super-secret-project", last_assistant_message: "secret-content" },
    report: { userPrompt: prompt, userBoundary: true, readsSkill: true,
      gateCommands: [{ receipt: "/private/receipt.json", proof: "/private/proof.json", cmd: command }] },
    result: { decision, status, proofStatus: "PROOF_MISSING",
      reason: "secret authorization credential" },
    transcriptState: "SCANNED",
  };
}

test("journal includes only allowlisted categorical facts, never raw data", () => fixture((root) => {
  const result = appendStopDiagnostic(input(), { root, clock: new Date("2026-11-04T19:00:00Z") });
  assert.deepEqual(result, { written: true, reason: "APPENDED" });
  const data = readFileSync(join(root, "stop-events.jsonl"), "utf8");
  const record = JSON.parse(data);
  assert.deepEqual(Object.keys(record), [
    "schemaVersion", "at", "event", "decision", "cause", "retry", "transcript",
    "turnBoundary", "skillFileReference", "gateCommandCandidates", "proof",
  ]);
  assert.equal(record.decision, "BLOCK");
  assert.equal(record.cause, "MISSING_VERIFIED_GATE_PROOF");
  assert.equal(record.gateCommandCandidates, 1);
  assert.equal(record.proof, "PROOF_MISSING");
  for (const secret of ["private-name", "secret-token", "secret-content",
    "private-session-id", "/private/", "authorization credential", "Verbessere"]) {
    assert.equal(data.includes(secret), false, "journal leaked: " + secret);
  }
}));

test("journal distinguishes unrelated, absent transcript, and verified completion", () => fixture((root) => {
  const entries = [
    { ...input(), result: { continue: true, status: "READ_ONLY_OR_OUT_OF_SCOPE" }, transcriptState: "SCANNED" },
    { ...input(), report: null, result: { continue: true, status: "TRANSCRIPT_UNAVAILABLE" }, transcriptState: "UNAVAILABLE" },
    { ...input(), result: { continue: true, status: "VERIFIED_COMPLETE",
      proofStatus: "VERIFIED_COMPLETE" }, transcriptState: "SCANNED" },
    { ...input(), event: { ...input().event, stop_hook_active: true },
      result: { continue: true, status: "RETRY_LIMIT_NOT_VERIFIED", proofStatus: "NO_GATE_COMMAND" } },
  ];
  for (const [index, entry] of entries.entries()) {
    appendStopDiagnostic(entry, { root, clock: new Date(1762281000000 + index * 1000) });
  }
  const lines = readFileSync(join(root, "stop-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map(x => x.cause), [
    "READ_ONLY_OR_OUT_OF_SCOPE", "TRANSCRIPT_UNAVAILABLE",
    "VERIFIED_COMPLETE", "RETRY_LIMIT_NOT_VERIFIED",
  ]);
  assert.deepEqual(lines.map(x => x.transcript), ["SCANNED", "UNAVAILABLE", "SCANNED", "SCANNED"]);
  assert.equal(lines[3].retry, true);
}));

test("untrusted result status and unexpected fields cannot enter journal", () => {
  const v = createDiagnostic({ ...input(), result: {
    status: "token=REDACT_ME", proofStatus: "C:/Secrets/log.json",
    decision: "block", prompt: "private", reason: "sensitive",
  } }, new Date("2026-11-04T19:00:00Z"));
  assert.equal(v.cause, "MISSING_VERIFIED_GATE_PROOF");
  assert.equal(v.proof, "NOT_CHECKED");
  assert.doesNotMatch(JSON.stringify(v), /REDACT_ME|Secrets|private|sensitive/);
});

test("journal rotates at a hard size boundary and keeps only one predecessor", () => fixture((root) => {
  for (let i = 0; i < 2800; i++) {
    const result = appendStopDiagnostic(input(), { root });
    assert.equal(result.written, true, result.reason);
  }
  const active = join(root, "stop-events.jsonl");
  const previous = join(root, "stop-events.previous.jsonl");
  assert.ok(existsSync(previous), "rotation should have occurred");
  assert.ok(statSync(active).size <= MAX_JOURNAL_BYTES);
  assert.ok(statSync(previous).size <= MAX_JOURNAL_BYTES);
  assert.ok(statSync(active).size > 0);
}));

test("symbolic-link journal is rejected without changing its target", () => fixture((root) => {
  const target = join(root, "target.txt");
  writeFileSync(target, "SAFE");
  const journalRoot = join(root, "events");
  mkdirSync(journalRoot);
  try { symlinkSync(target, join(journalRoot, "stop-events.jsonl"), "file"); }
  catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) return;
    throw error;
  }
  const result = appendStopDiagnostic(input(), { root: journalRoot });
  assert.equal(result.written, false);
  assert.equal(result.reason, "UNSAFE_FILE");
  assert.equal(readFileSync(target, "utf8"), "SAFE");
}));

test("diagnostic callback failure never changes the actual Stop decision", async () => {
  const event = { hook_event_name: "Stop", cwd: tmpdir(), transcript_path: join(tmpdir(), "missing-rollout.jsonl") };
  const v = await handleStop(event, { onDiagnostic: () => { throw new Error("disk full"); } });
  assert.equal(v.continue, true);
  assert.equal(v.status, "NO_TURN_BOUNDARY");
});

test("hook CLI writes journal for a simulated Stop and preserves correct block stdout", () => fixture((root) => {
  const transcript = join(root, "rollout.jsonl");
  writeFileSync(transcript, JSON.stringify({
    type: "event_msg", payload: {
      type: "user_message", message: "Verbessere die UI mit design-with-ai. secret-sentinel-credential",
    },
  }) + "\n");
  const payload = {
    hook_event_name: "Stop", session_id: "sensitive-session-id", turn_id: "turn1",
    cwd: root, transcript_path: transcript, stop_hook_active: false,
    last_assistant_message: "done",
  };
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  delete env.DESIGN_WITH_AI_STOP_DIAGNOSTICS;
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload), encoding: "utf8", env,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).decision, "block");
  const file = join(root, ".codex", "design-with-ai", "stop-events.jsonl");
  assert.ok(existsSync(file), "actual process must write diagnostic journal");
  const log = readFileSync(file, "utf8");
  assert.match(log, /MISSING_VERIFIED_GATE_PROOF/);
  assert.doesNotMatch(log, /secret-sentinel-credential|sensitive-session-id/);
}));

test("diagnostics can be disabled without affecting the hook decision", () => fixture((root) => {
  const previous = process.env.DESIGN_WITH_AI_STOP_DIAGNOSTICS;
  try {
    process.env.DESIGN_WITH_AI_STOP_DIAGNOSTICS = "0";
    const output = appendStopDiagnostic(input(), { root });
    assert.deepEqual(output, { written: false, reason: "DISABLED" });
    assert.equal(existsSync(join(root, "stop-events.jsonl")), false);
  } finally {
    if (previous === undefined) delete process.env.DESIGN_WITH_AI_STOP_DIAGNOSTICS;
    else process.env.DESIGN_WITH_AI_STOP_DIAGNOSTICS = previous;
  }
}));
