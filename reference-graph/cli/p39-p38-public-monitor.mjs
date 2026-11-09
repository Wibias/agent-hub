#!/usr/bin/env node

import {
  collectP38PublicHealth,
  evaluateP38PublicHealth,
  publicP38FailureReport,
} from '../p39-p38-public-health.mjs';
import {
  P39P38RuntimeError,
  createCompositeAlertSink,
  createJsonlAlertSink,
  createWebhookAlertSink,
  readP38AlertState,
  runP38MonitorCycle,
} from '../p39-p38-runtime.mjs';
import { planP38Alerts } from '../p39-p38-monitor.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log([
    'P39 P38 public freshness monitor',
    'Usage: node reference-graph/cli/p39-p38-public-monitor.mjs --state FILE --log FILE [--now ISO] [--dry-run]',
    'Environment: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, optional P39_ALERT_WEBHOOK_URL',
    'Exit: 0 healthy/none, 2 warn, 3 critical, 4 runtime/state error',
  ].join('\n'));
  process.exit(args.length === 0 ? 2 : 0);
}

function arg(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function emit(value, code) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  process.exit(code);
}

const statePath = arg('--state');
const logPath = arg('--log');
if (!statePath || !logPath) emit({ pass: false, error: 'missing-state-or-log-path' }, 4);
const now = arg('--now') ? new Date(arg('--now')) : new Date();
if (Number.isNaN(now.valueOf())) emit({ pass: false, error: 'invalid-now' }, 4);
const dryRun = args.includes('--dry-run');

let report;
try {
  const snapshot = await collectP38PublicHealth({
    supabaseUrl: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    now,
  });
  report = evaluateP38PublicHealth(snapshot, { now });
} catch (error) {
  report = publicP38FailureReport(error?.category ?? error?.name ?? 'unknown', { now });
}

try {
  if (dryRun) {
    const previous = readP38AlertState(statePath);
    const plan = planP38Alerts(previous, report, { now });
    emit({
      schema_version: 'reference-graph.p39-p38-public-monitor.v1',
      dry_run: true,
      report,
      plan,
      state_path: statePath,
      log_path: logPath,
      source_hash_verified: false,
      cron_history_verified: false,
    }, report.severity === 'critical' ? 3 : report.severity === 'warn' ? 2 : 0);
  }

  const sinks = [createJsonlAlertSink(logPath)];
  const webhookUrl = process.env.P39_ALERT_WEBHOOK_URL;
  if (webhookUrl) sinks.push(createWebhookAlertSink(webhookUrl));
  const result = await runP38MonitorCycle({
    report,
    statePath,
    sink: createCompositeAlertSink(sinks),
    now,
  });
  emit({
    schema_version: 'reference-graph.p39-p38-public-monitor.v1',
    pass: report.healthy === true,
    report,
    plan: result.plan,
    delivered: result.delivered !== null,
    state_path: statePath,
    log_path: logPath,
    source_hash_verified: false,
    cron_history_verified: false,
    auto_remediation: false,
  }, report.severity === 'critical' ? 3 : report.severity === 'warn' ? 2 : 0);
} catch (error) {
  emit({
    schema_version: 'reference-graph.p39-p38-public-monitor.v1',
    pass: false,
    error: error instanceof P39P38RuntimeError ? error.category : 'runtime-error',
    report,
    source_hash_verified: false,
    cron_history_verified: false,
  }, 4);
}
