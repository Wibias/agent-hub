#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { evaluateP63ProtectedCoverage } from '../p63-protected-http-coverage.mjs';

function blocked() { throw new TypeError('P63 coverage audit BLOCKED'); }
function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

/** Reads a private, sanitized report only; no credentials, DB or HTTP. */
export function runP63CoverageCli({
  argv = process.argv.slice(2),
  readText = path => readFileSync(path, 'utf8'),
  stdout = process.stdout,
  now = new Date(),
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--input'
    || typeof argv[1] !== 'string' || !argv[1].trim()
    || argv[1].length > 4096 || argv[1].includes('\0')) blocked();
  let input;
  try {
    const raw = readText(argv[1]);
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 200000) blocked();
    input = JSON.parse(raw);
  } catch { blocked(); }
  if (!exact(input, ['schema_version', 'window_start_utc',
    'window_end_utc', 'edge_windows', 'operator_observations'])
    || input.schema_version !== 'reference-graph.p63-operator-coverage-input.v1') blocked();
  const report = evaluateP63ProtectedCoverage({
    startedAt: input.window_start_utc,
    endedAt: input.window_end_utc,
    edgeRows: input.edge_windows,
    operatorObservations: input.operator_observations,
    asOf: now,
  });
  stdout.write(JSON.stringify(report) + '\n');
  return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { runP63CoverageCli(); }
  catch {
    process.stderr.write('P63 protected HTTP coverage BLOCKED\n');
    process.exitCode = 2;
  }
}
