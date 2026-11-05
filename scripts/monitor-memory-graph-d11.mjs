#!/usr/bin/env node
/** D11: repeatable, read-only D8 -> D7 monitoring with optional prior receipt. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeD8EvidenceAudit } from './audit-memory-graph-d8.mjs';
import { runLiveD7 } from './validate-memory-graph-d7.mjs';
import { assessD11Observation } from '../memory-engine/memory-graph-d11-monitor.mjs';

const HELP = `D11 read-only Memory Graph monitoring (Node 24)

node scripts/monitor-memory-graph-d11.mjs --db-path FILE --repo-root ROOT
  --project-id ID --branch BRANCH [--samples 1..5] [--max-p95-ms N]
  [--previous-report JSON_FILE]

Only existing registered scopes. Default samples=5, max-p95-ms=2000.
Output contains counts, fixed status codes and operator supplied scope only.
Save stdout as a receipt externally if desired; D11 never writes any file.
Exit: 0 pass, 2 blocked, 1 fail. No automatic recapture or lifecycle changes.
`;

/** Require an explicit existing database, checkout and scope; no implicit defaults. */
export function parseD11Args(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('arguments array required');
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const flags = new Map([
    ['--db-path', 'dbPath'], ['--repo-root', 'repoRoot'],
    ['--project-id', 'projectId'], ['--branch', 'branch'],
    ['--samples', 'samples'], ['--max-p95-ms', 'maxP95Ms'],
    ['--previous-report', 'previousReport'],
  ]);
  const options = { help: false, dbPath: null, repoRoot: null,
    projectId: null, branch: null, samples: 5, maxP95Ms: 2000, previousReport: null };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new TypeError('duplicate flag');
    seen.add(flag);
    if (!flags.has(flag)) throw new TypeError('unknown flag');
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--') || value.includes('\0')) {
      throw new TypeError('invalid argument value');
    }
    options[flags.get(flag)] = value;
  }
  for (const required of ['dbPath', 'repoRoot', 'projectId', 'branch']) {
    if (!options[required]) throw new TypeError('explicit scope and paths required');
  }
  options.samples = Number(options.samples);
  options.maxP95Ms = Number(options.maxP95Ms);
  if (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 5) {
    throw new RangeError('samples must be 1..5');
  }
  if (!Number.isFinite(options.maxP95Ms) || options.maxP95Ms <= 0 || options.maxP95Ms > 600000) {
    throw new RangeError('max-p95-ms must be positive and bounded');
  }
  return options;
}

/** Complete one read-only monitoring observation and emit a sanitized report. */
export async function executeD11Monitor({ argv = [], emit = console.log } = {}) {
  const args = parseD11Args(argv);
  if (args.help) { emit(HELP); return { outcome: 'help' }; }
  const dbPath = resolve(args.dbPath);
  if (!existsSync(dbPath)) throw new Error('database_not_found');
  let previous = null;
  if (args.previousReport) {
    const path = resolve(args.previousReport);
    if (statSync(path).size > 32768) throw new TypeError('previous report exceeds size limit');
    const raw = readFileSync(path, 'utf8');
    previous = JSON.parse(raw);
  }
  const audit = await executeD8EvidenceAudit({
    argv: ['--db-path', dbPath, '--project-id', args.projectId, '--branch', args.branch],
    emit: () => {},
  });
  const live = await runLiveD7({
    dbPath, repoRoot: args.repoRoot, projectId: args.projectId, branch: args.branch,
    samples: args.samples, maxP95Ms: args.maxP95Ms,
  });
  const report = assessD11Observation({ audit, live, previous, maxP95Ms: args.maxP95Ms });
  emit(JSON.stringify(report, null, 2));
  return report;
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (import.meta.url === invoked) {
  try {
    const report = await executeD11Monitor({ argv: process.argv.slice(2) });
    if (report.outcome === 'blocked') process.exitCode = 2;
    else if (report.outcome === 'fail') process.exitCode = 1;
  } catch (error) {
    const code = error?.message === 'database_not_found' ? 'database_not_found'
      : error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError
        ? 'invalid_args_or_previous_report' : 'monitor_runtime_error';
    console.error(JSON.stringify({ schemaVersion: 1, mode: 'd11_read_only_monitor', outcome: 'fail', code }));
    process.exitCode = 1;
  }
}
