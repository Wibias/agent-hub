import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { planP40OperatorAudit } from '../../reference-graph/cli/p40-operator-readonly-audit.mjs';

const digest = raw => createHash('sha256').update(raw, 'utf8').digest('hex');
const now = new Date('2026-11-07T11:32:00.000Z');
const sources = {
  '/audit/source.json': '{"source":"external"}',
  '/audit/baseline.json': '{"baseline":"external"}',
  '/audit/templates.json': '[{"profile":"quick"}]',
  '/audit/records.json': '[]',
  '/audit/patterns.json': '[]',
  '/audit/public.json': '{"public":"external"}',
};
const manifest = {
  schema_version: 'reference-graph.p40-operator-manifest.v1',
  target_url: 'https://vrznfnxzlxaavpqbzbzd.supabase.co/',
  approved_record_report_sha256: null,
  files: Object.fromEntries([
    ['sourceWitness', '/audit/source.json'],
    ['baseline', '/audit/baseline.json'],
    ['templates', '/audit/templates.json'],
  ].map(([k, path]) => [k, { path, sha256: digest(sources[path]) }])),
};
const env = { P40_SUPABASE_SECRET_KEY: 'sb_secret_local_test_only' };
const readText = path => {
  if (!Object.hasOwn(sources, path)) throw new Error('not found');
  return sources[path];
};

test('P40 operator record plan reads only externally pinned input paths, not network', () => {
  const plan = planP40OperatorAudit({ stage: 'record', manifest, readText, env, now });
  assert.equal(plan.stage, 'record');
  assert.equal(plan.input.asOf, now.toISOString());
  assert.equal(plan.input.accessMode, 'server');
  assert.equal(plan.input.sourceWitnessJson, sources['/audit/source.json']);
  assert.equal(Object.hasOwn(plan.input, 'recordsJson'), false);
  assert.equal(Object.hasOwn(plan.input, 'expectedP40RecordReportSha256'), false);
});

test('P40 operator full plan demands external stage-one digest and all six files', () => {
  const m = structuredClone(manifest);
  m.approved_record_report_sha256 = 'a'.repeat(64);
  for (const [name, path] of [
    ['records', '/audit/records.json'],
    ['patterns', '/audit/patterns.json'],
    ['publicBaseline', '/audit/public.json'],
  ]) m.files[name] = { path, sha256: digest(sources[path]) };
  const plan = planP40OperatorAudit({ stage: 'full', manifest: m, readText, env, now });
  assert.equal(plan.input.expectedP40RecordReportSha256, m.approved_record_report_sha256);
  assert.equal(plan.input.recordsJson, sources['/audit/records.json']);
});

test('P40 operator rejects missing credentials, untrusted project and unauthorized extra inputs', () => {
  const cases = [
    { env: {} },
    { env: { P40_SUPABASE_SECRET_KEY: 'public-anon-key' } },
    { manifest: { ...manifest, target_url: 'https://attacker.example/' } },
    { manifest: { ...manifest, unexpected: 'secret' } },
    { manifest: { ...manifest, files: { ...manifest.files, key: { path: 'secret', sha256: 'a'.repeat(64) } } } },
    { manifest: { ...manifest, files: { ...manifest.files, baseline: { path: '/bad', sha256: 'a'.repeat(64) } } } },
  ];
  for (const patch of cases) {
    assert.throws(() => planP40OperatorAudit({
      stage: 'record', manifest, readText, env, now, ...patch,
    }), /P40 operator manifest rejected/);
  }
  assert.throws(() => planP40OperatorAudit({
    stage: 'full', manifest, readText, env, now,
  }), /P40 operator manifest rejected/);
});
