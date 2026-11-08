import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, statSync, unlinkSync, writeFileSync, appendFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import {
  P39_P38_ALERT_SCHEMA,
  P39_P38_STATE_SCHEMA,
  planP38Alerts,
} from './p39-p38-monitor.mjs';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOCK_STALE_MS = 10 * 60 * 1000;

export class P39P38RuntimeError extends Error {
  constructor(category) {
    super('P39 P38 runtime failed: ' + category);
    this.name = 'P39P38RuntimeError';
    this.category = category;
  }
}

function validInstant(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateState(state) {
  return exactKeys(state, [
    'schema_version', 'severity', 'alert_key', 'last_alert_at',
    'healthy_probe_count', 'last_healthy_at', 'observed_at',
  ])
    && state.schema_version === P39_P38_STATE_SCHEMA
    && ['ok', 'warn', 'critical'].includes(state.severity)
    && typeof state.alert_key === 'string'
    && (state.last_alert_at === null || validInstant(state.last_alert_at))
    && Number.isInteger(state.healthy_probe_count) && state.healthy_probe_count >= 0
    && (state.last_healthy_at === null || validInstant(state.last_healthy_at))
    && validInstant(state.observed_at);
}

function parseState(path) {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return validateState(value) ? value : null;
  } catch {
    return null;
  }
}

export function readP38AlertState(statePath) {
  return parseState(statePath) ?? parseState(statePath + '.bak');
}

export function writeP38AlertStateAtomic(statePath, state) {
  if (!validateState(state)) throw new P39P38RuntimeError('state-invalid');
  mkdirSync(dirname(statePath), { recursive: true });
  const tmp = statePath + '.tmp-' + process.pid + '-' + Date.now();
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (existsSync(statePath)) {
    try { copyFileSync(statePath, statePath + '.bak'); } catch { /* backup is best effort */ }
  }
  try {
    renameSync(tmp, statePath);
  } catch {
    if (existsSync(statePath)) unlinkSync(statePath);
    renameSync(tmp, statePath);
  }
}

function acquireStateLock(statePath, { staleMs = LOCK_STALE_MS } = {}) {
  const lockPath = statePath + '.lock';
  mkdirSync(dirname(statePath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }), 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      return lockPath;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw new P39P38RuntimeError('state-lock-failed');
      let stale = false;
      try {
        const value = JSON.parse(readFileSync(lockPath, 'utf8'));
        const created = Date.parse(value.created_at);
        stale = !Number.isFinite(created) || Date.now() - created > staleMs;
      } catch {
        try {
          const stats = statSync(lockPath);
          stale = Date.now() - stats.mtimeMs > staleMs;
        } catch {
          stale = true;
        }
      }
      if (!stale) throw new P39P38RuntimeError('state-locked');
      try { unlinkSync(lockPath); } catch { /* retry once */ }
    }
  }
  throw new P39P38RuntimeError('state-locked');
}

function releaseStateLock(lockPath) {
  try { unlinkSync(lockPath); } catch { /* already gone */ }
}

export function createJsonlAlertSink(logPath) {
  mkdirSync(dirname(logPath), { recursive: true });
  return async event => {
    appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf8');
  };
}

export function createWebhookAlertSink(url, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (typeof url !== 'string' || !/^https:\/\//.test(url) || typeof fetchImpl !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new P39P38RuntimeError('invalid-webhook');
  }
  return async event => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      if (!response?.ok) throw new P39P38RuntimeError('webhook-http');
    } catch (error) {
      if (error instanceof P39P38RuntimeError) throw error;
      throw new P39P38RuntimeError(controller.signal.aborted ? 'webhook-timeout' : 'webhook-network');
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createCompositeAlertSink(sinks) {
  if (!Array.isArray(sinks) || sinks.length === 0 || sinks.some(fn => typeof fn !== 'function')) {
    throw new P39P38RuntimeError('invalid-sink');
  }
  return async event => {
    for (const sink of sinks) await sink(event);
  };
}

export async function deliverP38Alert(plan, report, sink) {
  if (plan.action !== 'page' && plan.action !== 'resolve') return null;
  if (typeof sink !== 'function') throw new P39P38RuntimeError('missing-alert-sink');
  const event = {
    schema_version: 'reference-graph.p39-p38-alert-event.v1',
    action: plan.action,
    severity: plan.severity,
    codes: plan.codes,
    alert_key: plan.alert_key,
    scope: report.scope ?? 'full-health',
    observed_at: report.observed_at,
    checked_at: report.checked_at,
    auto_remediation: false,
  };
  await sink(event);
  return event;
}

export async function runP38MonitorCycle({ report, statePath, sink, now = new Date() } = {}) {
  if (!report || report.schema_version !== P39_P38_ALERT_SCHEMA
    || !(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new P39P38RuntimeError('invalid-cycle-input');
  }
  const lockPath = acquireStateLock(statePath);
  try {
    const previous = readP38AlertState(statePath);
    const plan = planP38Alerts(previous, report, { now });
    let delivered = null;
    if (plan.action === 'page' || plan.action === 'resolve') {
      try {
        delivered = await deliverP38Alert(plan, report, sink);
      } catch (error) {
        throw error instanceof P39P38RuntimeError
          ? error : new P39P38RuntimeError('delivery-failed');
      }
    }
    writeP38AlertStateAtomic(statePath, plan.next_state);
    return { plan, delivered };
  } finally {
    releaseStateLock(lockPath);
  }
}
