import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32, posix } from 'node:path';
import test from 'node:test';

import {
  applyP17LocalActivation,
  defaultP17ActivationStatePath,
  readP17ActivationState,
  readP17RawState,
  rollbackP17LocalActivation,
} from '../../reference-graph/p17-local-runtime-actuator.mjs';

const GRAPH_HASH = 'a'.repeat(64);

async function tempStatePath() {
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p17-'));
  return join(dir, 'activation-state-v1.json');
}

test('P17 state path follows AgentHub Windows and XDG state conventions', () => {
  assert.equal(
    defaultP17ActivationStatePath({
      env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
      platform: 'win32',
      homeDir: 'C:\\Users\\tester',
    }),
    win32.join('C:\\Users\\tester\\AppData\\Local', 'agent-hub', 'reference-graph', 'activation-state-v1.json'),
  );
  assert.equal(
    defaultP17ActivationStatePath({
      env: { XDG_STATE_HOME: '/var/state/tester' },
      platform: 'linux',
      homeDir: '/home/tester',
    }),
    posix.join('/var/state/tester', 'agent-hub', 'reference-graph', 'activation-state-v1.json'),
  );
  assert.equal(
    defaultP17ActivationStatePath({
      env: { AGENT_HUB_REFERENCE_GRAPH_STATE: '/tmp/custom-p17.json' },
      platform: 'linux',
      homeDir: '/home/tester',
    }),
    '/tmp/custom-p17.json',
  );
});

test('missing P17 state fails closed to repository legacy control', async () => {
  const statePath = await tempStatePath();
  const state = await readP17ActivationState({ statePath });
  assert.deepEqual(state, {
    production_source: 'legacy-control',
    quick_graph_enabled: false,
    repository_default_graph_enabled: false,
  });
  assert.equal(await readP17RawState({ statePath }), null);
});

test('malformed, extra-key, or wrong-schema state never enables graph', async () => {
  const statePath = await tempStatePath();
  const invalidStates = [
    '{',
    JSON.stringify({
      schema: 'reference-graph.p17-local-activation-state.v0',
      mode: 'graph',
      change_id: '11111111-1111-4111-8111-111111111111',
      consumption_id: 'consume-1',
      grant_payload_hash: GRAPH_HASH,
      updated_at: '2026-10-24T04:00:00.000Z',
    }),
    JSON.stringify({
      schema: 'reference-graph.p17-local-activation-state.v1',
      mode: 'graph',
      change_id: '11111111-1111-4111-8111-111111111111',
      consumption_id: 'consume-1',
      grant_payload_hash: GRAPH_HASH,
      updated_at: '2026-10-24T04:00:00.000Z',
      unexpected: true,
    }),
  ];

  for (const value of invalidStates) {
    await writeFile(statePath, value, 'utf8');
    assert.deepEqual(await readP17ActivationState({ statePath }), {
      production_source: 'legacy-control',
      quick_graph_enabled: false,
      repository_default_graph_enabled: false,
    });
    assert.equal(await readP17RawState({ statePath }), null);
  }
});

test('apply writes exact graph state and returns a change id', async () => {
  const statePath = await tempStatePath();
  const result = await applyP17LocalActivation({
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    grant_nonce: '1'.repeat(64),
    grant_payload_hash: GRAPH_HASH,
    request_hash: 'b'.repeat(64),
    authority_hash: 'c'.repeat(64),
    consumption_id: 'consume-1',
  }, {
    statePath,
    now: () => new Date('2026-10-24T04:00:00.000Z'),
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
  });

  assert.deepEqual(result, {
    applied: true,
    change_id: '11111111-1111-4111-8111-111111111111',
  });
  assert.deepEqual(await readP17RawState({ statePath }), {
    schema: 'reference-graph.p17-local-activation-state.v1',
    mode: 'graph',
    change_id: '11111111-1111-4111-8111-111111111111',
    consumption_id: 'consume-1',
    grant_payload_hash: GRAPH_HASH,
    updated_at: '2026-10-24T04:00:00.000Z',
  });
  assert.deepEqual(await readP17ActivationState({ statePath }), {
    production_source: 'reference-graph',
    quick_graph_enabled: true,
    repository_default_graph_enabled: false,
  });
});

test('apply state never persists raw grant, signature, credentials, or caller authorization booleans', async () => {
  const statePath = await tempStatePath();
  await applyP17LocalActivation({
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    grant_nonce: '2'.repeat(64),
    grant_payload_hash: GRAPH_HASH,
    request_hash: 'd'.repeat(64),
    authority_hash: 'e'.repeat(64),
    consumption_id: 'consume-2',
    signature_base64: 'must-not-persist',
    service_role_key: 'must-not-persist',
    activation_authorized: true,
  }, {
    statePath,
    now: () => new Date('2026-10-24T04:01:00.000Z'),
    randomUUID: () => '22222222-2222-4222-8222-222222222222',
  });

  const bytes = await readFile(statePath, 'utf8');
  assert.doesNotMatch(bytes, /signature|service_role|authorized|nonce|request_hash|authority_hash/i);
});

test('apply rejects any activation surface except exact Quick graph flag', async () => {
  const statePath = await tempStatePath();
  await assert.rejects(
    applyP17LocalActivation({
      activation_flag: 'OTHER_FLAG',
      activation_value: 'graph',
      grant_payload_hash: GRAPH_HASH,
      consumption_id: 'consume-3',
    }, { statePath }),
    /activation flag/i,
  );
  await assert.rejects(
    applyP17LocalActivation({
      activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
      activation_value: 'legacy',
      grant_payload_hash: GRAPH_HASH,
      consumption_id: 'consume-3',
    }, { statePath }),
    /activation value/i,
  );
});

test('rollback atomically returns the state to legacy with a fresh change id', async () => {
  const statePath = await tempStatePath();
  await applyP17LocalActivation({
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    grant_payload_hash: GRAPH_HASH,
    consumption_id: 'consume-4',
  }, {
    statePath,
    now: () => new Date('2026-10-24T04:02:00.000Z'),
    randomUUID: () => '33333333-3333-4333-8333-333333333333',
  });

  const rollback = await rollbackP17LocalActivation({
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_change_id: '33333333-3333-4333-8333-333333333333',
    consumption_id: 'consume-4',
    grant_nonce: '4'.repeat(64),
    grant_payload_hash: GRAPH_HASH,
  }, {
    statePath,
    now: () => new Date('2026-10-24T04:03:00.000Z'),
    randomUUID: () => '44444444-4444-4444-8444-444444444444',
  });

  assert.deepEqual(rollback, {
    rolled_back: true,
    change_id: '44444444-4444-4444-8444-444444444444',
  });
  assert.deepEqual(await readP17RawState({ statePath }), {
    schema: 'reference-graph.p17-local-activation-state.v1',
    mode: 'legacy',
    change_id: '44444444-4444-4444-8444-444444444444',
    consumption_id: null,
    grant_payload_hash: null,
    updated_at: '2026-10-24T04:03:00.000Z',
  });
  assert.deepEqual(await readP17ActivationState({ statePath }), {
    production_source: 'legacy-control',
    quick_graph_enabled: false,
    repository_default_graph_enabled: false,
  });
});
