import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installCodexStopGate, planInstall } from "../scripts/install-codex-stop-gate.mjs";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "design-stop-install-"));
  const skillDir = join(root, "skills", "design-with-ai");
  const hooksPath = join(root, "codex", "hooks.json");
  mkdirSync(join(skillDir, "scripts"), { recursive: true });
  writeFileSync(join(skillDir, "scripts", "codex-stop-gate.mjs"), "/* stop test hook */\n");
  writeFileSync(join(skillDir, "scripts", "codex-turn-context.mjs"), "/* context test hook */\n");
  try { return run({ root, skillDir, hooksPath }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("installer is dry-run by default and does not create a hooks file", () => fixture((f) => {
  const result = installCodexStopGate(f);
  assert.equal(result.applied, false);
  assert.equal(result.wouldChange, true);
  assert.equal(existsSync(f.hooksPath), false);
  assert.deepEqual(result.hooks, ["UserPromptSubmit", "PostToolUse", "Stop"]);
}));

test("installer preserves existing Stop, prompt, tool hooks and other config", () => fixture((f) => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  const original = {
    description: "Keep other agents working",
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "node other-stop-hook.mjs" }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "node user-hook.mjs" }] }],
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node audit-hook.mjs" }] }],
      SubagentStop: [{ hooks: [{ type: "command", command: "node subagent-hook.mjs" }] }],
    },
  };
  writeFileSync(f.hooksPath, JSON.stringify(original));
  const result = installCodexStopGate({ ...f, apply: true });
  const updated = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  assert.equal(result.applied, true);
  assert.ok(result.backupPath && existsSync(result.backupPath));
  assert.equal(updated.description, original.description);
  for (const event of ["Stop", "UserPromptSubmit", "PostToolUse"]) {
    assert.deepEqual(updated.hooks[event][0], original.hooks[event][0]);
    assert.equal(updated.hooks[event].length, 2);
    assert.match(updated.hooks[event][1].hooks[0].command, /codex-(?:stop-gate|turn-context)\.mjs/);
    assert.equal(updated.hooks[event][1].hooks[0].timeout, 15);
  }
  assert.equal(updated.hooks.PostToolUse[1].matcher, "Bash|exec_command|functions\\.exec");
  assert.deepEqual(updated.hooks.SubagentStop, original.hooks.SubagentStop);
}));

test("rerunning installer is idempotent with no extra backups", () => fixture((f) => {
  installCodexStopGate({ ...f, apply: true });
  const first = readFileSync(f.hooksPath, "utf8");
  assert.equal(planInstall(f).changed, false);
  const again = installCodexStopGate({ ...f, apply: true });
  assert.equal(again.applied, false);
  assert.equal(again.backupPath, null);
  assert.equal(readFileSync(f.hooksPath, "utf8"), first);
}));

test("installer rejects malformed JSON without modifying it", () => fixture((f) => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  writeFileSync(f.hooksPath, "broken");
  assert.throws(() => installCodexStopGate({ ...f, apply: true }), /JSON/);
  assert.equal(readFileSync(f.hooksPath, "utf8"), "broken");
}));

test("existing custom entries survive replacement of old design Stop hook entry", () => fixture((f) => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  writeFileSync(f.hooksPath, JSON.stringify({
    hooks: { Stop: [
      { hooks: [
        { type: "command", command: 'node "/older/skills/design-with-ai/scripts/codex-stop-gate.mjs"' },
        { type: "command", command: "node other-hook.mjs" },
      ] },
    ] },
  }));
  installCodexStopGate({ ...f, apply: true });
  const config = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  assert.equal(config.hooks.Stop.length, 2);
  assert.equal(config.hooks.Stop[0].hooks[0].command, "node other-hook.mjs");
  assert.match(config.hooks.Stop[1].hooks[0].command, /codex-stop-gate/);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  assert.equal(config.hooks.PostToolUse.length, 1);
}));

test("installer refuses malformed event registry instead of overwriting it", () => fixture((f) => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  writeFileSync(f.hooksPath, JSON.stringify({ hooks: { PostToolUse: "corrupt" } }));
  assert.throws(() => installCodexStopGate({ ...f, apply: true }), /Hook event registry must be an array/);
}));

test("installer fails safely when supporting native context script is missing", () => fixture((f) => {
  rmSync(join(f.skillDir, "scripts", "codex-turn-context.mjs"));
  assert.throws(() => installCodexStopGate({ ...f, apply: true }), /Codex hook script is missing/);
  assert.equal(existsSync(f.hooksPath), false);
}));

test("standalone Impeccable Stop hook is retained unless removal is explicitly requested", () => fixture(f => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  const old = String.raw`if (Test-Path 'X:\Fixture\.agents\skills\impeccable\scripts\hook.mjs') { node 'X:\Fixture\.agents\skills\impeccable\scripts\hook.mjs'; exit $LASTEXITCODE }`;
  writeFileSync(f.hooksPath, JSON.stringify({ hooks: { Stop: [
    { hooks: [{ type: "command", command: old, commandWindows: old }] },
  ] } }));
  installCodexStopGate({ ...f, apply: true });
  const current = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  assert.equal(current.hooks.Stop.length, 2);
  assert.match(current.hooks.Stop[0].hooks[0].command, /impeccable/);
}));

test("opt-in cleanup removes only standalone Impeccable hooks across events, makes backup and keeps all unrelated hooks", () => fixture(f => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  const legacy = String.raw`if (Test-Path 'X:\Fixture\.agents\skills\impeccable\scripts\hook.mjs') { node 'X:\Fixture\.agents\skills\impeccable\scripts\hook.mjs'; exit $LASTEXITCODE }`;
  const original = {
    description: "Preserve independent integrations",
    hooks: {
      Stop: [
        { matcher: "", hooks: [
          { command: "node github-delivery/scripts/codex-watchdog-hook.mjs", type: "command" },
          { command: "node memory-engine/adapters/codex-passive-memory-hook-cli.mjs", type: "command" },
        ] },
        { matcher: "", hooks: [{ type: "command", command: "node legacy",
          commandWindows: legacy }] },
        { hooks: [
          { command: "node other-hook.mjs", type: "command" },
          { command: 'node "X:\\Fixture\\.agents\\skills\\impeccable\\scripts\\hook.mjs"', type: "command" },
        ] },
      ],
      UserPromptSubmit: [{ hooks: [{ command: "node user-hook.mjs", type: "command" }] }],
      PostToolUse: [{ matcher: "Bash", hooks: [{
        command: "node impeccable/scripts/something-hook.mjs", type: "command",
      }, { command: "node audit-hook.mjs", type: "command" }] }],
      SubagentStop: [{ hooks: [{ command: "node subagent-hook.mjs", type: "command" }] }],
    },
  };
  writeFileSync(f.hooksPath, JSON.stringify(original));
  const dry = installCodexStopGate({ ...f, removeImpeccableHooks: true });
  assert.equal(dry.plannedImpeccableHookRemoval, 3);
  assert.equal(dry.removedImpeccableHooks, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.hooksPath, "utf8")), original);
  const result = installCodexStopGate({ ...f, removeImpeccableHooks: true, apply: true });
  assert.equal(result.removedImpeccableHooks, 3);
  assert.ok(result.backupPath && existsSync(result.backupPath));
  assert.deepEqual(JSON.parse(readFileSync(result.backupPath, "utf8")), original);
  const updated = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  assert.equal(updated.description, original.description);
  assert.equal(updated.hooks.Stop.length, 3);
  assert.equal(updated.hooks.Stop[0].hooks.length, 2);
  assert.equal(updated.hooks.Stop[1].hooks[0].command, "node other-hook.mjs");
  assert.match(updated.hooks.Stop[2].hooks[0].command, /design-with-ai/);
  assert.equal(updated.hooks.PostToolUse[0].hooks.length, 1);
  assert.equal(updated.hooks.PostToolUse[0].hooks[0].command, "node audit-hook.mjs");
  assert.deepEqual(updated.hooks.SubagentStop, original.hooks.SubagentStop);
  assert.equal(updated.hooks.UserPromptSubmit[0].hooks[0].command, "node user-hook.mjs");
  const again = installCodexStopGate({ ...f, removeImpeccableHooks: true, apply: true });
  assert.equal(again.removedImpeccableHooks, 0);
  assert.equal(again.applied, false);
  assert.equal(again.backupPath, null);
}));

test("opt-in Impeccable removal preserves unrelated Impeccable skill references and unrelated JavaScript", () => fixture(f => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  const original = { hooks: { Stop: [
    { hooks: [{ type: "command", command: "node design-with-ai/scripts/codex-stop-gate.mjs" }] },
    { hooks: [{ type: "command", command: "node impeccable/scripts/render-tokens.mjs" }] },
    { hooks: [{ type: "command", command: "node other-project/scripts/hook.mjs" }] },
  ] } };
  writeFileSync(f.hooksPath, JSON.stringify(original));
  installCodexStopGate({ ...f, removeImpeccableHooks: true, apply: true });
  const updated = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  assert.ok(updated.hooks.Stop.some(group =>
    group.hooks.some(x => x.command.includes("impeccable/scripts/render-tokens.mjs"))));
  assert.ok(updated.hooks.Stop.some(group =>
    group.hooks.some(x => x.command.includes("other-project/scripts/hook.mjs"))));
}));
