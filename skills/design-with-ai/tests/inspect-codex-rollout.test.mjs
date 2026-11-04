import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectRollout } from "../scripts/inspect-codex-rollout.mjs";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/inspect-codex-rollout.mjs");
function fixture(events, fn) {
  const dir = mkdtempSync(join(tmpdir(), "design-codex-trace-"));
  const path = join(dir, "rollout.jsonl");
  try {
    writeFileSync(path, events.map(JSON.stringify).join("\n") + "\n");
    return fn(path);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const meta = (cwd) => ({ type: "session_meta", payload: { cwd } });
const call = (name, id, args) => ({
  type: "response_item", payload: { type: "function_call", name, call_id: id, arguments: JSON.stringify(args) },
});
const custom = (name, id, args) => ({
  type: "response_item", payload: { type: "custom_tool_call", name, call_id: id, input: args },
});
const output = (id, text) => ({
  type: "response_item", payload: { type: "function_call_output", call_id: id, output: text },
});

test("counts skill references but not as proof of skill invocation", async () => {
  await fixture([
    meta("C:/project"),
    call("functions.exec", "c1", { cmd: "Get-Content C:/hub/skills/design-with-ai/SKILL.md" }),
    output("c1", "Process exited with code 0"),
    call("exec_command", "c2", { cmd: "echo design-with-ai was mentioned" }),
  ], async (path) => {
    const r = await inspectRollout(path);
    assert.equal(r.project, "C:/project");
    assert.equal(r.totalToolCalls, 2);
    assert.equal(r.skillReferencedToolCalls, 2);
    assert.equal(r.skillFileArgumentCalls, 1);
    assert.equal(r.gateExecution, "NOT_OBSERVED_IN_THIS_LOG");
    assert.equal(r.gateInvocationCandidates, 0);
  });
});

test("correlates a gate invocation candidate with its actual tool exit", async () => {
  await fixture([
    call("functions.exec", "call-1", { command: 'node "C:/hub/skills/design-with-ai/scripts/verify-iteration-receipt.mjs" --receipt receipt.json --baseline prior.json' }),
    output("call-1", "Process exited with code 0\n{\"valid\":true}"),
  ], async (path) => {
    const r = await inspectRollout(path);
    assert.equal(r.gateMentionToolCalls, 1);
    assert.equal(r.gateInvocationCandidates, 1);
    assert.equal(r.gateInvocationWithObservedExit, 1);
    assert.equal(r.gateExecution, "CANDIDATE_WITH_EXIT_ZERO");
    assert.equal(r.evidence[0].observedExitCode, 0);
  });
});

test("observes nonzero gate exit and does not report successful gate execution", async () => {
  await fixture([
    custom("exec_command", "c1", "node ./skills/design-with-ai/scripts/verify-iteration-receipt.mjs --receipt receipt.json"),
    output("c1", "{\"exit_code\": 1, \"valid\": false}"),
  ], async (path) => {
    const r = await inspectRollout(path);
    assert.equal(r.gateExecution, "CANDIDATE_WITH_NONZERO_EXIT");
    assert.equal(r.evidence[0].observedExitCode, 1);
  });
});

test("distinguishes mentioning the gate in grep text from an executed command", async () => {
  await fixture([
    call("exec_command", "c1", { cmd: "rg verify-iteration-receipt.mjs skills/design-with-ai" }),
    output("c1", "Process exited with code 0"),
    call("exec_command", "c2", { cmd: "echo 'node verify-iteration-receipt.mjs' > notes.txt" }),
  ], async (path) => {
    const r = await inspectRollout(path);
    assert.equal(r.gateMentionToolCalls, 2);
    assert.equal(r.gateInvocationCandidates, 0);
    assert.equal(r.gateExecution, "NOT_OBSERVED_IN_THIS_LOG");
  });
});

test("missing tool return leaves gate candidate unverified rather than claiming success", async () => {
  await fixture([
    call("exec_command", "c1", { command: "node ./skills/design-with-ai/scripts/verify-iteration-receipt.mjs --receipt x.json" }),
  ], async (path) => {
    const r = await inspectRollout(path);
    assert.equal(r.gateExecution, "CANDIDATE_WITHOUT_EXIT_EVIDENCE");
  });
});

test("ignores malformed entries, supports project metadata, and redacts tool arguments", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-trace-malformed-"));
  const path = join(dir, "rollout.jsonl");
  try {
    writeFileSync(path, 'not-json\n' + [
      meta("C:/sensitive-repo"),
      call("exec_command", "c1", { command: "echo super-secret-token; Get-Content skills/design-with-ai/SKILL.md" }),
    ].map(JSON.stringify).join("\n"));
    const r = await inspectRollout(path);
    assert.equal(r.invalidLines, 1);
    assert.equal(r.skillReferencedToolCalls, 1);
    assert.doesNotMatch(JSON.stringify(r), /super-secret-token/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI emits redacted JSON without dumping full session messages", async () => {
  await fixture([meta("C:/project"), call("exec_command", "c1", { cmd: "Get-Content skills/design-with-ai/SKILL.md" })], async (path) => {
    const r = spawnSync(process.execPath, [cli, "--log", path], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).skillReferencedToolCalls, 1);
  });
});
