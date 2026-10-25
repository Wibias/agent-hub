import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  P19_P18_EVIDENCE_SHA256,
} from '../../reference-graph/p19-production-soak.mjs';
import {
  redactP19Error,
  runP19ProductionSoakCli,
} from '../../reference-graph/cli/p19-production-soak.mjs';

const P18_EVIDENCE_PATH = 'reference-graph/evidence/p18-production-activation-receipt-evidence.json';
const PROD_URL = 'https://vrznfnxzlxaavpqbzbzd.supabase.co';

function outputSink() {
  const chunks = [];
  return {
    write(value) { chunks.push(String(value)); },
    text() { return chunks.join(''); },
  };
}

function operatorEnv(overrides = {}) {
  return {
    SUPABASE_URL: PROD_URL,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_runtime',
    SUPABASE_SECRET_KEY: 'sb_secret_test_operator',
    ...overrides,
  };
}

function attestationReceipt() {
  return {
    schema_version: 'reference-graph.p19-activation-attestation.v1',
    observed_at: '2026-10-25T08:00:00.000Z',
    p18_evidence_sha256: P19_P18_EVIDENCE_SHA256,
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    authority_sha256: 'e3554b76b8add430a6e0276e97c9cb16702f6af57764db53445d00b49f6e965c',
    request_hash: 'ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7',
    grant_payload_hash: 'e2ae9a9608590b1256573b6770a226daf4b38ae0440027570f90752ec6caa465',
    matching_count: 1,
    total_count: 1,
    exact_match: true,
    healthy: true,
    blockers: [],
  };
}

function healthySample(at = '2026-10-25T09:00:00.000Z') {
  return {
    schema_version: 'reference-graph.p19-production-health-sample.v1',
    sampled_at: at,
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    production_source: 'reference-graph',
    quick_graph_enabled: true,
    repository_default_graph_enabled: false,
    probe_duration_ms: 21,
    routing: {
      quick: {
        authoritative_source: 'reference-graph',
        record_exact: true,
        pattern_exact: true,
      },
      standard: { authoritative_source: 'legacy-control' },
      deep: { authoritative_source: 'legacy-control' },
    },
    healthy: true,
    blockers: [],
  };
}

async function mode600(path) {
  if (process.platform === 'win32') return;
  const info = await stat(path);
  assert.equal(info.mode & 0o777, 0o600);
}

test('P19 CLI attests the exact immutable P18 evidence before creating the elevated store and writes a sanitized mode-0600 receipt', async () => {
  const actualBytes = await readFile(P18_EVIDENCE_PATH);
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p19-attest-'));
  const outPath = join(dir, 'attestation.json');
  const stdout = outputSink();
  const events = [];
  const fakeStore = { kind: 'store' };

  const code = await runP19ProductionSoakCli({
    argv: ['--attest-consumption', outPath],
    env: operatorEnv(),
    stdout,
    readFileImpl: async (path, ...args) => {
      if (path === P18_EVIDENCE_PATH) events.push('read-evidence');
      return readFile(path, ...args);
    },
    createStore(env) {
      events.push('create-store');
      assert.equal(env.SUPABASE_SECRET_KEY, 'sb_secret_test_operator');
      return fakeStore;
    },
    attest: async ({ p18Evidence, store }) => {
      events.push('attest');
      assert.equal(store, fakeStore);
      assert.equal(p18Evidence.schema_version, 'reference-graph.p18-production-activation-receipt.v1');
      return attestationReceipt();
    },
  });

  assert.ok(actualBytes.length > 0);
  assert.equal(code, 0);
  assert.deepEqual(events, ['read-evidence', 'create-store', 'attest']);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), attestationReceipt());
  assert.deepEqual(JSON.parse(stdout.text()), attestationReceipt());
  assert.doesNotMatch(stdout.text(), /sb_secret_|sb_publishable_|nonce|consumption_id|signature/i);
  await mode600(outPath);
});

test('P19 CLI rejects altered P18 evidence bytes before creating a store or making an RPC', async () => {
  const original = await readFile(P18_EVIDENCE_PATH);
  let stores = 0;
  let attestations = 0;
  await assert.rejects(
    runP19ProductionSoakCli({
      argv: ['--attest-consumption', join(tmpdir(), 'must-not-write-p19.json')],
      env: operatorEnv(),
      stdout: outputSink(),
      readFileImpl: async (path, ...args) => {
        if (path === P18_EVIDENCE_PATH) return Buffer.concat([original, Buffer.from(' ')]);
        return readFile(path, ...args);
      },
      createStore() { stores += 1; return {}; },
      attest: async () => { attestations += 1; return {}; },
    }),
    /P18 production receipt evidence SHA-256 mismatch/i,
  );
  assert.equal(stores, 0);
  assert.equal(attestations, 0);
});

test('P19 CLI attestation requires the exact production target and an elevated key before store creation', async () => {
  for (const env of [
    operatorEnv({ SUPABASE_URL: 'https://wrong.supabase.co' }),
    operatorEnv({ SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
  ]) {
    let stores = 0;
    await assert.rejects(
      runP19ProductionSoakCli({
        argv: ['--attest-consumption', join(tmpdir(), 'must-not-write-p19.json')],
        env,
        stdout: outputSink(),
        createStore() { stores += 1; return {}; },
      }),
      /production Supabase target|elevated Supabase key/i,
    );
    assert.equal(stores, 0);
  }
});

test('P19 CLI sample mode never creates an elevated store and appends one restricted JSONL sample', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p19-sample-'));
  const samplePath = join(dir, 'nested', 'p19-soak.jsonl');
  const stdout = outputSink();
  let stores = 0;
  const first = healthySample('2026-10-25T09:00:00.000Z');
  const second = healthySample('2026-10-25T10:00:00.000Z');
  let next = first;

  for (const expected of [first, second]) {
    const code = await runP19ProductionSoakCli({
      argv: ['--sample', samplePath],
      env: operatorEnv(),
      stdout,
      createStore() { stores += 1; return {}; },
      sampleHealth: async () => next,
    });
    assert.equal(code, 0);
    next = second;
  }

  assert.equal(stores, 0);
  const lines = (await readFile(samplePath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(lines, [first, second]);
  assert.deepEqual(stdout.text().trim().split(/\r?\n/).map(JSON.parse), [first, second]);
  await mode600(samplePath);
});

test('P19 CLI sample mode returns nonzero after persisting an unhealthy sanitized sample', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p19-unhealthy-'));
  const samplePath = join(dir, 'p19-soak.jsonl');
  const unhealthy = {
    ...healthySample(),
    healthy: false,
    blockers: ['probe-error'],
    routing: null,
  };
  const code = await runP19ProductionSoakCli({
    argv: ['--sample', samplePath],
    env: operatorEnv(),
    stdout: outputSink(),
    sampleHealth: async () => unhealthy,
  });
  assert.equal(code, 2);
  assert.deepEqual(JSON.parse((await readFile(samplePath, 'utf8')).trim()), unhealthy);
});

test('P19 CLI evaluates nonblank JSONL samples offline and rejects malformed JSONL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p19-evaluate-'));
  const attestationPath = join(dir, 'attestation.json');
  const samplesPath = join(dir, 'samples.jsonl');
  const outPath = join(dir, 'readiness.json');
  await writeFile(attestationPath, `${JSON.stringify(attestationReceipt())}\n`);
  await writeFile(samplesPath, `\n${JSON.stringify(healthySample())}\n\n`);
  const expected = {
    schema_version: 'reference-graph.p19-promotion-readiness.v1',
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    eligible: false,
    blockers: ['insufficient-samples'],
  };

  const code = await runP19ProductionSoakCli({
    argv: ['--evaluate', attestationPath, samplesPath, outPath],
    env: {},
    stdout: outputSink(),
    evaluate: ({ attestation, samples }) => {
      assert.deepEqual(attestation, attestationReceipt());
      assert.deepEqual(samples, [healthySample()]);
      return expected;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(await readFile(outPath, 'utf8')), expected);
  await mode600(outPath);

  await writeFile(samplesPath, '{not-json}\n');
  await assert.rejects(
    runP19ProductionSoakCli({
      argv: ['--evaluate', attestationPath, samplesPath, outPath],
      env: {},
      stdout: outputSink(),
    }),
    /P19 samples JSONL line 1 must contain valid JSON/i,
  );
});

test('P19 CLI redacts all Supabase credential values from stderr-facing errors', () => {
  const env = operatorEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'legacy_service_role_secret_value',
  });
  const text = redactP19Error(
    new Error('failed sb_secret_test_operator sb_publishable_test_runtime legacy_service_role_secret_value'),
    env,
  );
  assert.doesNotMatch(text, /sb_secret_test_operator|sb_publishable_test_runtime|legacy_service_role_secret_value/);
  assert.match(text, /\[redacted\]/);
});

test('P19 CLI source has no production activation, nonce consumption, P17 mutation, or confirmation-token path', async () => {
  const source = await readFile('reference-graph/cli/p19-production-soak.mjs', 'utf8');
  assert.doesNotMatch(source, /--activate-production|ACTIVATE-QUICK-REFERENCE-GRAPH/);
  assert.doesNotMatch(source, /consumeActivationGrantNonceP16\s*\(/);
  assert.doesNotMatch(source, /executeP17Activation\s*\(/);
  assert.doesNotMatch(source, /applyP17LocalActivation|rollbackP17LocalActivation/);
  assert.match(source, /ReferenceGraphSupabaseStore\.fromEnv/);
  assert.match(source, /attestP19ActivationConsumption/);
  assert.match(source, /sampleP19ProductionHealth/);
  assert.match(source, /evaluateP19PromotionReadiness/);
});
