#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  auditP40ReadOnlyRecordParity,
  auditP40ReadOnlyFullParity,
} from '../p40-readonly-parity.mjs';

const TARGET = 'https://vrznfnxzlxaavpqbzbzd.supabase.co/';
const SHA256 = /^[a-f0-9]{64}$/;
const FILES = Object.freeze({
  sourceWitness: ['sourceWitnessJson', 'sourceWitnessSha256'],
  baseline: ['baselineJson', 'baselineSha256'],
  templates: ['templatesJson', 'templatesSha256'],
  records: ['recordsJson', 'recordsSha256'],
  patterns: ['patternsJson', 'patternsSha256'],
  publicBaseline: ['publicBaselineJson', 'publicBaselineSha256'],
});
const RECORD_FILES = Object.freeze(['sourceWitness', 'baseline', 'templates']);
const FULL_FILES = Object.freeze([...RECORD_FILES, 'records', 'patterns', 'publicBaseline']);

function reject() {
  throw new TypeError('P40 operator manifest rejected');
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

/**
 * Assemble a P40 audit only from external, independently pinned files and
 * one operator-owned secret environment variable. No network or mutations.
 * This helper is exported for deterministic unit tests.
 */
export function planP40OperatorAudit({
  stage,
  manifest,
  readText = path => readFileSync(path, 'utf8'),
  env = process.env,
  now = new Date(),
} = {}) {
  if (!['record', 'full'].includes(stage)
    || !exactKeys(manifest, [
      'schema_version', 'target_url', 'files', 'approved_record_report_sha256',
    ])
    || manifest.schema_version !== 'reference-graph.p40-operator-manifest.v1'
    || manifest.target_url !== TARGET
    || !(now instanceof Date) || Number.isNaN(now.valueOf())
    || typeof env?.P40_SUPABASE_SECRET_KEY !== 'string'
    || !env.P40_SUPABASE_SECRET_KEY.startsWith('sb_secret_')) {
    reject();
  }
  const list = stage === 'record' ? RECORD_FILES : FULL_FILES;
  const allowed = Object.keys(manifest.files ?? {});
  if (!allowed.every(key => Object.hasOwn(FILES, key))
    || list.some(key => !Object.hasOwn(manifest.files ?? {}, key))
    || (manifest.approved_record_report_sha256 !== null
      && (typeof manifest.approved_record_report_sha256 !== 'string'
        || !SHA256.test(manifest.approved_record_report_sha256)))
    || (stage === 'full' && !SHA256.test(manifest.approved_record_report_sha256 ?? ''))) {
    reject();
  }

  const input = {
    supabaseUrl: TARGET,
    serviceKey: env.P40_SUPABASE_SECRET_KEY,
    accessMode: 'server',
    asOf: now.toISOString(),
    timeoutMs: 5000,
  };
  for (const name of list) {
    const item = manifest.files[name];
    if (!exactKeys(item, ['path', 'sha256'])
      || typeof item.path !== 'string' || !item.path.trim()
      || item.path.length > 4096 || item.path.includes('\0')
      || typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
      reject();
    }
    let raw;
    try {
      raw = readText(item.path);
    } catch {
      reject();
    }
    if (typeof raw !== 'string') reject();
    const [rawName, pinName] = FILES[name];
    input[rawName] = raw;
    input[pinName] = item.sha256;
  }
  if (stage === 'full') {
    input.expectedP40RecordReportSha256 = manifest.approved_record_report_sha256;
  }
  return { stage, input };
}

export async function runP40OperatorAudit({
  argv = process.argv.slice(2),
  env = process.env,
  readText = path => readFileSync(path, 'utf8'),
  now = new Date(),
  stdout = process.stdout,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 4
    || argv[0] !== '--stage'
    || argv[2] !== '--manifest'
    || typeof argv[3] !== 'string' || !argv[3].trim()) {
    reject();
  }
  let manifest;
  try {
    const raw = readText(argv[3]);
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 30_000) reject();
    manifest = JSON.parse(raw);
  } catch {
    reject();
  }
  const { stage, input } = planP40OperatorAudit({
    stage: argv[1], manifest, env, readText, now,
  });
  const report = stage === 'record'
    ? await auditP40ReadOnlyRecordParity(input)
    : await auditP40ReadOnlyFullParity(input);
  // NO trailing newline: Get-FileHash of redirected JSON exactly matches the
  // compact JSON byte digest checked in P40 stage two.
  stdout.write(JSON.stringify(report));
  return report;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsMain) {
  try {
    await runP40OperatorAudit();
  } catch {
    // Do not print URLs with credentials, file paths, payloads or raw errors.
    process.stderr.write('P40 read-only audit BLOCKED: input, pin, transport or parity failed\n');
    process.exitCode = 2;
  }
}
