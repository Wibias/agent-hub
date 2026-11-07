import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P19_ATTESTATION_SCHEMA,
  P19_HEALTH_SAMPLE_SCHEMA,
  P19_P18_EVIDENCE_SHA256,
  P19_PRODUCTION_PROJECT_REF,
  evaluateP19PromotionReadiness,
} from '../../reference-graph/p19-production-soak.mjs';
import { verifyP26FrozenEvidence } from '../../reference-graph/p26-evidence-verifier.mjs';

const P25_SHA = '8bd9eeec1ab84ca816bb6238702d88ebba9cf0c9';
const SHA = (value) => createHash('sha256').update(value).digest('hex');

function attestation() {
  return {
    schema_version: P19_ATTESTATION_SCHEMA,
    observed_at: '2026-11-05T20:00:00.000Z',
    p18_evidence_sha256: P19_P18_EVIDENCE_SHA256,
    target_project_ref: P19_PRODUCTION_PROJECT_REF,
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

function healthySample(index, missingDiagnostics = false) {
  const sampled = new Date(Date.parse('2026-11-05T22:09:18.023Z') + index * 3_600_000);
  const sample = {
    schema_version: P19_HEALTH_SAMPLE_SCHEMA,
    sampled_at: sampled.toISOString(),
    target_project_ref: P19_PRODUCTION_PROJECT_REF,
    production_source: 'reference-graph',
    quick_graph_enabled: true,
    repository_default_graph_enabled: false,
    probe_duration_ms: 1000,
    routing: {
      quick: { authoritative_source: 'reference-graph', record_exact: true, pattern_exact: true },
      standard: { authoritative_source: 'legacy-control' },
      deep: { authoritative_source: 'legacy-control' },
    },
    healthy: true,
    blockers: [],
    collector_node_process_started_at: new Date(sampled.valueOf() - 250).toISOString(),
    collector_start_to_sample_ms: 250,
  };
  if (!missingDiagnostics) {
    sample.diagnostics = {
      schema_version: 'reference-graph.p25-probe-diagnostics.v1',
      events: [{ phase: 'p17-stage', stage: 'profile-quick', duration_ms: 13 }],
      event_loop_delay_max_ms: 0,
    };
  }
  return sample;
}

async function fixture({
  missingDiagnostics = false,
  staleEvaluation = false,
  repositorySha = P25_SHA,
  extraFileKey = false,
} = {}) {
  const archiveDir = await mkdtemp(join(tmpdir(), 'p26-frozen-'));
  const samples = Array.from({ length: 25 }, (_, index) => healthySample(index, missingDiagnostics));
  const receipt = attestation();
  const evaluation = evaluateP19PromotionReadiness({ attestation: receipt, samples });
  assert.equal(evaluation.eligible, true);
  const frozenEvaluation = staleEvaluation ? { ...evaluation, healthy_samples: 24 } : evaluation;
  const files = {
    'p25-samples.jsonl': samples.map((s) => JSON.stringify(s)).join('\n') + '\n',
    'p19-attestation.json': JSON.stringify(receipt) + '\n',
    'p19-frozen-evaluation.json': JSON.stringify(frozenEvaluation) + '\n',
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(archiveDir, name), content, 'utf8');
  }
  const manifest = {
    schema_version: 'reference-graph.p26-evidence-freeze-manifest.v1',
    frozen_at: '2026-11-07T05:22:58.000Z',
    repository_sha: repositorySha,
    production_target_ref: P19_PRODUCTION_PROJECT_REF,
    observed_samples: evaluation.observed_samples,
    healthy_samples: evaluation.healthy_samples,
    observed_window_hours: evaluation.observed_window_hours,
    observed_max_gap_minutes: evaluation.observed_max_gap_minutes,
    attestation_exact: true,
    eligible: true,
    blocker_count: 0,
    files_sha256: {
      'p25-samples.jsonl': SHA(files['p25-samples.jsonl']),
      'p19-attestation.json': SHA(files['p19-attestation.json']),
      'p19-frozen-evaluation.json': SHA(files['p19-frozen-evaluation.json']),
      'p25-earlier-evaluation.json': null,
    },
    repository_default_promotion_performed: false,
  };
  if (extraFileKey) manifest.files_sha256['../outside.json'] = '0'.repeat(64);
  const bytes = JSON.stringify(manifest) + '\n';
  await writeFile(join(archiveDir, 'manifest.json'), bytes, 'utf8');
  return { archiveDir, expectedManifestSha256: SHA(bytes) };
}

test('P26 independently verifies frozen file hashes, P25 diagnostics and official P19 evaluation', async () => {
  const result = await verifyP26FrozenEvidence(await fixture());
  assert.equal(result.schema_version, 'reference-graph.p26-frozen-evidence-verification.v1');
  assert.equal(result.verified, true);
  assert.equal(result.eligible, true);
  assert.equal(result.repository_sha, P25_SHA);
  assert.equal(result.observed_samples, 25);
  assert.equal(result.healthy_samples, 25);
  assert.equal(result.diagnostics_samples, 25);
  assert.equal(result.attestation_exact, true);
  assert.equal(result.blocker_count, 0);
});

test('P26 rejects a tampered sample file even if P19 would otherwise accept it', async () => {
  const opts = await fixture();
  await writeFile(join(opts.archiveDir, 'p25-samples.jsonl'), '{}\n');
  await assert.rejects(verifyP26FrozenEvidence(opts), /SHA256|hash|digest/i);
});

test('P26 rejects a manifest that differs from the independently approved SHA', async () => {
  const opts = await fixture();
  await assert.rejects(
    verifyP26FrozenEvidence({ ...opts, expectedManifestSha256: '0'.repeat(64) }),
    /manifest.*(?:SHA256|hash|digest)/i,
  );
});

test('P26 rejects a stale evaluation even when all manifest hashes are internally consistent', async () => {
  await assert.rejects(verifyP26FrozenEvidence(await fixture({ staleEvaluation: true })), /evaluation|mismatch/i);
});

test('P26 rejects a healthy P19 archive without P25 diagnostic events', async () => {
  await assert.rejects(verifyP26FrozenEvidence(await fixture({ missingDiagnostics: true })), /diagnostic/i);
});

test('P26 rejects another implementation SHA and unallowlisted archive filenames', async () => {
  await assert.rejects(verifyP26FrozenEvidence(await fixture({ repositorySha: 'a'.repeat(40) })), /repository.*sha|pin/i);
  await assert.rejects(verifyP26FrozenEvidence(await fixture({ extraFileKey: true })), /file|allowlist/i);
});

const verifyCli = fileURLToPath(new URL('../../reference-graph/cli/p26-verify-frozen-evidence.mjs', import.meta.url));

test('P26 CLI verifies the archive without writing to the manifest or sample files', async () => {
  const opts = await fixture();
  const manifestBefore = await readFile(join(opts.archiveDir, 'manifest.json'));
  const samplesBefore = await readFile(join(opts.archiveDir, 'p25-samples.jsonl'));
  const run = spawnSync(process.execPath, [verifyCli, opts.archiveDir, opts.expectedManifestSha256], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.verified, true);
  assert.equal(summary.manifest_sha256, opts.expectedManifestSha256);
  assert.deepEqual(await readFile(join(opts.archiveDir, 'manifest.json')), manifestBefore);
  assert.deepEqual(await readFile(join(opts.archiveDir, 'p25-samples.jsonl')), samplesBefore);
});

test('P26 CLI fails closed on unapproved hash without printing private archive path', async () => {
  const opts = await fixture();
  const run = spawnSync(process.execPath, [verifyCli, opts.archiveDir, '0'.repeat(64)], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /P26 verification failed/i);
  assert.doesNotMatch(run.stderr, /p26-frozen-|p25-samples\.jsonl/);
});
