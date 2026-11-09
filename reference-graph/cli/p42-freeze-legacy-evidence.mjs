#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync, openSync, closeSync, writeFileSync, readFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadRecords, loadPatterns, stripInternal,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { evaluateP27StandardDeepBaseline } from '../p27-standard-deep-baseline.mjs';
import { runP34FreezeLegacyPublicBaseline } from './p34-freeze-legacy-public-baseline.mjs';

const CONTROL_SHA = '83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const PROJECT = 'vrznfnxzlxaavpqbzbzd';
const SHA256 = /^[a-f0-9]{64}$/;
const CASES = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));
const CONTROL_FILES = Object.freeze([
  'knowledge/design-references',
  'reference-graph/p11-runtime-router.mjs',
  'reference-graph/p27-standard-deep-baseline.mjs',
  'reference-graph/cli/p27-standard-deep-baseline.mjs',
  'reference-graph/cli/p34-freeze-legacy-public-baseline.mjs',
  'reference-graph/shadow-cases.json',
  'reference-graph/p7-parity-policy.mjs',
  'reference-graph/p8-cutover-review.mjs',
]);

function reject() {
  throw new Error('P42 legacy evidence freeze BLOCKED');
}
function digest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function runGit(args) {
  const r = spawnSync('git', args, {
    shell: false, encoding: 'utf8', timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') reject();
  return r.stdout.trim();
}

/**
 * Check that the supplied Legacy control inputs are byte-unchanged from the
 * owner-approved #274 merge. Uses Git's original blobs, not a self-generated
 * baseline hash. Does NOT independently attest the human review process.
 */
export function verifyP42LegacyCheckout({
  command = runGit, cwd = process.cwd(),
} = {}) {
  if (typeof command !== 'function') reject();
  const root = command(['rev-parse', '--show-toplevel']);
  const head = command(['rev-parse', 'HEAD']);
  if (resolve(root) !== resolve(cwd) || !SHA256.test(head)) reject();
  command(['merge-base', '--is-ancestor', CONTROL_SHA, head]);
  command(['diff', '--exit-code', '--quiet', CONTROL_SHA, head, '--', ...CONTROL_FILES]);
  command(['diff', '--exit-code', '--quiet', '--', ...CONTROL_FILES]);
  if (command(['ls-files', '--others', '--exclude-standard', '--', ...CONTROL_FILES])) reject();
  return { checkout_sha: head, control_commit_sha: CONTROL_SHA };
}

function requireDate(date) {
  if (typeof date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(date)) reject();
  const now = new Date(date + 'T00:00:00.000Z');
  if (!Number.isFinite(now.valueOf()) || now.toISOString().slice(0, 10) !== date) reject();
  return now;
}

/**
 * Pure preparation of local-only evidence inputs, no secret, no network,
 * no database interaction or activation. Output is NOT an independent pin.
 */
export async function buildP42LegacyInputs({
  date, records, patterns, templatesRaw,
} = {}) {
  const now = requireDate(date);
  if (!Array.isArray(records) || records.length === 0
    || !Array.isArray(patterns) || patterns.length === 0
    || typeof templatesRaw !== 'string'
    || Buffer.byteLength(templatesRaw, 'utf8') > 200_000) reject();
  let templates;
  try { templates = JSON.parse(templatesRaw); } catch { reject(); }
  if (!Array.isArray(templates) || templates.length !== 24) reject();
  const baseline = evaluateP27StandardDeepBaseline({
    templates, records, patterns, now,
  });
  if (baseline.total_profile_cases !== 48 || baseline.cases?.length !== 48
    || baseline.reference_date !== date) reject();

  let publicBaselineJson = '';
  const publicBaseline = await runP34FreezeLegacyPublicBaseline({
    argv: ['--date', date],
    records, patterns, templates,
    stdout: { write(value) { publicBaselineJson += value; } },
  });
  if (publicBaseline.reference_date !== date
    || publicBaseline.cases?.length !== 48
    || publicBaselineJson.length === 0) reject();

  return {
    baseline: JSON.stringify(baseline, null, 2) + '\n',
    publicBaseline: publicBaselineJson,
    templates: templatesRaw,
    records: JSON.stringify(records.map(stripInternal)),
    patterns: JSON.stringify(patterns.map(stripInternal)),
  };
}

/**
 * Write an entirely new, private local directory. Never reuse an existing
 * path or generate an authorizing P31 receipt, attested pin or approval.
 */
export async function freezeP42LocalEvidence({
  date,
  outputDir,
  verifyCheckout = verifyP42LegacyCheckout,
  readText = path => readFileSync(path, 'utf8'),
  records = loadRecords(),
  patterns = loadPatterns(),
  observedAt = new Date(),
} = {}) {
  if (typeof outputDir !== 'string' || !isAbsolute(outputDir)
    || outputDir.trim().length === 0
    || !(observedAt instanceof Date) || Number.isNaN(observedAt.valueOf())
    || typeof verifyCheckout !== 'function') reject();
  const revision = verifyCheckout();
  if (!revision || !SHA256.test(revision.checkout_sha)
    || revision.control_commit_sha !== CONTROL_SHA) reject();
  const data = await buildP42LegacyInputs({
    date, records, patterns, templatesRaw: readText(CASES),
  });
  const names = Object.freeze({
    baseline: 'p27-baseline.json',
    publicBaseline: 'p34-public-baseline.json',
    templates: 'templates.json',
    records: 'records.json',
    patterns: 'patterns.json',
  });
  const root = resolve(outputDir);
  const files = Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key, {
      path: resolve(root, names[key]),
      sha256: digest(value),
      bytes: Buffer.byteLength(value, 'utf8'),
    },
  ]));
  const index = {
    schema_version: 'reference-graph.p42-local-control-inputs.v1',
    project_ref: PROJECT,
    source_checkout_sha: revision.checkout_sha,
    legacy_control_sha: CONTROL_SHA,
    reference_date: date,
    observed_at: observedAt.toISOString(),
    files,
    independent_source_attestation: false,
    independent_report_attestation: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
  // Deliberately NOT accepted by the P40 CLI until a separately acquired,
  // externally attested current P40 witness + its SHA256 are supplied.
  const manifest = {
    schema_version: 'reference-graph.p40-operator-manifest.v1',
    target_url: 'https://' + PROJECT + '.supabase.co/',
    approved_record_report_sha256: null,
    files: {
      sourceWitness: {
        path: resolve(root, 'p40-witness.json'),
        sha256: 'UNATTESTED',
      },
      ...Object.fromEntries(Object.entries(files).map(([key, file]) => [
        key, { path: file.path, sha256: file.sha256 },
      ])),
    },
  };

  // All expensive validation occurs before the exclusive directory creation.
  try {
    mkdirSync(root, { recursive: false, mode: 0o700 });
    const write = (name, body) => {
      const fd = openSync(resolve(root, name), 'wx', 0o600);
      try { writeFileSync(fd, body, 'utf8'); } finally { closeSync(fd); }
    };
    for (const [key, value] of Object.entries(data)) write(names[key], value);
    write('p42-local-index.json', JSON.stringify(index, null, 2) + '\n');
    write('p40-manifest-DRAFT.json', JSON.stringify(manifest, null, 2) + '\n');
  } catch {
    // Fail closed. Never overwrite or silently repair an incomplete directory.
    reject();
  }
  return {
    schema_version: 'reference-graph.p42-freeze-summary.v1',
    source_checkout_sha: revision.checkout_sha,
    reference_date: date,
    artifact_count: Object.keys(files).length,
    local_directory_created: true,
    witness_attested: false,
    independent_review_attested: false,
    activation_authorized: false,
  };
}

export async function runP42FreezeCli(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv) || argv.length !== 4
    || argv[0] !== '--date' || argv[2] !== '--out-dir') reject();
  const result = await freezeP42LocalEvidence({
    date: argv[1], outputDir: argv[3],
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await runP42FreezeCli(); } catch {
    // Never disclose record or pattern contents, local paths or credentials.
    process.stderr.write('P42 legacy evidence freeze BLOCKED\n');
    process.exitCode = 2;
  }
}
