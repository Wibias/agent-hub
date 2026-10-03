import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  retiredCodexRuntimeProfileInstallerStatus,
} from '../../scripts/install-codex-runtime-profiles.mjs';
import {
  parseRetireArgs,
  planLegacyCodexProfileRetirement,
  retireLegacyCodexProfiles,
} from '../../scripts/retire-codex-runtime-profiles.mjs';

test('old runtime profile installer is permanently retired and points to launcher plus cleanup', () => {
  const status = retiredCodexRuntimeProfileInstallerStatus();
  assert.equal(status.status, 'retired');
  assert.match(status.reason, /mutable user configuration/i);
  assert.match(status.replacement, /run-codex-runtime\.mjs/);
  assert.match(status.cleanup, /retire-codex-runtime-profiles\.mjs/);
});

test('legacy profile retirement dry-run reports only Agent Hub profile namespace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-retire-profiles-plan-'));
  try {
    const codexHome = join(root, '.codex');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'agent-hub-diagnose.config.toml'),
      'model_reasoning_effort = "low"\nmodel = "gpt-6.1-sol"\n',
    );
    writeFileSync(
      join(codexHome, 'personal.config.toml'),
      'model_reasoning_effort = "xhigh"\n',
    );
    writeFileSync(
      join(codexHome, 'config.toml'),
      'model_reasoning_effort = "low"\n',
    );

    const plan = planLegacyCodexProfileRetirement({ codexHome });
    assert.equal(plan.wouldChange, true);
    assert.deepEqual(plan.profiles.map((item) => item.file), [
      'agent-hub-diagnose.config.toml',
    ]);
    assert.equal(
      readFileSync(join(codexHome, 'personal.config.toml'), 'utf8'),
      'model_reasoning_effort = "xhigh"\n',
    );
    assert.equal(
      readFileSync(join(codexHome, 'config.toml'), 'utf8'),
      'model_reasoning_effort = "low"\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy profile retirement backs up exact current bytes before removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-retire-profiles-apply-'));
  try {
    const codexHome = join(root, '.codex');
    mkdirSync(codexHome, { recursive: true });
    const profile = join(codexHome, 'agent-hub-diagnose.config.toml');
    const mutated = 'model_reasoning_effort = "low"\nmodel = "gpt-6.1-sol"\n';
    writeFileSync(profile, mutated);

    const result = retireLegacyCodexProfiles({
      codexHome,
      apply: true,
    });

    assert.equal(result.applied, true);
    assert.equal(result.backups.length, 1);
    assert.equal(result.backups[0].file, 'agent-hub-diagnose.config.toml');
    assert.equal(readFileSync(result.backups[0].path, 'utf8'), mutated);
    assert.equal(existsSync(profile), false);

    const second = retireLegacyCodexProfiles({
      codexHome,
      apply: true,
    });
    assert.equal(second.wouldChange, false);
    assert.equal(second.applied, false);
    assert.deepEqual(second.backups, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy profile retirement preserves unrelated Codex files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-retire-profiles-other-'));
  try {
    const codexHome = join(root, '.codex');
    mkdirSync(codexHome, { recursive: true });
    const config = join(codexHome, 'config.toml');
    const other = join(codexHome, 'team.config.toml');
    writeFileSync(config, 'model = "custom"\n');
    writeFileSync(other, 'model_reasoning_effort = "high"\n');

    retireLegacyCodexProfiles({
      codexHome,
      apply: true,
    });

    assert.equal(readFileSync(config, 'utf8'), 'model = "custom"\n');
    assert.equal(
      readFileSync(other, 'utf8'),
      'model_reasoning_effort = "high"\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy profile retirement refuses symlinked Agent Hub profile', async (t) => {
  if (process.platform === 'win32') {
    t.skip('symlink creation may require elevated Windows privileges');
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'agent-hub-retire-profiles-link-'));
  try {
    const codexHome = join(root, '.codex');
    mkdirSync(codexHome, { recursive: true });
    const real = join(root, 'real.toml');
    writeFileSync(real, 'model_reasoning_effort = "low"\n');
    symlinkSync(real, join(codexHome, 'agent-hub-diagnose.config.toml'));

    assert.throws(
      () => planLegacyCodexProfileRetirement({ codexHome }),
      /symlinked legacy Agent Hub profile/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy profile retirement parser is dry-run by default', () => {
  assert.deepEqual(parseRetireArgs([]), {
    apply: false,
    codexHome: undefined,
  });
  assert.deepEqual(
    parseRetireArgs([
      '--apply',
      '--codex-home', '/state/.codex',
    ]),
    {
      apply: true,
      codexHome: '/state/.codex',
    },
  );
  assert.throws(
    () => parseRetireArgs(['--wat']),
    /Unknown option/,
  );
});
