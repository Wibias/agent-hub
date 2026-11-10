import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectSkillLinks,
  listHubSkills,
  planClaudeHooks,
  runClaudeHostSetup,
} from '../../scripts/setup-claude-host.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'agent-hub-claude-'));
}

function writeSkill(root, name, body = '') {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(
    join(root, name, 'SKILL.md'),
    '---\nname: ' + name + '\n---\n' + body,
    'utf8',
  );
}

test('hub skill discovery skips reserved, hidden, and non-skill directories', () => {
  const root = tempDir();
  try {
    writeSkill(root, 'alpha');
    writeSkill(root, 'beta');
    writeSkill(root, '.hidden');
    writeSkill(root, 'synced');
    writeSkill(root, 'anthropic-skills');
    mkdirSync(join(root, 'not-a-skill'));

    assert.deepEqual(
      listHubSkills(root).map((skill) => skill.name),
      ['alpha', 'beta'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function hookCommands(hooks) {
  return Object.values(hooks)
    .flatMap((groups) => groups)
    .flatMap((group) => group.hooks ?? [])
    .map((hook) => hook.command);
}

test('hook planning removes RTK, installs Codex-parity events, and is idempotent', () => {
  const settings = {
    model: 'opus[1m]',
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'user-owned-hook' }] },
      ],
    },
  };

  const first = planClaudeHooks(settings, {
    hubRoot: 'C:/hub',
    nodePath: 'C:/node/node.exe',
  });
  assert.equal(first.changed, true);
  assert.equal(first.settings.hooks.PreToolUse, undefined);
  assert.deepEqual(
    Object.keys(first.settings.hooks).sort(),
    ['SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit'],
  );
  assert.equal(first.settings.hooks.UserPromptSubmit.length, 2);
  assert.equal(first.settings.hooks.Stop[0].hooks.length, 2);
  assert.equal(first.settings.hooks.Stop[0].hooks[1].async, true);

  const commands = hookCommands(first.settings.hooks);
  assert.equal(commands.some((command) => command.includes('claude-code-full-hook-cli.mjs')), true);
  assert.equal(commands.some((command) => command.includes('embedding-worker-launcher.mjs')), true);
  assert.equal(commands.some((command) => command.includes('claude-code-agent-memory-pipeline-hook.mjs')), true);
  assert.equal(commands.some((command) => command.includes('--candidate-capture')), true);

  const second = planClaudeHooks(first.settings, {
    hubRoot: 'C:/hub',
    nodePath: 'C:/node/node.exe',
  });
  assert.equal(second.changed, false);

  const disabled = planClaudeHooks(first.settings, {
    hubRoot: 'C:/hub',
    nodePath: 'C:/node/node.exe',
    manageHooks: false,
  });
  assert.equal(disabled.settings.hooks.UserPromptSubmit.length, 1);
  assert.equal(disabled.settings.hooks.SessionStart, undefined);
});

test('an existing CLAUDE.md without the hub import is reported, not rewritten', () => {
  const workspace = tempDir();
  const hubRoot = join(workspace, 'hub');
  const claudeHome = join(workspace, 'claude');

  try {
    writeSkill(join(hubRoot, 'skills'), 'alpha');
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, 'CLAUDE.md'), '# My own rules\n', 'utf8');

    const result = runClaudeHostSetup({
      apply: true,
      hubRoot,
      claudeHome,
      memoryHook: false,
      nodePath: process.execPath,
    });

    assert.equal(result.status, 'attention_required');
    assert.equal(result.applied.claudeMd, false);
    assert.equal(readFileSync(join(claudeHome, 'CLAUDE.md'), 'utf8'), '# My own rules\n');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('host setup creates, refreshes, and prunes managed skill links', () => {
  const workspace = tempDir();
  const hubRoot = join(workspace, 'hub');
  const claudeHome = join(workspace, 'claude');
  const hubSkills = join(hubRoot, 'skills');
  const claudeSkills = join(claudeHome, 'skills');

  try {
    writeSkill(hubSkills, 'alpha');
    mkdirSync(join(hubRoot, 'memory-engine', 'adapters'), { recursive: true });
    writeFileSync(
      join(hubRoot, 'memory-engine', 'adapters', 'claude-code-hook-cli.mjs'),
      '// fixture\n',
    );
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(
      join(claudeHome, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] },
          ],
        },
      }),
      'utf8',
    );

    const plan = runClaudeHostSetup({ hubRoot, claudeHome, nodePath: process.execPath });
    assert.equal(plan.status, 'changes_required');
    assert.equal(plan.plan.skills.links[0].status, 'missing');
    assert.equal(plan.plan.hooks.changed, true);

    const applied = runClaudeHostSetup({
      apply: true,
      hubRoot,
      claudeHome,
      nodePath: process.execPath,
    });
    assert.equal(applied.status, 'healthy');
    assert.equal(applied.mutationsApplied, true);
    assert.equal(applied.applied.linksCreated, 1);
    assert.equal(applied.applied.hooks, true);

    const linkPath = join(claudeSkills, 'alpha');
    assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
    assert.match(readFileSync(join(linkPath, 'SKILL.md'), 'utf8'), /name: alpha/);

    const claudeMd = readFileSync(join(claudeHome, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /AGENTS\.md/);

    const settings = JSON.parse(readFileSync(join(claudeHome, 'settings.json'), 'utf8'));
    assert.equal(settings.hooks.PreToolUse, undefined);
    assert.deepEqual(
      Object.keys(settings.hooks).sort(),
      ['SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit'],
    );
    assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /claude-code-full-hook-cli/);
    assert.match(settings.hooks.SessionStart[0].hooks[0].command, /embedding-worker-launcher/);
    assert.equal(settings.hooks.Stop[0].hooks.length, 2);
    assert.match(settings.hooks.Stop[0].hooks[1].command, /claude-code-agent-memory-pipeline-hook/);
    assert.equal(applied.applied.settingsBackupPath !== null, true);
    assert.equal(existsSync(applied.applied.settingsBackupPath), true);

    const steady = runClaudeHostSetup({ hubRoot, claudeHome, nodePath: process.execPath });
    assert.equal(steady.status, 'healthy');

    writeSkill(hubSkills, 'beta');
    const withBeta = inspectSkillLinks({ hubSkillsDir: hubSkills, claudeSkillsDir: claudeSkills });
    assert.deepEqual(
      withBeta.links.filter((link) => link.status === 'missing').map((link) => link.name),
      ['beta'],
    );

    rmSync(join(hubSkills, 'alpha'), { recursive: true, force: true });
    const afterRemoval = inspectSkillLinks({ hubSkillsDir: hubSkills, claudeSkillsDir: claudeSkills });
    assert.deepEqual(afterRemoval.stale.map((entry) => entry.name), ['alpha']);

    const pruned = runClaudeHostSetup({
      apply: true,
      hubRoot,
      claudeHome,
      nodePath: process.execPath,
    });
    assert.equal(pruned.applied.linksPruned, 1);
    assert.equal(existsSync(linkPath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
