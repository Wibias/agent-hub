import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decideStop, inspectTurnTranscript, handleStop } from "../scripts/codex-stop-gate.mjs";
import { runGate } from "../scripts/run-iteration-gate.mjs";

async function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), "codex-design-stop-test-"));
  const transcript = join(dir, "session.jsonl");
  const receipt = join(dir, "receipt.json");
  const baseline = join(dir, "prior.json");
  const proof = join(dir, "proof.json");
  const defaultEvent = {
    hook_event_name: "Stop", session_id: "s1", turn_id: "t1",
    stop_hook_active: false, cwd: dir, transcript_path: transcript,
    last_assistant_message: "Implementation done.",
  };
  const prompt = (value) => ({ type: "event_msg", payload: { type: "user_message", message: value } });
  const call = (name, command) => ({
    type: "response_item",
    payload: { type: "function_call", name, call_id: "abc", arguments: JSON.stringify({ command }) },
  });
  const write = (events) => writeFileSync(transcript, events.map(JSON.stringify).join("\n") + "\n");
  const putReceipt = (verdict = "COMPLETE") => {
    const v = {
      schemaVersion: 1, requiresPriorBaseline: true, iterationVerdict: verdict,
      gates: { render: "PASS", functional: "PASS" },
      changeSummary: { kind: "NO_CHANGE", rationale: "Existing setting grouping is appropriate", addressedFindingIds: [] },
      scope: [{
        route: "/settings", task: "Inspect existing setup form", coverage: "INSPECTED",
        semantics: { applicable: false, reason: "No queue or guarded publishing" },
      }],
      findings: [{
        id: "UX-KEEP", route: "/settings", symptom: "Settings hierarchy",
        acceptance: "Existing hierarchy is usable", decision: "KEEP",
        disposition: "KEEP_JUSTIFIED", justification: "Current inspected state is usable",
        after: { ref: "current-settings.png" },
      }],
      openCarryover: [],
    };
    if (verdict !== "COMPLETE") v.verdictReason = "Some runtime acceptance remains unverified";
    writeFileSync(receipt, JSON.stringify(v));
    writeFileSync(baseline, JSON.stringify({
      schemaVersion: 1, intent: "IMPROVE", scope: ["/settings"], findings: [],
    }));
  };
  try { return await run({ dir, transcript, receipt, baseline, proof,
    event: defaultEvent, prompt, call, write, putReceipt }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("one automatic continuation for a short German design improvement prompt", () => fixture(async (f) => {
  f.write([f.prompt("Nutze design-with-ai. Verbessere die bestehende UI.")]);
  const result = await handleStop(f.event);
  assert.equal(result.decision, "block");
  assert.match(result.reason, /--check-proof/);
}));

test("second Stop after automatic continuation is never blocked again", () => fixture(async (f) => {
  f.write([f.prompt("Verbessere mit design-with-ai die UI.")]);
  const result = await handleStop({ ...f.event, stop_hook_active: true });
  assert.equal(result.continue, true);
}));

test("read-only UX critique and unrelated coding tasks do not require gates", () => fixture(async (f) => {
  for (const p of [
    "Bewerte mit design-with-ai die aktuelle Seite.",
    "audit-surface standard mit design-with-ai",
    "Fix the backend Redis connection.",
  ]) {
    f.write([f.prompt(p)]);
    const result = await handleStop(f.event);
    assert.equal(result.continue, true, p);
  }
}));

test("old skill and gate calls in earlier turn are never valid proof for the next one", () => fixture(async (f) => {
  f.write([
    f.prompt("Verbessere das Dashboard mit design-with-ai."),
    f.call("exec_command", "node scripts/run-iteration-gate.mjs --receipt old.json --proof old-proof.json"),
    f.prompt("Debugge den Backend-Server."),
  ]);
  const report = await inspectTurnTranscript(f.transcript);
  assert.equal(report.gateCommands.length, 0);
  assert.equal(report.userPrompt, "Debugge den Backend-Server.");
  assert.equal((await handleStop(f.event)).continue, true);
}));

test("implicit skill path read triggers gate for an ordinary UI improvement", () => fixture(async (f) => {
  f.write([
    f.prompt("Improve the existing UI without redesigning it."),
    f.call("exec_command", 'Get-Content "C:/Users/example/.agents/skills/design-with-ai/SKILL.md"'),
  ]);
  assert.equal((await handleStop(f.event)).decision, "block");
}));

test("valid complete proof from a real runner satisfies Stop hook", () => fixture(async (f) => {
  f.putReceipt();
  const result = runGate({ receipt: f.receipt, baseline: f.baseline, proof: f.proof });
  assert.equal(result.exitCode, 0);
  const command = 'node "skills/design-with-ai/scripts/run-iteration-gate.mjs" --receipt "' +
    f.receipt + '" --baseline "' + f.baseline + '" --proof "' + f.proof + '"';
  f.write([f.prompt("Verbessere mit design-with-ai die Einstellungen."), f.call("exec_command", command)]);
  const report = await inspectTurnTranscript(f.transcript);
  assert.equal(report.gateCommands.length, 1);
  assert.equal((await handleStop(f.event)).continue, true);
}));

test("current, valid PARTIAL receipt passes only with an explicit PARTIAL final verdict", () => fixture(async (f) => {
  f.putReceipt("PARTIAL");
  assert.equal(runGate({ receipt: f.receipt, baseline: f.baseline, proof: f.proof }).exitCode, 0);
  const command = 'node run-iteration-gate.mjs --receipt "' + f.receipt +
    '" --baseline "' + f.baseline + '" --proof "' + f.proof + '"';
  f.write([f.prompt("Verbessere mit design-with-ai die Einstellungen."), f.call("exec_command", command)]);
  assert.equal((await handleStop({ ...f.event, last_assistant_message: "PARTIAL: noch offen." })).continue, true);
  assert.equal((await handleStop(f.event)).decision, "block");
}));

test("stale proof after changes to receipt cannot be reused", () => fixture(async (f) => {
  f.putReceipt();
  runGate({ receipt: f.receipt, baseline: f.baseline, proof: f.proof });
  const receiptObject = JSON.parse(readFileSync(f.receipt, "utf8"));
  receiptObject.findings[0].acceptance = "New value";
  writeFileSync(f.receipt, JSON.stringify(receiptObject));
  f.write([
    f.prompt("Verbessere mit design-with-ai die Einstellungen."),
    f.call("exec_command", 'node run-iteration-gate.mjs --receipt "' + f.receipt +
      '" --baseline "' + f.baseline + '" --proof "' + f.proof + '"'),
  ]);
  assert.equal((await handleStop(f.event)).decision, "block");
}));

test("gate path mentioned in prompt or echo output is not process proof", () => fixture(async (f) => {
  f.write([
    f.prompt("Verbessere mit design-with-ai die UI."),
    f.call("exec_command", 'echo "node run-iteration-gate.mjs --receipt /x.json --proof /y.json"'),
  ]);
  assert.equal((await handleStop(f.event)).decision, "block");
}));

test("transcript missing or unscoped cannot force unrelated work to continue", async () => {
  assert.equal((await handleStop({
    hook_event_name: "Stop", cwd: tmpdir(), turn_id: "t", transcript_path: join(tmpdir(), "missing.jsonl"),
  })).continue, true);
  assert.equal(decideStop({ hook_event_name: "Stop", cwd: tmpdir(), turn_id: "t" },
    { userBoundary: false, userPrompt: "", gateCommands: [] }).continue, true);
});
