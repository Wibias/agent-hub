#!/usr/bin/env node

import {
  loadRecords,
  parseArgs,
  readJsonl,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { validateRevalidationDecision } from '../../knowledge/design-references/scripts/revalidation-lib.mjs';
import { planP4RevalidationQueue } from '../revalidation-plan.mjs';

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/plan-revalidation.mjs --now <YYYY-MM-DD> [--completed <review-log.jsonl>] [--wave-size 50]',
    '',
    'This command is read-only and performs no network calls or writes.',
  ].join('\n');
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--now must be YYYY-MM-DD.\n\n${usage()}`);
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`--now must be YYYY-MM-DD.\n\n${usage()}`);
  }
  return date;
}

function parseWaveSize(value) {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('--wave-size must be an integer between 1 and 100');
  }
  return parsed;
}

function completedIds(path) {
  if (path === undefined) return [];
  if (path === true || typeof path !== 'string' || !path.trim()) {
    throw new Error('--completed requires a review-log JSONL path');
  }
  return readJsonl(path.trim()).map((row) => validateRevalidationDecision(row).id);
}

const args = parseArgs(process.argv.slice(2));
if (!args.now || args.now === true) {
  throw new Error(`--now <YYYY-MM-DD> is required.\n\n${usage()}`);
}

const plan = planP4RevalidationQueue({
  records: loadRecords(),
  currentNow: parseDate(String(args.now)),
  completedIds: completedIds(args.completed),
  waveSize: parseWaveSize(args['wave-size']),
});

console.log(JSON.stringify(plan, null, 2));
