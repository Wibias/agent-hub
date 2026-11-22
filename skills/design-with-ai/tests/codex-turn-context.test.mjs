import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyPrompt, recordTurnHook, readTurnContext } from "../scripts/codex-turn-context.mjs";
import { handleStop } from "../scripts/codex-stop-gate.mjs";
import { runGate, checkProof } from "../scripts/run-iteration-gate.mjs";
import { initializeLedger, importFindings, makeLedgerBaseline, readLedger, syncLedger } from "../scripts/findings-ledger.mjs";
import { listRecentNativeGateProofs, inspectRecentNativeGateProofs, recordNativeGateProof } from "../scripts/native-gate-proof-index.mjs";
import { createDiagnostic } from "../scripts/stop-diagnostic-journal.mjs";

async function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), "design-native-turn-test-"));
  const stateRoot = join(root, "hook-context");
  const event = { session_id: "session-1", turn_id: "turn-1", cwd: root };
  const prompt = (text) => ({ ...event, hook_event_name: "UserPromptSubmit", prompt: text });
  const tool = (command) => ({ ...event, hook_event_name: "PostToolUse", tool_name: "Bash",
    tool_input: { command }, tool_response: { ok: true } });
  const stop = { ...event, hook_event_name: "Stop", transcript_path: null,
    stop_hook_active: false, last_assistant_message: "Changes implemented." };
  try { return await action({ root, stateRoot, event, prompt, tool, stop }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("classifies short German design prompt and read-only critique", () => {
  assert.deepEqual(classifyPrompt("Verbessere die UI mit design-with-ai."),
    { modifying: true, explicit: true });
  assert.deepEqual(classifyPrompt("Bewerte die aktuelle UI mit design-with-ai."),
    { modifying: false, explicit: true });
  assert.deepEqual(classifyPrompt("Fix the Redis backend."),
    { modifying: false, explicit: false });
});

test("UserPromptSubmit stores only scope flags, not user prompt or IDs", () => fixture(async (f) => {
  const sent = f.prompt("Verbessere die UI mit design-with-ai. secret API key abcdef");
  assert.equal(recordTurnHook(sent, { root: f.stateRoot }).recorded, true);
  const entries = readdirSync(f.stateRoot);
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^[a-f0-9]{64}\.jsonl$/);
  const state = readFileSync(join(f.stateRoot, entries[0]), "utf8");
  for (const secret of ["API key", "abcdef", "session-1", "turn-1", f.root]) {
    assert.equal(state.includes(secret), false, "leaked: " + secret);
  }
  assert.deepEqual(readTurnContext(f.event, { root: f.stateRoot }).gateCommands, []);
}));

test("native prompt scope blocks missing proof with null transcript path", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Verbessere die UI mit design-with-ai."), { root: f.stateRoot });
  const decision = await handleStop(f.stop, { turnRoot: f.stateRoot });
  assert.equal(decision.decision, "block");
  assert.equal(decision.proofStatus, "NO_GATE_COMMAND");
}));

test("read-only and unrelated prompts not blocked without transcript", () => fixture(async (f) => {
  for (const phrase of ["Bewerte den Screen mit design-with-ai.", "Fix the database connection."]) {
    recordTurnHook(f.prompt(phrase), { root: f.stateRoot });
    const d = await handleStop(f.stop, { turnRoot: f.stateRoot });
    assert.equal(d.continue, true, phrase);
  }
}));

test("grep or echo gate filename is not an executed proof", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Verbessere die UI mit design-with-ai."), { root: f.stateRoot });
  recordTurnHook(f.tool('echo "node run-iteration-gate.mjs --receipt /r.json --proof /p.json"'),
    { root: f.stateRoot });
  const context = readTurnContext(f.event, { root: f.stateRoot });
  assert.equal(context.gateCommands.length, 0);
  assert.equal((await handleStop(f.stop, { turnRoot: f.stateRoot })).decision, "block");
}));

test("valid gate proof is checked at Stop without transcript", () => fixture(async (f) => {
  const receipt = join(f.root, "receipt.json");
  const baseline = join(f.root, "prior.json");
  const proof = join(f.root, "proof.json");
  writeFileSync(receipt, JSON.stringify({
    schemaVersion: 1, requiresPriorBaseline: true, iterationVerdict: "COMPLETE",
    gates: { render: "PASS", functional: "PASS" },
    changeSummary: { kind: "NO_CHANGE", rationale: "Existing UI is justified", addressedFindingIds: [] },
    scope: [{ route: "/settings", task: "Inspect", coverage: "INSPECTED",
      semantics: { applicable: false, reason: "No action workflow" } }],
    findings: [{ id: "UX-KEEP", route: "/settings", symptom: "Settings exist",
      acceptance: "Settings remain usable", decision: "KEEP",
      disposition: "KEEP_JUSTIFIED", justification: "Functionally checked",
      after: { ref: "settings.png" } }],
    openCarryover: [],
  }));
  writeFileSync(baseline, JSON.stringify({
    schemaVersion: 1, intent: "IMPROVE", scope: ["/settings"], findings: [],
  }));
  recordTurnHook(f.prompt("Verbessere die UI mit design-with-ai."), { root: f.stateRoot });
  assert.equal(runGate({ receipt, baseline, proof, workspaceCwd: f.root }).exitCode, 0);
  const cmd = 'node "skills/design-with-ai/scripts/run-iteration-gate.mjs" --receipt "' +
    receipt + '" --baseline "' + baseline + '" --proof "' + proof + '"';
  const result = recordTurnHook(f.tool(cmd), { root: f.stateRoot });
  assert.equal(result.cause, "GATE_CANDIDATE");
  const d = await handleStop(f.stop, { turnRoot: f.stateRoot });
  assert.equal(d.continue, true);
  assert.equal(d.status, "VERIFIED_COMPLETE");
}));

test("a passing proof with an old executedAt cannot certify a later turn", () => fixture(async (f) => {
  const receipt = join(f.root, "receipt.json");
  const baseline = join(f.root, "prior.json");
  const proof = join(f.root, "proof.json");
  writeFileSync(receipt, JSON.stringify({
    schemaVersion: 1, requiresPriorBaseline: true, iterationVerdict: "COMPLETE",
    gates: { render: "PASS", functional: "PASS" },
    changeSummary: { kind: "NO_CHANGE", rationale: "Existing UI reviewed", addressedFindingIds: [] },
    scope: [{ route: "/settings", task: "Inspect", coverage: "INSPECTED",
      semantics: { applicable: false, reason: "No guarded action" } }],
    findings: [{ id: "UX-KEEP", route: "/settings", symptom: "Settings exist",
      acceptance: "Settings remain usable", decision: "KEEP",
      disposition: "KEEP_JUSTIFIED", justification: "Verified", after: { ref: "settings.png" } }],
    openCarryover: [],
  }));
  writeFileSync(baseline, JSON.stringify({
    schemaVersion: 1, intent: "IMPROVE", scope: ["/settings"], findings: [],
  }));
  assert.equal(runGate({ receipt, baseline, proof, workspaceCwd: f.root }).exitCode, 0);
  const old = JSON.parse(readFileSync(proof, "utf8"));
  old.executedAt = "2000-01-01T00:00:00.000Z";
  writeFileSync(proof, JSON.stringify(old));
  assert.equal(checkProof({ receipt, baseline, checkProof: proof, workspaceCwd: f.root }).completionEligible, true);
  recordTurnHook(f.prompt("Verbessere die UI mit design-with-ai."), { root: f.stateRoot });
  const command = 'node run-iteration-gate.mjs --receipt "' + receipt +
    '" --baseline "' + baseline + '" --proof "' + proof + '"';
  recordTurnHook(f.tool(command), { root: f.stateRoot });
  const result = await handleStop(f.stop, { turnRoot: f.stateRoot });
  assert.equal(result.decision, "block");
  assert.equal(result.proofStatus, "PROOF_TOO_OLD");
}));

test("relative gate paths are resolved against the project working directory", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Verbessere die UI mit design-with-ai."), { root: f.stateRoot });
  recordTurnHook(f.tool('node run-iteration-gate.mjs --receipt receipt.json --proof proof.json'),
    { root: f.stateRoot });
  const report = readTurnContext(f.event, { root: f.stateRoot });
  assert.equal(report.gateCommands.length, 1);
  assert.equal(report.gateCommands[0].receipt, join(f.root, "receipt.json"));
  assert.equal(report.gateCommands[0].proof, join(f.root, "proof.json"));
}));

test("new turn cannot inherit old gate candidate", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Verbessere UI mit design-with-ai"), { root: f.stateRoot });
  recordTurnHook(f.tool('node run-iteration-gate.mjs --receipt "/old.json" --proof "/old-proof.json"'),
    { root: f.stateRoot });
  const newTurn = { ...f.event, turn_id: "new-turn" };
  assert.equal(readTurnContext(newTurn, { root: f.stateRoot }), null);
  assert.equal((await handleStop({ ...f.stop, turn_id: "new-turn" },
    { turnRoot: f.stateRoot })).status, "TRANSCRIPT_UNAVAILABLE");
}));

test("stale checkpoint is ignored", () => fixture(async (f) => {
  const now = Date.now();
  recordTurnHook(f.prompt("Verbessere UI mit design-with-ai"), { root: f.stateRoot });
  const file = join(f.stateRoot, readdirSync(f.stateRoot)[0]);
  const old = new Date(now - 72 * 60 * 60 * 1000);
  utimesSync(file, old, old);
  assert.equal(readTurnContext(f.event, { root: f.stateRoot, now }), null);
}));

test("implicit skill read opts in for a modifying UI request", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Improve the existing UI."), { root: f.stateRoot });
  recordTurnHook(f.tool('Get-Content "/workspace/.agents/skills/design-with-ai/SKILL.md"'),
    { root: f.stateRoot });
  const context = readTurnContext(f.event, { root: f.stateRoot });
  assert.equal(context.readsSkill, true);
  assert.equal((await handleStop(f.stop, { turnRoot: f.stateRoot })).decision, "block");
}));

test("exec_command native events recognize actual PowerShell gate invocations", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  const command = 'node run-iteration-gate.mjs --receipt "receipt.json" --proof "proof.json"';
  const result = recordTurnHook({
    ...f.event, hook_event_name: "PostToolUse", tool_name: "exec_command",
    tool_input: { cmd: ["powershell", "-NoProfile", "-Command", command] },
    tool_response: { exit_code: 0 },
  }, { root: f.stateRoot });
  assert.equal(result.cause, "GATE_CANDIDATE");
  const report = readTurnContext(f.event, { root: f.stateRoot });
  assert.equal(report.gateCommands.length, 1);
  assert.equal(report.gateCommands[0].proof, join(f.root, "proof.json"));
}));
test("functions.exec accepts exposed commands but not opaque wrapper JavaScript", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  const raw = 'node run-iteration-gate.mjs --receipt receipt.json --proof proof.json';
  const direct = recordTurnHook({
    ...f.event, hook_event_name: "PostToolUse", tool_name: "functions.exec",
    tool_input: { command: raw }, tool_response: { ok: true },
  }, { root: f.stateRoot });
  assert.equal(direct.cause, "GATE_CANDIDATE");
  const opaque = recordTurnHook({
    ...f.event, hook_event_name: "PostToolUse", tool_name: "functions.exec",
    tool_input: { code: 'text("node run-iteration-gate.mjs --receipt receipt.json --proof proof.json")' },
    tool_response: { ok: true },
  }, { root: f.stateRoot });
  assert.equal(opaque.cause, "NOT_RELEVANT");
  assert.equal(readTurnContext(f.event, { root: f.stateRoot }).gateCommands.length, 1);
}));
test("failed host command events never register a successful gate candidate", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  const failed = recordTurnHook({
    ...f.event, hook_event_name: "PostToolUse", tool_name: "exec_command",
    tool_input: { cmd: ["bash", "-lc", "node run-iteration-gate.mjs --receipt receipt.json --proof proof.json"] },
    tool_response: { exit_code: 1 },
  }, { root: f.stateRoot });
  assert.equal(failed.cause, "NOT_RELEVANT");
  assert.deepEqual(readTurnContext(f.event, { root: f.stateRoot }).gateCommands, []);
}));

test("native root flag is recorded as a version-bound gate input without storing commands", () => fixture(async (f) => {
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai"), { root: f.stateRoot });
  const command = 'node run-iteration-gate.mjs --receipt receipt.json --ledger ledger.json --proof proof.json --source-root project';
  const recorded = recordTurnHook(f.tool(command), { root: f.stateRoot });
  assert.equal(recorded.cause, "GATE_CANDIDATE");
  const context = readTurnContext(f.event, { root: f.stateRoot });
  assert.equal(context.gateCommands[0]["source-root"], join(f.root, "project"));
}));

function nativeGateFixture(projectRoot) {
  const artifacts = join(projectRoot, ".design-with-ai");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(projectRoot, "PCGuardian.csproj"),
    "<Project Sdk='Microsoft.NET.Sdk.WindowsDesktop' />");
  writeFileSync(join(projectRoot, "MainForm.cs"), "public class MainForm { public int Rows = 4; }");
  const ledger = join(artifacts, "findings-ledger.json");
  initializeLedger(ledger);
  const issue = { id: "PCG-11", route: "PCGuardian/MainForm", kind: "VISUAL",
    priority: "MEDIUM", symptom: "Process table occupies insufficient height",
    acceptance: "Four rows fit without inspector clipping", evidenceRef: "renders/old.png" };
  importFindings(ledger, { findings: [issue] });
  const frozen = makeLedgerBaseline(readLedger(ledger),
    { scope: ["PCGuardian/MainForm"], runId: "native-functions-proof-run" });
  const baseline = join(artifacts, "prior.json");
  writeFileSync(baseline, JSON.stringify(frozen));
  const receipt = join(artifacts, "receipt.json");
  const data = {
    schemaVersion: 1, requiresPriorBaseline: true, requiresFindingsLedger: true,
    surfaceKind: "DENSE_DESKTOP_MONITOR", iterationVerdict: "PARTIAL",
    verdictReason: "Current final render remains unverified",
    gates: { render: "NOT_VERIFIED", functional: "PASS" },
    changeSummary: { kind: "NO_CHANGE", rationale: "Read-only verification pass",
      addressedFindingIds: [] },
    scope: [{ route: "PCGuardian/MainForm", task: "Inspect final native layout",
      coverage: "INSPECTED", semantics: { applicable: false, reason: "No destructive actions tested" } }],
    findings: [{ ...issue, decision: "Verify current state", disposition: "PERSISTS",
      reason: "Latest inspector state needs a new render" }],
    openCarryover: [issue.id],
  };
  writeFileSync(receipt, JSON.stringify(data));
  syncLedger(ledger, frozen, data);
  const proof = join(artifacts, "iteration-proof-40.json");
  return { projectRoot, artifacts, ledger, baseline, receipt, proof };
}

test("opaque functions.exec results register a typed current native gate proof, not the wrapper code", () => fixture(async f => {
  const projectRoot = join(f.root, "nested", "PCGuardian");
  mkdirSync(projectRoot, { recursive: true });
  const n = nativeGateFixture(projectRoot);
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
    ledger: n.ledger, proof: n.proof, workspaceCwd: f.root }).exitCode, 0);
  const event = {
    ...f.event, hook_event_name: "PostToolUse", tool_name: "functions.exec",
    tool_input: { code: 'text({ proofPath: "this is only an example" })' },
    tool_response: { content: [{ type: "text", text: JSON.stringify({
      proofPath: n.proof, processExitCode: 0,
    }) }] },
  };
  const recorded = recordTurnHook(event, { root: f.stateRoot });
  assert.equal(recorded.cause, "PROOF_HINT_CANDIDATE");
  const ctx = readTurnContext(f.event, { root: f.stateRoot });
  assert.equal(ctx.gateCommands.length, 0);
  assert.deepEqual(ctx.proofHints, [n.proof]);
  const status = await handleStop({
    ...f.stop, last_assistant_message: "PARTIAL: finale native Renderprüfung offen.",
  }, { turnRoot: f.stateRoot });
  assert.equal(status.status, "ACTIONABLE_PARTIAL_CONTINUATION", JSON.stringify(status));
  assert.notEqual(status.proofStatus, "NO_GATE_COMMAND");
}));

test("Stop independently discovers a current canonical native proof even without any tool event", () => fixture(async f => {
  const n = nativeGateFixture(f.root);
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
    ledger: n.ledger, proof: n.proof, workspaceCwd: f.root }).exitCode, 0);
  assert.deepEqual(readTurnContext(f.event, { root: f.stateRoot }).gateCommands, []);
  const status = await handleStop({
    ...f.stop, last_assistant_message: "PARTIAL: Render-Manifest fehlt.",
  }, { turnRoot: f.stateRoot });
  assert.equal(status.status, "ACTIONABLE_PARTIAL_CONTINUATION", JSON.stringify(status));
}));

test("Stop finds the canonical current proof when Codex cwd is one level above the native project", () => fixture(async f => {
  const project = join(f.root, "MemoryGuardian");
  mkdirSync(project, { recursive: true });
  const n = nativeGateFixture(project);
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
    ledger: n.ledger, proof: n.proof, workspaceCwd: f.root }).exitCode, 0);
  // No PostToolUse event, as can happen for nested functions.exec execution.
  const decision = await handleStop({
    ...f.stop, last_assistant_message: "PARTIAL: weitere Renderprüfung fehlt.",
  }, { turnRoot: f.stateRoot });
  assert.equal(decision.status, "ACTIONABLE_PARTIAL_CONTINUATION", JSON.stringify(decision));
  assert.equal(decision.proofStatus, "VERIFIED_INCOMPLETE");
}));

test("Stop refuses ambiguous direct-child project proof discovery", () => fixture(async f => {
  const first = join(f.root, "MemoryGuardian");
  const second = join(f.root, "OtherProduct");
  mkdirSync(first, { recursive: true });
  mkdirSync(second, { recursive: true });
  const a = nativeGateFixture(first);
  const b = nativeGateFixture(second);
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  for (const x of [a, b]) {
    assert.equal(runGate({ receipt: x.receipt, baseline: x.baseline,
      ledger: x.ledger, proof: x.proof, workspaceCwd: f.root }).exitCode, 0);
  }
  const decision = await handleStop({
    ...f.stop, last_assistant_message: "PARTIAL: weitere Renderprüfung fehlt.",
  }, { turnRoot: f.stateRoot });
  assert.equal(decision.proofStatus, "NO_GATE_COMMAND", JSON.stringify(decision));
  assert.equal(decision.decision, "block");
}));

test("Stop does not accept a direct-child native proof from a previous turn", () => fixture(async f => {
  const project = join(f.root, "MemoryGuardian");
  mkdirSync(project, { recursive: true });
  const n = nativeGateFixture(project);
  assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
    ledger: n.ledger, proof: n.proof, workspaceCwd: f.root }).exitCode, 0);
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  const old = JSON.parse(readFileSync(n.proof, "utf8"));
  old.executedAt = "2000-01-01T00:00:00.000Z";
  writeFileSync(n.proof, JSON.stringify(old));
  const decision = await handleStop({
    ...f.stop, last_assistant_message: "PARTIAL: weitere Renderprüfung fehlt.",
  }, { turnRoot: f.stateRoot });
  assert.equal(decision.proofStatus, "NO_GATE_COMMAND");
}));


test("a real native gate registers a verified hint even when Codex cwd is several levels above the project", () => fixture(async f => {
  const project = join(f.root, "deep", "2026-07-23", "ca", "work", "MemoryGuardian");
  mkdirSync(project, { recursive: true });
  const n = nativeGateFixture(project);
  const indexRoot = join(f.root, "private-index");
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
    ledger: n.ledger, proof: n.proof, workspaceCwd: f.root,
    nativeGateIndexRoot: indexRoot }).exitCode, 0);
  const turn = readTurnContext(f.event, { root: f.stateRoot });
  const hints = listRecentNativeGateProofs({
    cwd: f.root, startedAt: turn.promptAt, indexRoot,
  });
  assert.deepEqual(hints, [n.proof]);
  assert.deepEqual(turn.gateCommands, []);
  assert.deepEqual(turn.proofHints, []);
  const result = await handleStop({ ...f.stop,
    last_assistant_message: "PARTIAL: Auswahlzustand nicht visuell überprüft.",
  }, { turnRoot: f.stateRoot, gateIndexRoot: indexRoot });
  assert.equal(result.status, "ACTIONABLE_PARTIAL_CONTINUATION", JSON.stringify(result));
  assert.equal(result.proofStatus, "VERIFIED_INCOMPLETE");
}));


test("native index diagnoses a current registered proof outside the actual Codex cwd", () => fixture(async f => {
  const workspace = join(f.root, "session-workspace");
  const otherProject = join(f.root, "unrelated-workspace", "PCGuardian");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(otherProject, { recursive: true });
  const indexRoot = join(f.root, "private-index");
  const n = nativeGateFixture(otherProject);
  const event = { ...f.event, cwd: workspace };
  recordTurnHook({ ...event, hook_event_name: "UserPromptSubmit",
    prompt: "Verbessere PCGuardian mit design-with-ai." }, { root: f.stateRoot });
  assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
    ledger: n.ledger, proof: n.proof, workspaceCwd: f.root,
    nativeGateIndexRoot: indexRoot }).exitCode, 0);
  const turn = readTurnContext(event, { root: f.stateRoot });
  assert.equal(inspectRecentNativeGateProofs({
    cwd: workspace, startedAt: turn.promptAt, indexRoot,
  }).status, "INDEX_CWD_DISJOINT");
  const result = await handleStop({
    ...event, hook_event_name: "Stop", stop_hook_active: false,
    last_assistant_message: "PARTIAL: Auswahlzustand offen.",
  }, { turnRoot: f.stateRoot, gateIndexRoot: indexRoot });
  assert.equal(result.proofStatus, "NO_GATE_COMMAND");
  assert.equal(result.gateIndexStatus, "INDEX_CWD_DISJOINT");
  const diagnostic = createDiagnostic({
    event, report: turn, result, transcriptState: "NATIVE_TURN_EVENTS",
  });
  assert.equal(diagnostic.nativeIndex, "INDEX_CWD_DISJOINT");
  assert.ok(!JSON.stringify(diagnostic).includes(otherProject));
}));

test("native index distinguishes a registered but rejected proof from no registration", () => fixture(async f => {
  const project = join(f.root, "nested", "PCGuardian");
  mkdirSync(project, { recursive: true });
  const indexRoot = join(f.root, "private-index");
  const n = nativeGateFixture(project);
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
    ledger: n.ledger, proof: n.proof, workspaceCwd: f.root,
    nativeGateIndexRoot: indexRoot }).exitCode, 0);
  const proof = JSON.parse(readFileSync(n.proof, "utf8"));
  proof.ledger = null;
  writeFileSync(n.proof, JSON.stringify(proof));
  const result = await handleStop({
    ...f.stop, last_assistant_message: "PARTIAL: Nachprüfung offen.",
  }, { turnRoot: f.stateRoot, gateIndexRoot: indexRoot });
  assert.equal(result.proofStatus, "NO_GATE_COMMAND");
  assert.equal(result.gateIndexStatus, "INDEX_PROOF_METADATA_INVALID");
}));

test("native index exposes timing rejection without storing paths in the Stop journal", () => fixture(async f => {
  const indexRoot = join(f.root, "private-index");
  const project = join(f.root, "deep", "PCGuardian");
  mkdirSync(project, { recursive: true });
  const n = nativeGateFixture(project);
  assert.equal(recordNativeGateProof({ proofPath: n.proof,
    sourceRoot: project, executedAt: "2000-01-01T00:00:00.000Z",
  }, { indexRoot }).recorded, true);
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  const turn = readTurnContext(f.event, { root: f.stateRoot });
  const inspected = inspectRecentNativeGateProofs({
    cwd: f.root, startedAt: turn.promptAt, indexRoot,
  });
  assert.deepEqual(inspected.proofPaths, []);
  assert.equal(inspected.status, "INDEX_OUTSIDE_TURN_TIME");
  const result = await handleStop({
    ...f.stop, last_assistant_message: "PARTIAL: visuelle Prüfung offen.",
  }, { turnRoot: f.stateRoot, gateIndexRoot: indexRoot });
  assert.equal(result.gateIndexStatus, "INDEX_OUTSIDE_TURN_TIME");
  const journal = createDiagnostic({
    event: f.stop, report: turn, result, transcriptState: "NATIVE_TURN_EVENTS",
  });
  assert.equal(journal.nativeIndex, "INDEX_OUTSIDE_TURN_TIME");
  assert.ok(!JSON.stringify(journal).includes(project));
}));

test("the proof index refuses to select ambiguous deep native projects", () => fixture(async f => {
  const indexRoot = join(f.root, "private-index");
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  for (const name of ["first", "second"]) {
    const project = join(f.root, "deep", name, "project");
    mkdirSync(project, { recursive: true });
    const n = nativeGateFixture(project);
    assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
      ledger: n.ledger, proof: n.proof, workspaceCwd: f.root,
      nativeGateIndexRoot: indexRoot }).exitCode, 0);
  }
  const result = await handleStop({ ...f.stop,
    last_assistant_message: "PARTIAL: finale Native-QA unvollständig.",
  }, { turnRoot: f.stateRoot, gateIndexRoot: indexRoot });
  assert.equal(result.proofStatus, "NO_GATE_COMMAND", JSON.stringify(result));
  assert.equal(result.decision, "block");
}));

test("stale or out-of-scope native proof index hints do not count as a gate command", () => fixture(async f => {
  const indexRoot = join(f.root, "private-index");
  const project = join(f.root, "many", "levels", "below");
  mkdirSync(project, { recursive: true });
  const n = nativeGateFixture(project);
  const earlier = "2000-01-01T00:00:00.000Z";
  assert.equal(recordNativeGateProof({ proofPath: n.proof, sourceRoot: project,
    executedAt: earlier }, { indexRoot }).recorded, true);
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  const context = readTurnContext(f.event, { root: f.stateRoot });
  assert.deepEqual(listRecentNativeGateProofs({
    cwd: f.root, startedAt: context.promptAt, indexRoot,
  }), []);
  const result = await handleStop({ ...f.stop,
    last_assistant_message: "PARTIAL: Quelle unverifiziert.",
  }, { turnRoot: f.stateRoot, gateIndexRoot: indexRoot });
  assert.equal(result.proofStatus, "NO_GATE_COMMAND");
  const outside = join(f.root, "outsider");
  mkdirSync(outside);
  assert.deepEqual(listRecentNativeGateProofs({
    cwd: outside, startedAt: context.promptAt, indexRoot,
  }), []);
}));

test("malformed index entries cannot manufacture gate execution", () => fixture(async f => {
  const indexRoot = join(f.root, "private-index");
  mkdirSync(indexRoot);
  writeFileSync(join(indexRoot, "0".repeat(64) + ".json"),
    JSON.stringify({ schemaVersion: 1, proofPath: "/tmp/unrelated.json",
      sourceRoot: "/tmp/unrelated", executedAt: new Date().toISOString() }));
  const other = join(f.root, "other");
  mkdirSync(other);
  assert.deepEqual(listRecentNativeGateProofs({
    cwd: other, startedAt: new Date(Date.now() - 30000).toISOString(),
    indexRoot,
  }), []);
}));

test("a proof from before the current user turn is not accepted through opaque output or filesystem scanning", () => fixture(async f => {
  const n = nativeGateFixture(f.root);
  assert.equal(runGate({ receipt: n.receipt, baseline: n.baseline,
    ledger: n.ledger, proof: n.proof, workspaceCwd: f.root }).exitCode, 0);
  const old = JSON.parse(readFileSync(n.proof, "utf8"));
  old.executedAt = "2000-01-01T00:00:00.000Z";
  writeFileSync(n.proof, JSON.stringify(old));
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  recordTurnHook({
    ...f.event, hook_event_name: "PostToolUse", tool_name: "functions.exec",
    tool_input: { code: "text({})" },
    tool_response: { content: [{ type: "text", text: JSON.stringify({ proofPath: n.proof }) }] },
  }, { root: f.stateRoot });
  const status = await handleStop({
    ...f.stop, last_assistant_message: "PARTIAL: angeblich abgeschlossen.",
  }, { turnRoot: f.stateRoot });
  assert.equal(status.proofStatus, "NO_GATE_COMMAND");
  assert.equal(status.decision, "block");
}));

test("unstructured functions.exec text is never treated as a gate command", () => fixture(async f => {
  recordTurnHook(f.prompt("Verbessere PCGuardian mit design-with-ai."), { root: f.stateRoot });
  const result = recordTurnHook({
    ...f.event, hook_event_name: "PostToolUse", tool_name: "functions.exec",
    tool_input: { code: 'text("node run-iteration-gate.mjs --receipt receipt.json --proof proof.json")' },
    tool_response: { content: [{ type: "text",
      text: 'node run-iteration-gate.mjs --receipt receipt.json --proof proof.json' }] },
  }, { root: f.stateRoot });
  assert.equal(result.cause, "NOT_RELEVANT");
  const ctx = readTurnContext(f.event, { root: f.stateRoot });
  assert.equal(ctx.gateCommands.length, 0);
  assert.deepEqual(ctx.proofHints, []);
}));
