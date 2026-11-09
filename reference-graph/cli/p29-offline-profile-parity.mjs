#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { evaluateP27StandardDeepBaseline } from '../p27-standard-deep-baseline.mjs';
import { buildP28OfflineProfileCandidatePool } from '../p28-profile-candidate-contract.mjs';
import { compareP29OfflineProfileParity } from '../p29-offline-profile-parity.mjs';

const CASES_PATH = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));

function parseDate(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--date'
      || typeof argv[1] !== 'string'
      || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(argv[1])) {
    throw new Error('P29 expects an explicit UTC date');
  }
  const parsed = new Date(argv[1] + 'T00:00:00.000Z');
  if (Number.isNaN(parsed.valueOf())
      || parsed.toISOString().slice(0, 10) !== argv[1]) {
    throw new Error('P29 date is not canonical');
  }
  return parsed;
}

/** Read-only, network-free comparison of two independently selected local paths. */
export function runP29OfflineParityCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
} = {}) {
  const now = parseDate(argv);
  const templates = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
  const records = loadRecords();
  const patterns = loadPatterns();
  const baseline = evaluateP27StandardDeepBaseline({
    templates, records, patterns, now,
  });
  const candidates = buildP28OfflineProfileCandidatePool({ records, now });
  const report = compareP29OfflineProfileParity({
    templates,
    candidates,
    baseline,
    expectedReferenceDate: now.toISOString().slice(0, 10),
  });
  stdout.write(JSON.stringify(report, null, 2) + '\n');
  // A mismatch is evidence, not success. Caller can inspect the output.
  return report.mismatch_cases === 0 ? 0 : 2;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsMain) {
  try {
    process.exitCode = runP29OfflineParityCli();
  } catch {
    // Never print local filenames, catalog details, source records or secrets.
    process.stderr.write('P29 offline parity failed: invalid input or local read error\n');
    process.exitCode = 1;
  }
}
