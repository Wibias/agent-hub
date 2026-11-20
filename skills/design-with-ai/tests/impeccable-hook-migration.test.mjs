import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = path.join(root, 'internal', 'impeccable', 'scripts', 'hook-admin.mjs');

function invoke(cwd, action) {
  const result = spawnSync(process.execPath, [admin, action], {
    cwd, encoding: 'utf8', timeout: 12000,
    windowsHide: true,
    env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
  });
  assert.equal(result.status, 0, `${action} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

test('hook activation is explicit, migrates old entries and preserves unrelated Codex hooks',
  { timeout: 30000 },
  () => {
    const project = mkdtempSync(path.join(tmpdir(), 'dwa-impeccable-hooks-'));
    try {
      const skillDir = path.join(project, '.agents', 'skills', 'design-with-ai', 'internal', 'impeccable');
      mkdirSync(skillDir, { recursive: true });
      const codex = path.join(project, '.codex');
      mkdirSync(codex);
      const hookFile = path.join(codex, 'hooks.json');
      writeFileSync(hookFile, JSON.stringify({
        version: 1,
        hooks: { Stop: [
          { hooks: [{ type: 'command', command: 'node ".agents/skills/impeccable/scripts/hook.mjs"' }] },
          { hooks: [{ type: 'command', command: 'echo unrelated-contract' }] },
        ] },
      }, null, 2));
      const configPath = path.join(project, '.impeccable', 'config.json');

      // Legacy config defaults to enabled, but merely asking for status
      // must not write config or activate/update hook manifests.
      const beforeStatus = readFileSync(hookFile, 'utf8');
      assert.ok(invoke(project, 'status').includes('state:        enabled'));
      assert.equal(readFileSync(hookFile, 'utf8'), beforeStatus,
        'status must be read-only');
      assert.equal(existsSync(configPath), false, 'status must not create configuration');
      assert.match(invoke(project, 'on'), /enabled for this project/);
      const raw = readFileSync(hookFile, 'utf8');
      assert.ok(raw.includes('skills/design-with-ai/internal/impeccable/scripts/hook.mjs'), 'new hook path must be installed');
      assert.equal(raw.includes('.agents/skills/impeccable/scripts/hook.mjs'), false, 'legacy hook path must be retired');
      assert.match(raw, /echo unrelated-contract/);
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      assert.equal(config.hook.enabled, true);
      assert.match(invoke(project, 'status'), /enabled/);
      assert.match(invoke(project, 'off'), /disabled for this project/);
      const disabled = JSON.parse(readFileSync(configPath, 'utf8'));
      assert.equal(disabled.hook.enabled, false);
      assert.match(readFileSync(hookFile, 'utf8'), /echo unrelated-contract/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });


test('explicit hooks on upgrades shared Claude legacy commands without erasing other hooks',
  { timeout: 30000 },
  () => {
    const project = mkdtempSync(path.join(tmpdir(), 'dwa-impeccable-claude-hooks-'));
    try {
      mkdirSync(path.join(project, '.claude', 'skills', 'design-with-ai', 'internal', 'impeccable'), { recursive: true });
      const settings = path.join(project, '.claude', 'settings.json');
      const local = path.join(project, '.claude', 'settings.local.json');
      writeFileSync(settings, JSON.stringify({
        description: 'project-owned settings',
        custom: { marker: 'keep me' },
        hooks: {
          PostToolUse: [
            { matcher: 'Edit|Write', hooks: [
              { type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"' },
            ] },
            { matcher: 'Read', hooks: [{ type: 'command', command: 'echo keep-other-shared-hook' }] },
          ],
        },
      }, null, 2));
      writeFileSync(local, JSON.stringify({
        hooks: { Stop: [{ hooks: [
          { type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"' },
          { type: 'command', command: 'echo keep-other-local-hook' },
        ] }] },
      }, null, 2));
      const baseline = readFileSync(settings, 'utf8');
      invoke(project, 'status');
      assert.equal(readFileSync(settings, 'utf8'), baseline, 'status must not mutate shared hooks');
      invoke(project, 'on');
      const nextShared = readFileSync(settings, 'utf8');
      const nextLocal = readFileSync(local, 'utf8');
      assert.equal(nextShared.includes('.claude/skills/impeccable/scripts/hook.mjs'), false);
      assert.ok(nextShared.includes('.claude/skills/design-with-ai/internal/impeccable/scripts/hook.mjs'));
      assert.ok(nextShared.includes('keep-other-shared-hook'));
      assert.ok(nextShared.includes('project-owned settings'));
      assert.ok(nextShared.includes('keep me'));
      assert.equal(nextLocal.includes('.claude/skills/impeccable/scripts/hook.mjs'), false);
      assert.ok(nextLocal.includes('keep-other-local-hook'));
      // Re-running explicit activation must not add duplicate managed commands.
      invoke(project, 'on');
      assert.equal(readFileSync(settings, 'utf8'), nextShared);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
