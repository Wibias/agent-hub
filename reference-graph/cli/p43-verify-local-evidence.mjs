#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PIN_FILE = fileURLToPath(new URL('../evidence/p43-operator-reported-hashes-20261109.json', import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const FILES = Object.freeze({
  baseline: 'p27-baseline.json',
  publicBaseline: 'p34-public-baseline.json',
  templates: 'templates.json',
  records: 'records.json',
  patterns: 'patterns.json',
});
const CHECKED_FILES = Object.freeze(['p42-local-index.json',
  'p40-manifest-live.json','p40-witness.json','p40-record.json','p40-full.json']);
function blocked() { throw new Error('P43 local evidence verification BLOCKED'); }
function sha(b) { return createHash('sha256').update(b).digest('hex'); }
function exact(value, names) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort());
}
function json(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { blocked(); }
}

/**
 * Re-verify already archived, operator-reported P42/P40 bytes against a
 * separate Git-versioned set of operator-provided hashes.
 * These pins were not independently originated and MUST NOT be called a
 * human signature or independent source attestation.
 *
 * Archive age does NOT invalidate historical byte consistency, but also
 * cannot establish when the HTTP calls occurred.
 */
export function verifyP43LocalEvidence({
  evidenceDir,
  pins,
  readBytes = p => readFileSync(p),
  checkRealpath = p => realpathSync(p),
  checkStat = p => lstatSync(p),
} = {}) {
  if (typeof evidenceDir !== 'string' || !isAbsolute(evidenceDir)
    || !pins || pins.schema_version !== 'reference-graph.p43-operator-reported-pins.v1'
    || !HEAD.test(pins.source_checkout_sha ?? '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(pins.reference_date ?? '')
    || pins.project_ref !== 'vrznfnxzlxaavpqbzbzd'
    || pins.provenance !== 'operator-reported-not-independently-attested'
    || !SHA.test(pins.witness_sha256 ?? '')
    || !SHA.test(pins.record_sha256 ?? '')
    || !SHA.test(pins.full_sha256 ?? '')) blocked();

  const root = resolve(evidenceDir);
  if (checkRealpath(root) !== root) blocked();
  const read = name => {
    const full = resolve(root, name);
    if (checkRealpath(full) !== full || !checkStat(full).isFile()
      || checkStat(full).isSymbolicLink()) blocked();
    const bytes = readBytes(full);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 20_000_000) blocked();
    return bytes;
  };
  const index = json(read('p42-local-index.json'));
  const manifest = json(read('p40-manifest-live.json'));
  const archived = Object.fromEntries(CHECKED_FILES.slice(2).map(name => [name, read(name)]));
  const witness = json(archived['p40-witness.json']);
  const record = json(archived['p40-record.json']);
  const full = json(archived['p40-full.json']);

  if (index.schema_version !== 'reference-graph.p42-local-control-inputs.v1'
    || index.source_checkout_sha !== pins.source_checkout_sha
    || index.legacy_control_sha !== '83a3794cc54d2f2d129b83e8e672e18b35f11cff'
    || index.project_ref !== pins.project_ref
    || index.reference_date !== pins.reference_date
    || index.independent_source_attestation !== false
    || index.activation_authorized !== false
    || !exact(index.files, Object.keys(FILES))
    || manifest.schema_version !== 'reference-graph.p40-operator-manifest.v1'
    || manifest.target_url !== 'https://vrznfnxzlxaavpqbzbzd.supabase.co/'
    || manifest.approved_record_report_sha256 !== pins.record_sha256
    || !exact(manifest.files, ['sourceWitness', ...Object.keys(FILES)])) blocked();

  for (const [name, filename] of Object.entries(FILES)) {
    const bytes = read(filename);
    const file = index.files[name], item = manifest.files[name];
    if (!file || !item || file.path !== resolve(root, filename)
      || item.path !== file.path || file.bytes !== bytes.length
      || file.sha256 !== sha(bytes) || item.sha256 !== file.sha256) blocked();
  }

  if (sha(archived['p40-witness.json']) !== pins.witness_sha256
    || sha(archived['p40-record.json']) !== pins.record_sha256
    || sha(archived['p40-full.json']) !== pins.full_sha256
    || manifest.files.sourceWitness.path !== resolve(root, 'p40-witness.json')
    || manifest.files.sourceWitness.sha256 !== pins.witness_sha256
    || witness.schema_version !== 'reference-graph.p40-readonly-source-witness.v1'
    || witness.project_ref !== pins.project_ref
    || witness.source_method !== 'p7-vs-p31-read-only'
    || witness.snapshot_date !== pins.reference_date
    || witness.expected_candidate_count !== 275
    || witness.published_candidate_count !== 275
    || witness.expected_candidate_id_set_sha256 !== witness.published_candidate_id_set_sha256
    || witness.membership_mismatch_count !== 0 || witness.metadata_mismatch_count !== 0
    || witness.refresh_instant_count !== 1
    || witness.activation_authorized !== false
    || witness.repository_default_graph_enabled !== false) blocked();

  const a = record.p33_compatible_report;
  const b = full.p33_compatible_report;
  const p34 = full.p34;
  if (record.schema_version !== 'reference-graph.p40-readonly-record-parity.v1'
    || full.schema_version !== 'reference-graph.p40-readonly-full-parity.v1'
    || record.source_method !== witness.source_method
    || full.source_method !== witness.source_method
    || record.witness_sha256 !== pins.witness_sha256
    || record.reference_date !== pins.reference_date
    || full.reference_date !== pins.reference_date
    || record.refreshed_at !== witness.refreshed_at
    || full.refreshed_at !== witness.refreshed_at
    || record.activation_authorized !== false
    || full.activation_authorized !== false
    || full.repository_default_graph_enabled !== false
    || full.p40_record_report_pin_matched !== true
    || !a || !b || !p34 || JSON.stringify(a) !== JSON.stringify(b)
    || a.evaluated_cases !== 48 || a.exact_order_cases !== 48
    || a.mismatch_cases !== 0 || a.candidate_count !== 275
    || a.candidate_id_set_sha256 !== witness.expected_candidate_id_set_sha256
    || a.record_order_coverage_parity_exact !== true
    || p34.record_order_exact_cases !== 48
    || p34.pattern_exact_cases !== 48
    || p34.public_output_exact_cases !== 48
    || p34.candidate_content_bound_to_p33 !== true) blocked();

  return {
    schema_version: 'reference-graph.p43-local-byte-verification.v1',
    source_checkout_sha: pins.source_checkout_sha,
    snapshot_date: pins.reference_date,
    frozen_inputs_verified: 5,
    witness_bytes_verified: true,
    stage_one_bytes_verified: true,
    stage_two_bytes_verified: true,
    stage_one_two_snapshot_binding_consistent: true,
    record_exact_cases: 48,
    pattern_exact_cases: 48,
    public_exact_cases: 48,
    p41_local_report_bytes_verified: false,
    source_authentication_independently_attested: false,
    stage_execution_window_independently_attested: false,
    independent_human_review_attested: false,
    production_rollback_rehearsed: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}

export function runP43EvidenceCli(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--evidence-dir') blocked();
  const pins = json(readFileSync(PIN_FILE));
  const report = verifyP43LocalEvidence({ evidenceDir: argv[1], pins });
  process.stdout.write(JSON.stringify(report) + '\n');
  return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { runP43EvidenceCli(); } catch {
    process.stderr.write('P43 evidence verification BLOCKED: local files/pins/provenance invalid\n');
    process.exitCode = 2;
  }
}
