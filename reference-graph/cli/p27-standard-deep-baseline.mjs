#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadPatterns,
  loadRecords,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { evaluateP27StandardDeepBaseline } from '../p27-standard-deep-baseline.mjs';

const CASES_PATH = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));

function parseUtcDate(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--date'
      || typeof argv[1] !== 'string'
      || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(argv[1])) {
    throw new Error('P27 requires exactly --date YYYY-MM-DD');
  }
  const date = new Date(argv[1] + 'T00:00:00.000Z');
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== argv[1]) {
    throw new Error('P27 requires a valid canonical UTC date');
  }
  return date;
}

/**
 * Operator-visible read-only baseline output.
 * No live Graph transport, no activation state, no local usage writes.
 */
export function runP27StandardDeepBaselineCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
} = {}) {
  const now = parseUtcDate(argv);
  const templates = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
  const report = evaluateP27StandardDeepBaseline({
    templates,
    records: loadRecords(),
    patterns: loadPatterns(),
    now,
  });
  stdout.write(JSON.stringify(report, null, 2) + '\n');
  return 0;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsMain) {
  try {
    process.exitCode = runP27StandardDeepBaselineCli();
  } catch {
    // Never emit local paths, raw records or user-supplied CLI text on error.
    process.stderr.write('P27 baseline failed: invalid input or local read error\n');
    process.exitCode = 1;
  }
}
