import { readFile } from 'node:fs/promises';

import { SYNTHETIC_SECRET } from './runner.mjs';

const REDACTION = '[REDACTED_SYNTHETIC_SECRET]';
const VALID = new Set(['pass', 'fail', 'blocked']);

export function aggregateVerdict(assertions) {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new TypeError('at least one assertion is required');
  }
  for (const assertion of assertions) {
    if (!VALID.has(assertion.status)) throw new TypeError(`invalid assertion status: ${assertion.status}`);
  }
  if (assertions.some(({ status }) => status === 'fail')) return 'fail';
  if (assertions.some(({ status }) => status === 'blocked')) return 'blocked';
  return 'pass';
}

function redact(value) {
  if (typeof value === 'string') {
    const parts = value.split(SYNTHETIC_SECRET);
    return { value: parts.join(REDACTION), count: parts.length - 1 };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const out = value.map((item) => {
      const redacted = redact(item);
      count += redacted.count;
      return redacted.value;
    });
    return { value: out, count };
  }
  if (value && typeof value === 'object') {
    let count = 0;
    const entries = Object.entries(value).map(([key, item]) => {
      const redacted = redact(item);
      count += redacted.count;
      return [key, redacted.value];
    });
    return { value: Object.fromEntries(entries), count };
  }
  return { value, count: 0 };
}

export function buildReceipt(run, assessment) {
  const verdict = aggregateVerdict(assessment.assertions);
  const durable = {
    spec_version: '0.1.0',
    candidate: run.candidate,
    adapter: {
      revision: run.adapter_revision,
      deviations: assessment.deviations ?? [],
    },
    fixture_revision: run.fixture_revision,
    mode: assessment.mode,
    case_id: run.case_id,
    verdict,
    assertions: assessment.assertions,
    configuration: {
      network_required: run.network_required,
      ...assessment.configuration,
    },
    metrics: {
      ...run.metrics,
      ...assessment.metrics,
    },
    raw_artifacts: assessment.raw_artifacts ?? [],
    notes: assessment.notes ?? [],
    redactions: 0,
  };

  const redacted = redact(durable);
  redacted.value.redactions = redacted.count;
  return redacted.value;
}

export async function summarizeCandidate(receipts) {
  const registry = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
  const byId = new Map(receipts.map((receipt) => [receipt.case_id, receipt]));
  const missing = registry.cases.filter(({ id }) => !byId.has(id)).map(({ id }) => id);
  if (missing.length > 0) throw new Error(`missing receipts: ${missing.join(', ')}`);

  let score = 0;
  const hardGateNonPass = [];
  for (const definition of registry.cases) {
    const receipt = byId.get(definition.id);
    if (!VALID.has(receipt.verdict)) throw new Error(`${definition.id} has invalid verdict ${receipt.verdict}`);
    if (receipt.verdict === 'pass') score += definition.weight;
    if (definition.hard_gate && receipt.verdict !== 'pass') {
      hardGateNonPass.push({ case_id: definition.id, verdict: receipt.verdict });
    }
  }

  return {
    eligible: hardGateNonPass.length === 0,
    score,
    hard_gate_non_pass: hardGateNonPass,
  };
}
