#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  TAXONOMY, loadPatterns, loadRecords,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { runP11RuntimeQuery } from '../p11-runtime-router.mjs';

const CASES_PATH = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));

function requireDate(argv) {
  if (!Array.isArray(argv) || argv.length !== 2
    || argv[0] !== '--date'
    || typeof argv[1] !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(argv[1])) {
    throw new Error('P34 freeze requires exactly --date YYYY-MM-DD');
  }
  const now = new Date(argv[1] + 'T00:00:00.000Z');
  if (!Number.isFinite(now.valueOf())
    || now.toISOString().slice(0, 10) !== argv[1]) {
    throw new Error('P34 invalid canonical UTC date');
  }
  return now;
}

/**
 * Read-only legacy-control baseline export for independent archival.
 * Does not call the P34 new selector or query live Graph.
 * Operator must pin the final artifact bytes through a separate trusted
 * channel and run from a pinned approved unchanged legacy-control revision.
 */
export async function runP34FreezeLegacyPublicBaseline({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  records = loadRecords(),
  patterns = loadPatterns(),
  templates = JSON.parse(readFileSync(CASES_PATH, 'utf8')),
} = {}) {
  const now = requireDate(argv);
  if (!Array.isArray(templates) || templates.length !== 24
    || !Array.isArray(records) || !Array.isArray(patterns)) {
    throw new Error('P34 control inputs invalid');
  }

  const sorted = [...templates].sort((a, b) => a.id.localeCompare(b.id));
  const caseIds = new Set();
  const cases = [];
  for (const template of sorted) {
    if (!template || typeof template.id !== 'string'
      || caseIds.has(template.id)
      || template.profile !== 'quick'
      || template.limit !== TAXONOMY.profiles.quick.default) {
      throw new Error('P34 control templates invalid');
    }
    caseIds.add(template.id);
    for (const profile of ['standard', 'deep']) {
      const request = {
        profile,
        limit: TAXONOMY.profiles[profile].default,
        surface: template.surface,
        platform: template.platform,
        job: template.job,
        dimensions: template.dimensions,
      };
      const control = await runP11RuntimeQuery({
        records, patterns, request,
        graphMode: 'legacy',
        recordUsageEnabled: false,
        now,
      });
      if (control.routing.authoritative_source !== 'legacy-control'
        || control.routing.attempted !== false) {
        throw new Error('P34 legacy control unexpectedly attempted Graph');
      }
      const output = JSON.stringify(control.result);
      cases.push({
        source_case_id: template.id,
        profile,
        public_output_sha256: createHash('sha256')
          .update(output, 'utf8').digest('hex'),
      });
    }
  }

  const baseline = {
    schema_version: 'reference-graph.p34-legacy-public-baseline.v1',
    reference_date: now.toISOString().slice(0, 10),
    cases,
  };
  stdout.write(JSON.stringify(baseline, null, 2) + '\n');
  return baseline;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsMain) {
  try {
    await runP34FreezeLegacyPublicBaseline();
  } catch {
    // No catalog contents, local paths, credentials or raw errors on stderr.
    process.stderr.write('P34 legacy public baseline failed: invalid offline input\n');
    process.exitCode = 1;
  }
}
