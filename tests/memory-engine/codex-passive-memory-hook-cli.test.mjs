import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePassiveMemoryHookOptions,
  runCodexPassiveMemoryHook,
} from '../../memory-engine/adapters/codex-passive-memory-hook-cli.mjs';

test('passive memory hook CLI exposes testable parser and runner', () => {
  assert.equal(typeof parsePassiveMemoryHookOptions, 'function');
  assert.equal(typeof runCodexPassiveMemoryHook, 'function');
});

test('passive hook option parser is strict and bounded', () => {
  assert.deepEqual(parsePassiveMemoryHookOptions([
    '--ignore-memory-env',
    '--model', 'gpt-test',
    '--reasoning-effort', 'high',
    '--judge-timeout-ms', '90000',
  ]), {
    ignoreMemoryEnv: true,
    model: 'gpt-test',
    reasoningEffort: 'high',
    judgeTimeoutMs: 90_000,
  });
  assert.throws(
    () => parsePassiveMemoryHookOptions(['--reasoning-effort', 'extreme']),
    /low, medium, or high/u,
  );
  assert.throws(
    () => parsePassiveMemoryHookOptions(['--unknown']),
    /unknown argument/u,
  );
});

function fakeRuntime(callLog) {
  const projects = new Map();
  class MemoryEngine {
    constructor({ dbPath }) {
      callLog.push(['memory:new', dbPath]);
      this.closed = false;
    }
    getProject(id) { return projects.get(id) ?? null; }
    registerProject(value) {
      callLog.push(['project:register', value]);
      projects.set(value.projectId, value);
      return value;
    }
    startPipelineRun(value) {
      callLog.push(['pipeline:start', value]);
      return value;
    }
    finishPipelineRun(value) {
      callLog.push(['pipeline:finish', value]);
      return value;
    }
    close() {
      this.closed = true;
      callLog.push(['memory:close']);
    }
  }
  return {
    MemoryEngine,
    inspectMemoryTextSensitivity: (text) => ({ containsSecret: false, redacted: String(text) }),
    createMemoryProtocol(options) {
      callLog.push(['protocol:create', options]);
      return { handle: async () => ({ ok: true }) };
    },
    resolveGitContext({ cwd }) {
      callLog.push(['git', cwd]);
      return { repoPath: cwd, branch: 'main', revisionSha: 'a'.repeat(40) };
    },
    memoryRestoreLocked() { return false; },
    parseCodexMemoryConfig() { return { dbPath: '/tmp/passive-memory.sqlite3' }; },
    defaultCodexMemoryDbPath() { return '/tmp/default.sqlite3'; },
    resolveCodexProjectScope() {
      return { projectId: 'project-a', repoIdentity: 'repo-a', canonicalRemote: null };
    },
    parseExplicitMemoryPrompt(prompt) {
      return /^memory\b/iu.test(String(prompt)) ? { mode: 'list' } : null;
    },
    createIsolatedCodexJsonJudge: async () => { throw new Error('factory should be injected through bundle'); },
  };
}

test('UserPromptSubmit assembles passive adapter without creating judges', async () => {
  const calls = [];
  const runtime = fakeRuntime(calls);
  const adapterCalls = [];
  let judgeBundles = 0;
  const output = await runCodexPassiveMemoryHook({
    event: {
      hook_event_name: 'UserPromptSubmit', session_id: 'S1', turn_id: 'T1',
      cwd: '/repo', prompt: 'We use Postgres.',
    },
    env: {},
    runtime,
    ensureDbDirectory: (path) => calls.push(['mkdir', path]),
    createJudgeBundle: async () => { judgeBundles += 1; return {}; },
    createEventAdapter(options) {
      adapterCalls.push(options);
      return { async handle(event) { calls.push(['adapter:handle', event.hook_event_name]); } };
    },
    inspectEligibility: () => { throw new Error('eligibility is Stop-only'); },
  });

  assert.deepEqual(output, { continue: true });
  assert.equal(judgeBundles, 0);
  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0].projectId, 'project-a');
  assert.equal(adapterCalls[0].dbPath, '/tmp/passive-memory.sqlite3');
  assert.equal(adapterCalls[0].isMemoryControlPrompt('memory list'), true);
  assert.equal(adapterCalls[0].isMemoryControlPrompt('normal prompt'), false);
  assert.ok(calls.some(([name]) => name === 'project:register'));
  assert.ok(calls.some(([name]) => name === 'memory:close'));
});

test('Stop preflight avoids judge creation when buffered turn is ineligible', async () => {
  const calls = [];
  let judgeBundles = 0;
  let adapters = 0;
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'Stop', session_id: 'S1', turn_id: 'T1', cwd: '/repo' },
    env: {},
    runtime: fakeRuntime(calls),
    ensureDbDirectory: () => {},
    inspectEligibility: () => ({ eligible: false, reason: 'empty_turn_buffer', observations: [] }),
    createJudgeBundle: async () => { judgeBundles += 1; return {}; },
    createEventAdapter() { adapters += 1; return { async handle() {} }; },
  });
  assert.deepEqual(output, { continue: true });
  assert.equal(judgeBundles, 0);
  assert.equal(adapters, 0);
});

test('eligible Stop lazily creates one judge bundle, wires protocol and closes resources', async () => {
  const calls = [];
  const bundleCalls = [];
  let bundleClosed = 0;
  let stopPipelineOptions = null;
  const expirationCalls = [];
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'Stop', session_id: 'S1', turn_id: 'T1', cwd: '/repo' },
    env: { TEST: '1' },
    configOptions: {
      model: 'gpt-test', reasoningEffort: 'high', judgeTimeoutMs: 91_000,
    },
    runtime: fakeRuntime(calls),
    ensureDbDirectory: () => {},
    inspectEligibility: () => ({ eligible: true, reason: null, observations: [{}] }),
    expireClaims: (options) => {
      expirationCalls.push(options);
      return { evaluated: 0, expired: 0, claim_ids: [] };
    },
    createJudgeBundle: async (options) => {
      bundleCalls.push(options);
      return {
        extractionJudge: async () => ({}), importanceJudge: async () => ({}),
        supportJudge: async () => ({}), relationJudge: async () => ({}),
        evaluatorIds: { extraction: 'e', importance: 'i', support: 's', relation: 'r' },
        async close() { bundleClosed += 1; },
      };
    },
    createEventAdapter(options) {
      stopPipelineOptions = options.stopPipelineOptions;
      return { async handle() { calls.push(['adapter:stop']); } };
    },
  });

  assert.deepEqual(output, { continue: true });
  assert.equal(expirationCalls.length, 1);
  assert.equal(expirationCalls[0].projectId, 'project-a');
  assert.equal(expirationCalls[0].branch, 'main');
  assert.equal(expirationCalls[0].dbPath, '/tmp/passive-memory.sqlite3');
  assert.equal(bundleCalls.length, 1);
  assert.equal(bundleCalls[0].model, 'gpt-test');
  assert.equal(bundleCalls[0].reasoningEffort, 'high');
  assert.equal(bundleCalls[0].timeoutMs, 91_000);
  assert.equal(typeof stopPipelineOptions.protocol.handle, 'function');
  assert.equal(typeof stopPipelineOptions.memory.getProject, 'function');
  const protocolCreate = calls.find(([name]) => name === 'protocol:create');
  assert.equal(
    protocolCreate[1].classifyAuthority({
      sourceKind: 'session', metadata: { passive_run_extraction: true },
    }),
    'user_direct',
  );
  assert.equal(
    protocolCreate[1].classifyAuthority({
      sourceKind: 'tool', metadata: { passive_run_extraction: true },
    }),
    'tool_observation',
  );
  assert.equal(
    protocolCreate[1].classifyAuthority({ sourceKind: 'tool', metadata: {} }),
    'unclassified',
  );
  assert.deepEqual(stopPipelineOptions.evaluatorIds, {
    extraction: 'e', importance: 'i', support: 's', relation: 'r',
  });
  assert.equal(bundleClosed, 1);
  assert.ok(calls.some(([name]) => name === 'memory:close'));
});

test('passive hook always fails soft for host-facing execution', async () => {
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'T1', cwd: '/repo' },
    runtime: {
      parseCodexMemoryConfig() { throw new Error('broken config'); },
    },
  });
  assert.deepEqual(output, { continue: true });
});

test('eligible Stop expires due claims before creating model judges', async () => {
  const order = [];
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'Stop', session_id: 'S1', turn_id: 'T1', cwd: '/repo' },
    env: {},
    runtime: fakeRuntime([]),
    ensureDbDirectory: () => {},
    inspectEligibility: () => ({ eligible: true, reason: null, observations: [{}] }),
    expireClaims: () => {
      order.push('expire');
      return { evaluated: 1, expired: 1, claim_ids: ['c-old'] };
    },
    createJudgeBundle: async () => {
      order.push('judge');
      return {
        extractionJudge: async () => ({}), importanceJudge: async () => ({}),
        supportJudge: async () => ({}), relationJudge: async () => ({}),
        evaluatorIds: { extraction: 'e', importance: 'i', support: 's', relation: 'r' },
        async close() {},
      };
    },
    createEventAdapter() { return { async handle() { order.push('adapter'); } }; },
  });
  assert.deepEqual(output, { continue: true });
  assert.deepEqual(order, ['expire', 'judge', 'adapter']);
});

test('eligible Stop wires fail-soft model usage recorder into judge bundle and closes it', async () => {
  const calls = [];
  let recorderClosed = 0;
  let usageCallback = null;
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'Stop', session_id: 'S2', turn_id: 'T2', cwd: '/repo' },
    env: {},
    runtime: fakeRuntime(calls),
    ensureDbDirectory: () => {},
    inspectEligibility: () => ({ eligible: true, reason: null, observations: [{}] }),
    expireClaims: () => ({ evaluated: 0, expired: 0, claim_ids: [] }),
    createTelemetryRecorder(options) {
      assert.equal(options.dbPath, '/tmp/passive-memory.sqlite3');
      assert.equal(options.projectId, 'project-a');
      assert.equal(options.branch, 'main');
      return {
        onUsage: async () => {},
        close() { recorderClosed += 1; },
      };
    },
    createJudgeBundle: async (options) => {
      usageCallback = options.onUsage;
      return {
        extractionJudge: async () => ({}), importanceJudge: async () => ({}),
        supportJudge: async () => ({}), relationJudge: async () => ({}),
        evaluatorIds: { extraction: 'e', importance: 'i', support: 's', relation: 'r' },
        async close() {},
      };
    },
    createEventAdapter() { return { async handle() {} }; },
  });

  assert.deepEqual(output, { continue: true });
  assert.equal(typeof usageCallback, 'function');
  assert.equal(recorderClosed, 1);
});


test('eligible Stop synchronizes semantic derived state once after evidence-bound promotion', async () => {
  const calls = [];
  const syncCalls = [];
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'Stop', session_id: 'S3', turn_id: 'T3', cwd: '/repo' },
    env: {},
    runtime: fakeRuntime(calls),
    ensureDbDirectory: () => {},
    inspectEligibility: () => ({ eligible: true, reason: null, observations: [{}] }),
    expireClaims: () => ({ evaluated: 0, expired: 0, claim_ids: [] }),
    createJudgeBundle: async () => ({
      extractionJudge: async () => ({}), importanceJudge: async () => ({}),
      supportJudge: async () => ({}), relationJudge: async () => ({}),
      evaluatorIds: { extraction: 'e', importance: 'i', support: 's', relation: 'r' },
      async close() {},
    }),
    createEventAdapter() {
      return {
        async handle() {
          return {
            event: 'Stop',
            pipeline: {
              promotion: { promoted: 1 },
            },
          };
        },
      };
    },
    async syncSemantic(options) {
      syncCalls.push(options);
      return { indexed: 1, failed: 0 };
    },
  });

  assert.deepEqual(output, { continue: true });
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].dbPath, '/tmp/passive-memory.sqlite3');
  assert.equal(syncCalls[0].projectId, 'project-a');
  assert.equal(syncCalls[0].branch, 'main');
  assert.equal(typeof syncCalls[0].log, 'function');
});

test('eligible Stop skips semantic synchronization when no claim was promoted', async () => {
  let syncCalls = 0;
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'Stop', session_id: 'S4', turn_id: 'T4', cwd: '/repo' },
    env: {},
    runtime: fakeRuntime([]),
    ensureDbDirectory: () => {},
    inspectEligibility: () => ({ eligible: true, reason: null, observations: [{}] }),
    expireClaims: () => ({ evaluated: 0, expired: 0, claim_ids: [] }),
    createJudgeBundle: async () => ({
      extractionJudge: async () => ({}), importanceJudge: async () => ({}),
      supportJudge: async () => ({}), relationJudge: async () => ({}),
      evaluatorIds: { extraction: 'e', importance: 'i', support: 's', relation: 'r' },
      async close() {},
    }),
    createEventAdapter() {
      return {
        async handle() {
          return {
            event: 'Stop',
            pipeline: {
              promotion: { promoted: 0 },
            },
          };
        },
      };
    },
    async syncSemantic() {
      syncCalls += 1;
    },
  });

  assert.deepEqual(output, { continue: true });
  assert.equal(syncCalls, 0);
});


test('eligible Stop records evidence-bound promotion in pipeline observability', async () => {
  const calls = [];
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'Stop', session_id: 'S5', turn_id: 'T5', cwd: '/repo' },
    env: {},
    runtime: fakeRuntime(calls),
    ensureDbDirectory: () => {},
    inspectEligibility: () => ({ eligible: true, reason: null, observations: [{}] }),
    expireClaims: () => ({ evaluated: 0, expired: 0, claim_ids: [] }),
    createJudgeBundle: async () => ({
      extractionJudge: async () => ({}), importanceJudge: async () => ({}),
      supportJudge: async () => ({}), relationJudge: async () => ({}),
      evaluatorIds: { extraction: 'e', importance: 'i', support: 's', relation: 'r' },
      async close() {},
    }),
    createEventAdapter() {
      return {
        async handle() {
          return {
            event: 'Stop',
            pipeline: {
              extraction: { proposals: [{ id: 'p1' }], failed: 0, results: [{ ok: true }] },
              importance: { total: 1, evaluated: 1, failed: 0, results: [] },
              support: { total: 1, evaluated: 1, failed: 0, results: [] },
              relation: { total: 1, evaluated: 1, failed: 0, results: [] },
              promotion: {
                total: 1, promoted: 1, superseded: 0,
                needs_confirmation: 0, failed: 0, results: [],
              },
            },
          };
        },
      };
    },
    async syncSemantic() { return { indexed: 1, failed: 0 }; },
    createPipelineRunId: () => 'pipeline-run:evidence-test',
  });

  assert.deepEqual(output, { continue: true });
  const start = calls.find(([name]) => name === 'pipeline:start');
  const finish = calls.find(([name]) => name === 'pipeline:finish');
  assert.ok(start, 'evidence-bound run should be started');
  assert.equal(start[1].id, 'pipeline-run:evidence-test');
  assert.equal(start[1].trigger, 'Stop:evidence_bound');
  assert.ok(finish, 'evidence-bound run should be finished');
  assert.equal(finish[1].id, 'pipeline-run:evidence-test');
  assert.equal(finish[1].status, 'drained');
  assert.equal(finish[1].rounds, 1);
  assert.equal(finish[1].promotedCount, 1);
  assert.deepEqual(finish[1].stageCounts.evidence_promotion, {
    total: 1,
    promoted: 1,
    superseded: 0,
    needs_confirmation: 0,
    failed: 0,
  });
});

test('eligible Stop closes evidence-bound observability as failed when setup aborts after run start', async () => {
  const calls = [];
  const output = await runCodexPassiveMemoryHook({
    event: { hook_event_name: 'Stop', session_id: 'S6', turn_id: 'T6', cwd: '/repo' },
    env: {},
    runtime: fakeRuntime(calls),
    ensureDbDirectory: () => {},
    inspectEligibility: () => ({ eligible: true, reason: null, observations: [{}] }),
    expireClaims: () => ({ evaluated: 0, expired: 0, claim_ids: [] }),
    createTelemetryRecorder() {
      throw new Error('telemetry setup failed');
    },
    createPipelineRunId: () => 'pipeline-run:evidence-failed-test',
  });

  assert.deepEqual(output, { continue: true });
  const start = calls.find(([name]) => name === 'pipeline:start');
  const finish = calls.find(([name]) => name === 'pipeline:finish');
  assert.ok(start, 'evidence-bound run should be started before setup failure');
  assert.ok(finish, 'started evidence-bound run should be closed after setup failure');
  assert.equal(finish[1].id, 'pipeline-run:evidence-failed-test');
  assert.equal(finish[1].status, 'failed');
  assert.equal(finish[1].promotedCount, 0);
  assert.match(finish[1].error, /telemetry setup failed/u);
});
