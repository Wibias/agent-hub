import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  installCodexRuntimeProfiles,
  parseCodexRuntimeProfileInstallArgs,
  planCodexRuntimeProfiles,
} from '../../scripts/install-codex-runtime-profiles.mjs';

function writeFixtureProfiles(root) {
  const profilesDir = join(root, 'generated');
  mkdirSync(profilesDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    host: 'codex',
    activation: {
      mode: 'manual-profile',
      command: 'codex --profile <profile>',
      configRoot: '$CODEX_HOME',
    },
    mappedRuntimeFields: ['reasoning'],
    unmappedRuntimeFields: ['isolation', 'mutation'],
    profiles: [
      {
        skill: 'diagnose',
        profile: 'agent-hub-diagnose',
        file: 'agent-hub-diagnose.config.toml',
        mapped: { reasoning: 'high' },
        unmapped: { isolation: 'prefer' },
      },
      {
        skill: 'writing-ticks',
        profile: 'agent-hub-writing-ticks',
        file: 'agent-hub-writing-ticks.config.toml',
        mapped: { reasoning: 'low' },
        unmapped: {},
      },
    ],
    unrendered: [],
  };
  writeFileSync(
    join(profilesDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  writeFileSync(
    join(profilesDir, 'agent-hub-diagnose.config.toml'),
    'model_reasoning_effort = "high"\n',
  );
  writeFileSync(
    join(profilesDir, 'agent-hub-writing-ticks.config.toml'),
    'model_reasoning_effort = "low"\n',
  );
  return profilesDir;
}

test('profile installer dry-run classifies install/current/update without mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-profiles-plan-'));
  const profilesDir = writeFixtureProfiles(root);
  const codexHome = join(root, '.codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    join(codexHome, 'agent-hub-diagnose.config.toml'),
    'model_reasoning_effort = "high"\n',
  );
  writeFileSync(
    join(codexHome, 'agent-hub-writing-ticks.config.toml'),
    'model_reasoning_effort = "medium"\n',
  );
  writeFileSync(
    join(codexHome, 'config.toml'),
    'model = "leave-me-alone"\n',
  );

  try {
    const plan = planCodexRuntimeProfiles({
      profilesDir,
      codexHome,
    });
    assert.equal(plan.wouldChange, true);
    assert.deepEqual(
      plan.profiles.map((item) => [item.profile, item.action]),
      [
        ['agent-hub-diagnose', 'current'],
        ['agent-hub-writing-ticks', 'update'],
      ],
    );
    assert.equal(
      readFileSync(join(codexHome, 'config.toml'), 'utf8'),
      'model = "leave-me-alone"\n',
    );
    assert.equal(
      readFileSync(
        join(codexHome, 'agent-hub-writing-ticks.config.toml'),
        'utf8',
      ),
      'model_reasoning_effort = "medium"\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('profile installer apply backs up updates, installs missing profiles, and becomes idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-profiles-apply-'));
  const profilesDir = writeFixtureProfiles(root);
  const codexHome = join(root, '.codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    join(codexHome, 'agent-hub-diagnose.config.toml'),
    'model_reasoning_effort = "medium"\n',
  );

  try {
    const applied = installCodexRuntimeProfiles({
      profilesDir,
      codexHome,
      apply: true,
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.backups.length, 1);
    assert.equal(applied.backups[0].profile, 'agent-hub-diagnose');
    assert.equal(
      readFileSync(applied.backups[0].path, 'utf8'),
      'model_reasoning_effort = "medium"\n',
    );
    assert.equal(
      readFileSync(
        join(codexHome, 'agent-hub-diagnose.config.toml'),
        'utf8',
      ),
      'model_reasoning_effort = "high"\n',
    );
    assert.equal(
      readFileSync(
        join(codexHome, 'agent-hub-writing-ticks.config.toml'),
        'utf8',
      ),
      'model_reasoning_effort = "low"\n',
    );

    const second = installCodexRuntimeProfiles({
      profilesDir,
      codexHome,
      apply: true,
    });
    assert.equal(second.wouldChange, false);
    assert.equal(second.applied, false);
    assert.deepEqual(second.backups, []);
    assert.ok(second.profiles.every((item) => item.action === 'current'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('profile installer reports stale managed profiles but never removes them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-profiles-stale-'));
  const profilesDir = writeFixtureProfiles(root);
  const codexHome = join(root, '.codex');
  mkdirSync(codexHome, { recursive: true });
  const stale = join(codexHome, 'agent-hub-old-skill.config.toml');
  writeFileSync(stale, 'model_reasoning_effort = "high"\n');

  try {
    const applied = installCodexRuntimeProfiles({
      profilesDir,
      codexHome,
      apply: true,
    });
    assert.deepEqual(
      applied.staleManagedProfiles,
      ['agent-hub-old-skill.config.toml'],
    );
    assert.equal(applied.pruneApplied, false);
    assert.match(applied.note, /reported but not removed/i);
    assert.equal(
      readFileSync(stale, 'utf8'),
      'model_reasoning_effort = "high"\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('profile installer preserves unrelated Codex files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-profiles-other-'));
  const profilesDir = writeFixtureProfiles(root);
  const codexHome = join(root, '.codex');
  mkdirSync(codexHome, { recursive: true });
  const config = join(codexHome, 'config.toml');
  const other = join(codexHome, 'personal.config.toml');
  writeFileSync(config, 'model = "custom"\n');
  writeFileSync(other, 'model_reasoning_effort = "xhigh"\n');

  try {
    installCodexRuntimeProfiles({
      profilesDir,
      codexHome,
      apply: true,
    });
    assert.equal(readFileSync(config, 'utf8'), 'model = "custom"\n');
    assert.equal(
      readFileSync(other, 'utf8'),
      'model_reasoning_effort = "xhigh"\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('profile installer refuses a symlinked managed destination', async (t) => {
  if (process.platform === 'win32') {
    t.skip('symlink creation may require elevated Windows privileges');
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-profiles-link-'));
  const profilesDir = writeFixtureProfiles(root);
  const codexHome = join(root, '.codex');
  mkdirSync(codexHome, { recursive: true });
  const real = join(root, 'real-profile.toml');
  writeFileSync(real, 'model_reasoning_effort = "medium"\n');
  symlinkSync(
    real,
    join(codexHome, 'agent-hub-diagnose.config.toml'),
  );

  try {
    assert.throws(
      () => planCodexRuntimeProfiles({ profilesDir, codexHome }),
      /symlinked installed Codex profile/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('profile installer validates manifest-owned filenames', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-profiles-manifest-'));
  const profilesDir = join(root, 'generated');
  const codexHome = join(root, '.codex');
  mkdirSync(profilesDir, { recursive: true });

  writeFileSync(
    join(profilesDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      host: 'codex',
      profiles: [{
        skill: 'bad',
        profile: 'agent-hub-bad',
        file: '../escape.config.toml',
      }],
    }),
  );

  try {
    assert.throws(
      () => planCodexRuntimeProfiles({ profilesDir, codexHome }),
      /does not match profile name|unsafe/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('profile installer argument parser is dry-run by default', () => {
  assert.deepEqual(parseCodexRuntimeProfileInstallArgs([]), {
    apply: false,
    profilesDir: undefined,
    codexHome: undefined,
  });
  assert.deepEqual(
    parseCodexRuntimeProfileInstallArgs([
      '--apply',
      '--profiles-dir', '/repo/generated',
      '--codex-home', '/state/.codex',
    ]),
    {
      apply: true,
      profilesDir: '/repo/generated',
      codexHome: '/state/.codex',
    },
  );
  assert.throws(
    () => parseCodexRuntimeProfileInstallArgs(['--wat']),
    /Unknown option/,
  );
});
