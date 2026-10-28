import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCodexHookCliOptions,
  runCodexMemoryHook,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';
import {
  createCodexMemoryHookAdapter,
} from '../../memory-engine/adapters/codex-hooks.mjs';

const PROJECT_ID = 'github.com/example/graph-shadow-live';
const CLAIM_ALPHA = 'claim-alpha-secret-identity';
const CLAIM_BETA = 'claim-beta-secret-identity';
const QUERY = 'which private memory should be recalled?';

function item(id, value) {
  return {
    claim: {
      id,
      kind: 'user_direct',
      subject: 'memory',
      predicate: 'states',
      value,
      state: 'active',
    },
    evidence: {
      id: `e-${id}`,
      authority_class: 'user_direct',
      content_redacted: value,
    },
  };
}

function graphMemory() {
  return {
    exportCanonical() {
      return {
        projects: [{ project_id: PROJECT_ID }],
        evidence: [
          {
            id: `e-${CLAIM_ALPHA}`,
            project_id: PROJECT_ID,
            harness: 'codex',
            source_kind: 'session',
            source_ref: 'session:alpha',
            captured_at: '2026-10-29T00:00:00.000Z',
            authority_class: 'user_direct',
          },
          {
            id: `e-${CLAIM_BETA}`,
            project_id: PROJECT_ID,
            harness: 'codex',
            source_kind: 'session',
            source_ref: 'session:beta',
            captured_at: '2026-10-29T00:01:00.000Z',
            authority_class: 'user_direct',
          },
        ],
        claims: [
          {
            id: CLAIM_ALPHA,
            project_id: PROJECT_ID,
            branch_scope: 'main',
            value_text: 'alpha private memory value',
            kind: 'user_direct',
            subject: 'memory',
            predicate: 'states',
            state: 'active',
            created_at: '2026-10-29T00:00:00.000Z',
            created_from_evidence_id: `e-${CLAIM_ALPHA}`,
          },
          {
            id: CLAIM_BETA,
            project_id: PROJECT_ID,
            branch_scope: 'main',
            value_text: 'beta private memory value',
            kind: 'user_direct',
            subject: 'memory',
            predicate: 'states',
            state: 'active',
            created_at: '2026-10-29T00:01:00.000Z',
            created_from_evidence_id: `e-${CLAIM_BETA}`,
          },
        ],
        lifecycle_events: [],
        conflicts: [],
      };
    },
  };
}

function protocol() {
  return {
    async handle(request) {
      assert.equal(request.operation, 'recall');
      return {
        ok: true,
        result: {
          items: [
            item(CLAIM_ALPHA, 'alpha private memory value'),
            item(CLAIM_BETA, 'beta private memory value'),
          ],
          conflicts: [],
        },
      };
    },
  };
}

function git() {
  return {
    async resolveContext() {
      return {
        repoPath: '/repo/project',
        branch: 'main',
        revisionSha: 'a'.repeat(40),
      };
    },
    async refreshFreshness() {},
  };
}

function event() {
  return {
    session_id: 'session-graph-shadow-live',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-graph-shadow-live',
    prompt: QUERY,
  };
}

test('CLI exposes Graph Recall Shadow as an explicit default-off opt-in', () => {
  const baseline = parseCodexHookCliOptions([
    '--ignore-memory-env',
    '--hybrid-recall',
    '--recall-relevance',
  ]);
  assert.equal(baseline.graphRecallShadow, undefined);

  const enabled = parseCodexHookCliOptions([
    '--ignore-memory-env',
    '--hybrid-recall',
    '--recall-relevance',
    '--graph-recall-shadow',
  ]);
  assert.equal(enabled.graphRecallShadow, true);
});

test('real hook adapter keeps Graph Recall Shadow default-off even when a store is supplied', async () => {
  let storeCalls = 0;
  let judgeCalls = 0;
  const adapter = createCodexMemoryHookAdapter({
    protocol: protocol(),
    memory: graphMemory(),
    projectId: PROJECT_ID,
    recallRelevanceJudge: async () => {
      judgeCalls += 1;
      return { selected_ids: [CLAIM_BETA], reason: 'beta answers the query' };
    },
    graphRecallShadowStore: {
      record() { storeCalls += 1; },
    },
    git: git(),
    clock: () => '2026-10-29T00:15:00.000Z',
  });

  const output = await adapter.handle(event());

  assert.equal(judgeCalls, 1);
  assert.equal(storeCalls, 0);
  assert.match(output.hookSpecificOutput.additionalContext, /beta private memory value/);
});

test('enabled real hook adapter persists one privacy-safe Graph Shadow observation before returning', async () => {
  let judgeCalls = 0;
  let returned = false;
  const records = [];
  const adapter = createCodexMemoryHookAdapter({
    protocol: protocol(),
    memory: graphMemory(),
    projectId: PROJECT_ID,
    recallRelevanceJudge: async () => {
      judgeCalls += 1;
      return { selected_ids: [CLAIM_BETA], reason: 'beta answers the query' };
    },
    graphRecallShadow: true,
    graphRecallShadowStore: {
      record(record) {
        assert.equal(returned, false, 'graph shadow persistence must finish before hook return');
        records.push(record);
        return { status: 'recorded' };
      },
    },
    git: git(),
    clock: () => '2026-10-29T00:15:00.000Z',
  });

  const output = await adapter.handle(event());
  returned = true;

  assert.equal(judgeCalls, 1, 'Graph Shadow must not invoke a second Judge');
  assert.equal(records.length, 1);
  assert.equal(records[0].project_id, PROJECT_ID);
  assert.equal(records[0].branch, 'main');
  assert.equal(records[0].quality_eligible, true);
  assert.equal(records[0].judge_called, true);
  assert.equal(records[0].judge_available, true);
  assert.equal(records[0].metrics.authoritative_selected_count, 1);
  assert.equal(records[0].metrics.false_negative_count, 0);
  assert.match(output.hookSpecificOutput.additionalContext, /beta private memory value/);

  const serialized = JSON.stringify(records[0]);
  assert.equal(serialized.includes(QUERY), false);
  assert.equal(serialized.includes('alpha private memory value'), false);
  assert.equal(serialized.includes('beta private memory value'), false);
  assert.equal(serialized.includes(CLAIM_ALPHA), false);
  assert.equal(serialized.includes(CLAIM_BETA), false);
  assert.equal(serialized.includes('vector'), false);
});

test('Graph Shadow store failure is fail-open and preserves authoritative context with one Judge call', async () => {
  let judgeCalls = 0;
  const adapter = createCodexMemoryHookAdapter({
    protocol: protocol(),
    memory: graphMemory(),
    projectId: PROJECT_ID,
    recallRelevanceJudge: async () => {
      judgeCalls += 1;
      return { selected_ids: [CLAIM_BETA], reason: 'beta answers the query' };
    },
    graphRecallShadow: true,
    graphRecallShadowStore: {
      record() {
        throw new Error('synthetic graph-shadow disk failure');
      },
    },
    git: git(),
    clock: () => '2026-10-29T00:15:00.000Z',
  });

  const output = await adapter.handle(event());

  assert.equal(judgeCalls, 1);
  assert.match(output.hookSpecificOutput.additionalContext, /beta private memory value/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /alpha private memory value/);
});

function runtimeMemory() {
  return {
    getProject() { return { project_id: PROJECT_ID }; },
    registerProject() {},
    recall() { return { items: [], conflicts: [] }; },
    materializeRecall() { return { items: [], conflicts: [] }; },
    semanticCandidates() { return []; },
    getClaim() { return null; },
    close() {},
  };
}

async function captureRuntimeGraphWiring({ env, configOptions }) {
  const rawMemory = runtimeMemory();
  let storeOptions = null;
  let adapterOptions = null;

  await runCodexMemoryHook({
    event: event(),
    env,
    configOptions,
    createEngine() { return rawMemory; },
    resolveProjectScope() {
      return { projectId: PROJECT_ID, repoIdentity: PROJECT_ID, canonicalRemote: null };
    },
    restoreLockExists() { return false; },
    ensureDbDirectory() {},
    prepareRecallRuntime() {
      return {
        memory: rawMemory,
        git: { branch: 'main', revisionSha: 'a'.repeat(40), repoPath: '/repo/project' },
        relevanceJudge: null,
        async close() {},
      };
    },
    createProtocol() {
      return { async handle() { return { ok: true, result: { items: [], conflicts: [] } }; } };
    },
    createGraphRecallShadowStore(options) {
      storeOptions = options;
      return { record() { return { status: 'recorded' }; } };
    },
    createAdapter(options) {
      adapterOptions = options;
      return { async handle() { return null; } };
    },
  });

  return { storeOptions, adapterOptions };
}

test('runtime maps CLI Graph Shadow enablement to a store under the existing shadow root', async () => {
  const { storeOptions, adapterOptions } = await captureRuntimeGraphWiring({
    env: { AGENT_HUB_MEMORY_DB: '/tmp/agent-hub-graph-shadow/memory.sqlite3' },
    configOptions: { graphRecallShadow: true },
  });

  assert.equal(adapterOptions.graphRecallShadow, true);
  assert.equal(typeof adapterOptions.graphRecallShadowStore?.record, 'function');
  assert.match(storeOptions.rootDir, /agent-hub-graph-shadow[\\/]shadow-replay$/);
});

test('runtime maps environment Graph Shadow enablement unless memory env is explicitly ignored', async () => {
  const enabled = await captureRuntimeGraphWiring({
    env: {
      AGENT_HUB_MEMORY_DB: '/tmp/agent-hub-graph-shadow-env/memory.sqlite3',
      AGENT_HUB_MEMORY_GRAPH_RECALL_SHADOW: 'true',
    },
    configOptions: {},
  });
  assert.equal(enabled.adapterOptions.graphRecallShadow, true);
  assert.equal(typeof enabled.adapterOptions.graphRecallShadowStore?.record, 'function');

  const ignored = await captureRuntimeGraphWiring({
    env: { AGENT_HUB_MEMORY_GRAPH_RECALL_SHADOW: 'true' },
    configOptions: { ignoreMemoryEnv: true },
  });
  assert.equal(ignored.adapterOptions.graphRecallShadow, false);
  assert.equal(ignored.adapterOptions.graphRecallShadowStore, null);
});

test('runtime store-construction failure disables Graph Shadow rather than affecting prompt handling', async () => {
  const rawMemory = runtimeMemory();
  let adapterOptions = null;

  await runCodexMemoryHook({
    event: event(),
    env: { AGENT_HUB_MEMORY_DB: '/tmp/agent-hub-graph-shadow-fail/memory.sqlite3' },
    configOptions: { graphRecallShadow: true },
    createEngine() { return rawMemory; },
    resolveProjectScope() {
      return { projectId: PROJECT_ID, repoIdentity: PROJECT_ID, canonicalRemote: null };
    },
    restoreLockExists() { return false; },
    ensureDbDirectory() {},
    prepareRecallRuntime() {
      return {
        memory: rawMemory,
        git: { branch: 'main', revisionSha: 'a'.repeat(40), repoPath: '/repo/project' },
        relevanceJudge: null,
        async close() {},
      };
    },
    createProtocol() {
      return { async handle() { return { ok: true, result: { items: [], conflicts: [] } }; } };
    },
    createGraphRecallShadowStore() {
      throw new Error('synthetic store construction failure');
    },
    createAdapter(options) {
      adapterOptions = options;
      return { async handle() { return null; } };
    },
  });

  assert.equal(adapterOptions.graphRecallShadow, false);
  assert.equal(adapterOptions.graphRecallShadowStore, null);
});
