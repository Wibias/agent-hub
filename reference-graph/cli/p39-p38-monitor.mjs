#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

import {
  evaluateP38Health,
  planP38Alerts,
} from '../p39-p38-monitor.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log([
    'P39 P38 read-only health evaluator',
    'Usage: node reference-graph/cli/p39-p38-monitor.mjs --snapshot FILE [--state FILE] [--now ISO] [--out FILE]',
    'Exit: 0 healthy, 2 warn, 3 critical, 1 invalid input',
  ].join('\n'));
  process.exit(args.length === 0 ? 2 : 0);
}

function arg(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

try {
  const snapshotPath = arg('--snapshot');
  if (!snapshotPath) throw new Error('--snapshot is required');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const statePath = arg('--state');
  const previous = statePath ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const now = arg('--now') ? new Date(arg('--now')) : new Date();
  const report = evaluateP38Health(snapshot, { now });
  const plan = planP38Alerts(previous, report, { now });
  const output = JSON.stringify({ report, plan }, null, 2);
  const outPath = arg('--out');
  if (outPath) writeFileSync(outPath, output + '\n', 'utf8');
  else console.log(output);
  process.exit(report.severity === 'critical' ? 3 : report.severity === 'warn' ? 2 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
