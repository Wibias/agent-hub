import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectCodexNativeMemoryConfig,
  planCodexNativeMemoryIsolation,
  applyCodexNativeMemoryIsolation,
} from '../../memory-engine/codex-native-memory-isolation.mjs';
import {
  runCodexNativeMemoryIsolation,
} from '../../scripts/isolate-native-codex-memory.mjs';

test('isolation planner disables native Codex memory while preserving unrelated config and comments', () => {
  const input = [
    'model = "gpt-5.6-sol"',
    '',
    '[features]',
    'hooks = true',
    'memories = true # native memory',
    'apps = true',
    '',
    '[memories]',
    'use_memories = true',
    'generate_memories = true # background generation',
    'max_unused_days = 45',
    '',
    '[mcp_servers.example]',
    'command = "example"',
    '',
  ].join('\n');

  const plan = planCodexNativeMemoryIsolation(input);

  assert.equal(plan.changed, true);
  assert.equal(plan.before.featureEnabled, true);
  assert.equal(plan.before.useMemories, true);
  assert.equal(plan.before.generateMemories, true);
  assert.deepEqual(plan.after, {
    featureEnabled: false,
    useMemories: false,
    generateMemories: false,
  });

  assert.equal(plan.nextText, [
    'model = "gpt-5.6-sol"',
    '',
    '[features]',
    'hooks = true',
    'memories = false # native memory',
    'apps = true',
    '',
    '[memories]',
    'use_memories = false',
    'generate_memories = false # background generation',
    'max_unused_days = 45',
    '',
    '[mcp_servers.example]',
    'command = "example"',
    '',
  ].join('\n'));
});

test('isolation planner appends missing sections without rewriting existing config', () => {
  const input = [
    'model = "gpt-5.6-sol"',
    '',
    '[features]',
    'hooks = true',
    '',
  ].join('\n');

  const plan = planCodexNativeMemoryIsolation(input);

  assert.equal(plan.changed, true);
  assert.equal(plan.nextText, [
    'model = "gpt-5.6-sol"',
    '',
    '[features]',
    'hooks = true',
    'memories = false',
    '',
    '[memories]',
    'use_memories = false',
    'generate_memories = false',
    '',
  ].join('\n'));
});

test('isolation planner creates both sections for an empty config', () => {
  const plan = planCodexNativeMemoryIsolation('');

  assert.equal(plan.changed, true);
  assert.equal(plan.nextText, [
    '[features]',
    'memories = false',
    '',
    '[memories]',
    'use_memories = false',
    'generate_memories = false',
    '',
  ].join('\n'));
});

test('isolation planner is idempotent', () => {
  const input = [
    '[features]',
    'memories = false',
    '',
    '[memories]',
    'use_memories = false',
    'generate_memories = false',
    '',
  ].join('\n');

  const plan = planCodexNativeMemoryIsolation(input);

  assert.equal(plan.changed, false);
  assert.equal(plan.nextText, input);
  assert.deepEqual(plan.after, {
    featureEnabled: false,
    useMemories: false,
    generateMemories: false,
  });
});

test('isolation planner fails closed on duplicate target sections or keys', () => {
  assert.throws(
    () => planCodexNativeMemoryIsolation([
      '[features]',
      'memories = true',
      '[features]',
      'hooks = true',
    ].join('\n')),
    /duplicate.*features/i,
  );

  assert.throws(
    () => planCodexNativeMemoryIsolation([
      '[memories]',
      'use_memories = true',
      'use_memories = false',
    ].join('\n')),
    /duplicate.*use_memories/i,
  );
});

test('isolation planner fails closed on non-boolean target values and dotted aliases', () => {
  assert.throws(
    () => planCodexNativeMemoryIsolation([
      '[features]',
      'memories = "yes"',
    ].join('\n')),
    /boolean/i,
  );

  assert.throws(
    () => planCodexNativeMemoryIsolation(
      'features.memories = true\n',
    ),
    /dotted/i,
  );
});

test('config inspector reports unset values without inventing defaults', () => {
  assert.deepEqual(
    inspectCodexNativeMemoryConfig('[features]\nhooks = true\n'),
    {
      featureEnabled: null,
      useMemories: null,
      generateMemories: null,
    },
  );
});

test('apply writes a backup and atomically updates only config.toml', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-native-memory-isolation-'));
  await mkdir(join(root, 'memories'));
  await writeFile(join(root, 'memories', 'MEMORY.md'), 'legacy stays\n');
  await writeFile(join(root, 'memories_1.sqlite'), 'legacy-db');
  await writeFile(join(root, 'hooks.json'), '{"hooks":{}}\n');
  await writeFile(
    join(root, 'config.toml'),
    [
      'model = "gpt-5.6-sol"',
      '',
      '[features]',
      'hooks = true',
      'memories = true',
      '',
      '[memories]',
      'use_memories = true',
      'generate_memories = true',
      '',
    ].join('\n'),
  );

  const result = await applyCodexNativeMemoryIsolation({
    codexHome: root,
    backupSuffix: 'fixture',
  });

  assert.equal(result.changed, true);
  assert.equal(result.backupPath, join(root, 'config.toml.bak-native-memory-fixture'));
  assert.deepEqual(result.settings, {
    featureEnabled: false,
    useMemories: false,
    generateMemories: false,
  });

  assert.match(
    await readFile(join(root, 'config.toml'), 'utf8'),
    /memories = false/,
  );
  assert.match(
    await readFile(result.backupPath, 'utf8'),
    /memories = true/,
  );
  assert.equal(
    await readFile(join(root, 'memories', 'MEMORY.md'), 'utf8'),
    'legacy stays\n',
  );
  assert.equal(
    await readFile(join(root, 'memories_1.sqlite'), 'utf8'),
    'legacy-db',
  );
  assert.equal(
    await readFile(join(root, 'hooks.json'), 'utf8'),
    '{"hooks":{}}\n',
  );
});

test('apply is idempotent and does not create another backup when already isolated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-native-memory-idempotent-'));
  await writeFile(
    join(root, 'config.toml'),
    [
      '[features]',
      'memories = false',
      '',
      '[memories]',
      'use_memories = false',
      'generate_memories = false',
      '',
    ].join('\n'),
  );

  const result = await applyCodexNativeMemoryIsolation({
    codexHome: root,
    backupSuffix: 'fixture',
  });

  assert.equal(result.changed, false);
  assert.equal(result.backupPath, null);
});


test('CLI defaults to dry-run and leaves real state untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-native-memory-cli-dry-'));
  await mkdir(join(root, 'memories'));
  await writeFile(join(root, 'memories', 'MEMORY.md'), 'legacy stays\n');
  await writeFile(join(root, 'memories_1.sqlite'), 'legacy-db');
  await writeFile(join(root, 'hooks.json'), '{"hooks":{}}\n');
  await writeFile(
    join(root, 'config.toml'),
    [
      '[features]',
      'memories = true',
      '',
      '[memories]',
      'use_memories = true',
      'generate_memories = true',
      '',
    ].join('\n'),
  );

  const beforeConfig = await readFile(join(root, 'config.toml'), 'utf8');
  const lines = [];

  const output = await runCodexNativeMemoryIsolation({
    argv: ['--codex-home', root],
    env: {},
    log(value) {
      lines.push(value);
    },
  });

  assert.equal(output.mode, 'dry-run');
  assert.equal(output.changed, true);
  assert.equal(output.backup_required, true);
  assert.deepEqual(output.after, {
    featureEnabled: false,
    useMemories: false,
    generateMemories: false,
  });
  assert.deepEqual(output.direct_memory, ['memories', 'memories_1.sqlite']);
  assert.equal(
    await readFile(join(root, 'config.toml'), 'utf8'),
    beforeConfig,
  );
  assert.equal(
    await readFile(join(root, 'memories', 'MEMORY.md'), 'utf8'),
    'legacy stays\n',
  );
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), output);
});

test('CLI apply changes config only and reports restart requirement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-native-memory-cli-apply-'));
  await mkdir(join(root, 'memories'));
  await writeFile(join(root, 'memories', 'MEMORY.md'), 'legacy stays\n');
  await writeFile(join(root, 'memories_1.sqlite'), 'legacy-db');
  await writeFile(join(root, 'hooks.json'), '{"hooks":{}}\n');
  await writeFile(
    join(root, 'config.toml'),
    [
      '[features]',
      'memories = true',
      '',
      '[memories]',
      'use_memories = true',
      'generate_memories = true',
      '',
    ].join('\n'),
  );

  const lines = [];
  const output = await runCodexNativeMemoryIsolation({
    argv: ['--codex-home', root, '--apply'],
    env: {},
    log(value) {
      lines.push(value);
    },
  });

  assert.equal(output.mode, 'apply');
  assert.equal(output.changed, true);
  assert.equal(output.restart_required, true);
  assert.equal(output.direct_memory_preserved, true);
  assert.deepEqual(output.direct_memory, ['memories', 'memories_1.sqlite']);
  assert.deepEqual(output.settings, {
    featureEnabled: false,
    useMemories: false,
    generateMemories: false,
  });
  assert.match(
    await readFile(join(root, 'config.toml'), 'utf8'),
    /memories = false/,
  );
  assert.equal(
    await readFile(join(root, 'memories_1.sqlite'), 'utf8'),
    'legacy-db',
  );
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), output);
});
