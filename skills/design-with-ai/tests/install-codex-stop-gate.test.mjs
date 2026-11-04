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
  writeFileSync(join(skillDir, "scripts", "codex-stop-gate.mjs"), "/* test hook */\n");
  try { return run({ root, skillDir, hooksPath }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("installer is dry-run by default and does not create a hooks file", () => fixture((f) => {
  const result = installCodexStopGate(f);
  assert.equal(result.applied, false);
  assert.equal(result.wouldChange, true);
  assert.equal(existsSync(f.hooksPath), false);
}));

test("installer preserves existing Stop hooks and other events", () => fixture((f) => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  const original = {
    description: "Keep other agents working",
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "node other-stop-hook.mjs" }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "node user-hook.mjs" }] }],
    },
  };
  writeFileSync(f.hooksPath, JSON.stringify(original));
  const result = installCodexStopGate({ ...f, apply: true });
  const updated = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  assert.equal(result.applied, true);
  assert.ok(result.backupPath && existsSync(result.backupPath));
  assert.equal(updated.description, original.description);
  assert.deepEqual(updated.hooks.UserPromptSubmit, original.hooks.UserPromptSubmit);
  assert.deepEqual(updated.hooks.Stop[0], original.hooks.Stop[0]);
  assert.match(updated.hooks.Stop[1].hooks[0].command, /codex-stop-gate\.mjs/);
  assert.equal(updated.hooks.Stop[1].hooks[0].timeout, 15);
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

test("existing custom entries survive replacement of old design hook entry", () => fixture((f) => {
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
  const stop = JSON.parse(readFileSync(f.hooksPath, "utf8")).hooks.Stop;
  assert.equal(stop.length, 2);
  assert.equal(stop[0].hooks[0].command, "node other-hook.mjs");
  assert.match(stop[1].hooks[0].command, /codex-stop-gate/);
}));

test("installer refuses to replace malformed Stop registry", () => fixture((f) => {
  mkdirSync(join(f.root, "codex"), { recursive: true });
  writeFileSync(f.hooksPath, JSON.stringify({ hooks: { Stop: "corrupt" } }));
  assert.throws(() => installCodexStopGate({ ...f, apply: true }), /hooks.Stop must be an array/);
}));
