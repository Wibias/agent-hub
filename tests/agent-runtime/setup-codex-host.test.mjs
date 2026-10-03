import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCodexHostSetupArgs,
  runCodexHostSetup,
} from '../../scripts/setup-codex-host.mjs';

function healthyDoctor() {
  return {
    status: 'healthy',
    context: {
      status: 'ok',
      projectId: 'github.com/Wibias/agent-hub',
      branch: 'main',
      revisionSha: 'abc123',
    },
    database: {
      status: 'ok',
      quickCheck: 'ok',
      lexicalCoverageComplete: true,
      semanticCoverageComplete: true,
    },
    embedding: {
      cache: { status: 'ok' },
      worker: { status: 'ok' },
    },
    recall: {
      status: 'ok',
      reason: null,
    },
    codex: {
      status: 'ok',
      reason: null,
      hook: {
        flags: {
          ignoreMemoryEnv: true,
          explicitMemoryRequests: true,
          hybridRecall: true,
          candidateCapture: true,
          autoPipeline: true,
        },
        sessionStartLauncher: true,
      },
    },
    nativeCodexMemory: {
      status: 'isolated',
      reasons: [],
    },
    restoreRecovery: {
      status: 'ok',
      reason: null,
    },
  };
}

function baseDependencies(overrides = {}) {
  return {
    async renderAll() {
      return [];
    },
    installHooks({ apply }) {
      return {
        wouldChange: false,
        applied: false,
        backupPath: null,
        hookTrustRequired: false,
        managed: {
          SessionStart: true,
          UserPromptSubmit: true,
          autoPipeline: true,
        },
        plan: {
          SessionStart: { action: 'current' },
          UserPromptSubmit: { action: 'current' },
        },
      };
    },
    async readConfig() {
      return {
        configPath: 'C:/fixture/codex/config.toml',
        exists: true,
        text: '[features]\nmemories = false\n[memories]\nuse_memories = false\ngenerate_memories = false\n',
      };
    },
    planIsolation() {
      return {
        changed: false,
        before: {
          featureEnabled: false,
          useMemories: false,
          generateMemories: false,
        },
        after: {
          featureEnabled: false,
          useMemories: false,
          generateMemories: false,
        },
      };
    },
    async applyIsolation() {
      throw new Error('applyIsolation should not run');
    },
    planRetirement() {
      return {
        schemaVersion: 1,
        host: 'codex',
        codexHome: 'C:/fixture/codex',
        profiles: [],
        wouldChange: false,
      };
    },
    retireProfiles() {
      throw new Error('retireProfiles should not run');
    },
    async doctor() {
      return healthyDoctor();
    },
    ...overrides,
  };
}

test('host setup dry-run is healthy and mutation-free when everything is current', async () => {
  let hookApplyCalls = 0;
  const dependencies = baseDependencies({
    installHooks({ apply }) {
      if (apply) hookApplyCalls += 1;
      return {
        wouldChange: false,
        applied: false,
        backupPath: null,
        hookTrustRequired: false,
        managed: {
          SessionStart: true,
          UserPromptSubmit: true,
          autoPipeline: true,
        },
        plan: {
          SessionStart: { action: 'current' },
          UserPromptSubmit: { action: 'current' },
        },
      };
    },
  });

  const result = await runCodexHostSetup({
    apply: false,
    cwd: 'C:/fixture/agent-hub',
    hubRoot: 'C:/fixture/agent-hub',
    codexHome: 'C:/fixture/codex',
    nodePath: 'C:/nvm4w/nodejs/node.exe',
    dependencies,
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.status, 'healthy');
  assert.equal(result.mutationsApplied, false);
  assert.equal(hookApplyCalls, 0);
  assert.equal(result.plan.hooks.wouldChange, false);
  assert.equal(result.plan.nativeMemoryIsolation.wouldChange, false);
  assert.equal(result.plan.legacyRuntimeProfiles.wouldChange, false);
  assert.equal(result.doctor.status, 'healthy');
  assert.deepEqual(result.nextSteps, []);
});

test('host setup dry-run reports all planned changes without invoking mutation paths', async () => {
  let applyCalls = 0;
  const dependencies = baseDependencies({
    installHooks({ apply }) {
      if (apply) applyCalls += 1;
      return {
        wouldChange: true,
        applied: false,
        backupPath: null,
        hookTrustRequired: true,
        managed: {
          SessionStart: true,
          UserPromptSubmit: true,
          autoPipeline: true,
        },
        plan: {
          SessionStart: {
            action: 'normalize',
            reasons: ['managed_definition_differs'],
          },
          UserPromptSubmit: {
            action: 'normalize',
            reasons: ['managed_definition_differs'],
          },
        },
      };
    },
    planIsolation() {
      return {
        changed: true,
        before: {
          featureEnabled: true,
          useMemories: true,
          generateMemories: true,
        },
        after: {
          featureEnabled: false,
          useMemories: false,
          generateMemories: false,
        },
      };
    },
    planRetirement() {
      return {
        profiles: [
          {
            file: 'agent-hub-diagnose.config.toml',
            action: 'backup_remove',
          },
        ],
        wouldChange: true,
      };
    },
    async applyIsolation() {
      applyCalls += 1;
      return {};
    },
    retireProfiles() {
      applyCalls += 1;
      return {};
    },
  });

  const result = await runCodexHostSetup({
    apply: false,
    cwd: 'C:/fixture/agent-hub',
    hubRoot: 'C:/fixture/agent-hub',
    codexHome: 'C:/fixture/codex',
    nodePath: 'C:/nvm4w/nodejs/node.exe',
    dependencies,
  });

  assert.equal(result.status, 'changes_required');
  assert.equal(result.mutationsApplied, false);
  assert.equal(applyCalls, 0);
  assert.equal(result.plan.hooks.wouldChange, true);
  assert.equal(result.plan.hooks.hookTrustRequired, true);
  assert.equal(result.plan.nativeMemoryIsolation.wouldChange, true);
  assert.equal(result.plan.nativeMemoryIsolation.backupRequired, true);
  assert.deepEqual(
    result.plan.legacyRuntimeProfiles.profiles,
    ['agent-hub-diagnose.config.toml'],
  );
  assert.deepEqual(
    result.nextSteps,
    ['Review this plan, then rerun with --apply.'],
  );
});

test('host setup blocks before host inspection or mutation when generated runtime artifacts drift', async () => {
  let calls = 0;
  const dependencies = baseDependencies({
    async renderAll() {
      return [
        'C:/fixture/agent-hub/agent-runtime/generated/codex-runtime/manifest.json',
      ];
    },
    installHooks() {
      calls += 1;
      throw new Error('must not run');
    },
    async readConfig() {
      calls += 1;
      throw new Error('must not run');
    },
    async doctor() {
      calls += 1;
      throw new Error('must not run');
    },
  });

  const result = await runCodexHostSetup({
    apply: true,
    cwd: 'C:/fixture/agent-hub',
    hubRoot: 'C:/fixture/agent-hub',
    codexHome: 'C:/fixture/codex',
    dependencies,
  });

  assert.equal(result.status, 'blocked_generated_drift');
  assert.equal(result.mutationsApplied, false);
  assert.equal(calls, 0);
  assert.equal(result.runtime.generatedDrift.length, 1);
});

test('host setup apply composes existing safe mutation paths and reports trust/restart requirements', async () => {
  const sequence = [];
  let doctorCalls = 0;
  const dependencies = baseDependencies({
    installHooks({ apply }) {
      sequence.push(apply ? 'hooks-apply' : 'hooks-plan');
      return apply
        ? {
          wouldChange: true,
          applied: true,
          backupPath: 'C:/fixture/codex/hooks.json.backup',
          hookTrustRequired: true,
        }
        : {
          wouldChange: true,
          applied: false,
          backupPath: null,
          hookTrustRequired: true,
          managed: {
            SessionStart: true,
            UserPromptSubmit: true,
            autoPipeline: true,
          },
          plan: {
            SessionStart: { action: 'normalize' },
            UserPromptSubmit: { action: 'normalize' },
          },
        };
    },
    planIsolation() {
      return {
        changed: true,
        before: {
          featureEnabled: true,
          useMemories: true,
          generateMemories: true,
        },
        after: {
          featureEnabled: false,
          useMemories: false,
          generateMemories: false,
        },
      };
    },
    async applyIsolation() {
      sequence.push('native-memory-apply');
      return {
        changed: true,
        configPath: 'C:/fixture/codex/config.toml',
        backupPath: 'C:/fixture/codex/config.toml.backup',
        settings: {
          featureEnabled: false,
          useMemories: false,
          generateMemories: false,
        },
      };
    },
    planRetirement() {
      return {
        profiles: [
          {
            file: 'agent-hub-diagnose.config.toml',
            action: 'backup_remove',
          },
        ],
        wouldChange: true,
      };
    },
    retireProfiles() {
      sequence.push('legacy-profile-retire');
      return {
        applied: true,
        backups: [
          {
            file: 'agent-hub-diagnose.config.toml',
            path: 'C:/fixture/codex/agent-hub-diagnose.config.toml.retired-backup',
          },
        ],
      };
    },
    async doctor() {
      doctorCalls += 1;
      sequence.push(doctorCalls === 1 ? 'doctor-before' : 'doctor-after');
      return healthyDoctor();
    },
  });

  const result = await runCodexHostSetup({
    apply: true,
    cwd: 'C:/fixture/agent-hub',
    hubRoot: 'C:/fixture/agent-hub',
    codexHome: 'C:/fixture/codex',
    nodePath: 'C:/nvm4w/nodejs/node.exe',
    dependencies,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.mutationsApplied, true);
  assert.equal(result.restartRequired, true);
  assert.equal(result.applied.hooks.changed, true);
  assert.equal(result.applied.hooks.hookTrustRequired, true);
  assert.match(result.applied.hooks.backupPath, /hooks\.json\.backup/);
  assert.equal(result.applied.nativeMemoryIsolation.changed, true);
  assert.equal(result.applied.legacyRuntimeProfiles.changed, true);
  assert.equal(result.applied.legacyRuntimeProfiles.backups.length, 1);
  assert.deepEqual(sequence, [
    'hooks-plan',
    'doctor-before',
    'native-memory-apply',
    'hooks-apply',
    'legacy-profile-retire',
    'doctor-after',
  ]);
  assert.deepEqual(result.nextSteps, [
    'Restart Codex, open /hooks, and review/trust the changed Agent Hub hook definitions.',
  ]);
});

test('host setup keeps a broken doctor state visible even when changes are also planned', async () => {
  const broken = healthyDoctor();
  broken.status = 'broken';
  broken.database.status = 'broken';

  const dependencies = baseDependencies({
    installHooks() {
      return {
        wouldChange: true,
        applied: false,
        hookTrustRequired: true,
        managed: {},
        plan: {},
      };
    },
    async doctor() {
      return broken;
    },
  });

  const result = await runCodexHostSetup({
    apply: false,
    cwd: 'C:/fixture/agent-hub',
    hubRoot: 'C:/fixture/agent-hub',
    codexHome: 'C:/fixture/codex',
    dependencies,
  });

  assert.equal(result.status, 'broken');
  assert.equal(result.doctor.database.status, 'broken');
});

test('host setup parser is dry-run by default and accepts explicit paths', () => {
  const parsed = parseCodexHostSetupArgs(
    [
      '--apply',
      '--cwd', 'C:/repo',
      '--hub-root', 'C:/hub',
      '--codex-home', 'C:/codex',
      '--node', 'C:/node/node.exe',
    ],
    {},
  );

  assert.equal(parsed.apply, true);
  assert.match(parsed.cwd, /repo$/i);
  assert.match(parsed.hubRoot, /hub$/i);
  assert.match(parsed.codexHome, /codex$/i);
  assert.match(parsed.nodePath, /node[\\/]node\.exe$/i);

  assert.throws(
    () => parseCodexHostSetupArgs(['--wat'], {}),
    /Unknown option/,
  );
});
