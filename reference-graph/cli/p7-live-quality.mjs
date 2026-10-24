#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadRecords, parseArgs } from '../../knowledge/design-references/scripts/lib.mjs';
import { createP7SupabaseShadowRetriever } from '../p7-live-shadow.mjs';
import { assertSecretFreeP7Receipt } from '../p7-receipt.mjs';
import {
  assessLegacyControlHealth,
  runCatalogShadowEvaluation,
} from '../shadow-eval.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';
import {
  assertBoundSupabaseUrl,
  readTargetBinding,
  redactDiagnostics,
} from '../target-binding.mjs';

const CASES_FILE = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));
const PRODUCTION_SOURCE = 'legacy-control';
const REQUIRED_CANDIDATE_FIELDS = Object.freeze([
  'asset_id',
  'legacy_id',
  'search_text',
  'product',
  'surface_family',
  'platform',
  'page_role',
  'motion',
  'source_family',
  'topology',
  'access_status',
  'evidence_class',
  'ordinary_or_failure_prone',
  'multi_state_flow',
  'tags',
]);

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/p7-live-quality.mjs --current-control [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '  node reference-graph/cli/p7-live-quality.mjs --candidate-pool --target <path> [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '  node reference-graph/cli/p7-live-quality.mjs --supabase-p7-parity-lexical --target <path> [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '',
    'All P7 modes are read-only. production_source remains legacy-control.',
  ].join('\n');
}

function loadCases() {
  const cases = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('shadow-cases.json must contain at least one case');
  }
  return cases;
}

function parseReferenceDate(value) {
  const raw = value === undefined
    ? new Date().toISOString().slice(0, 10)
    : String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('--reference-date must be YYYY-MM-DD');
  }
  const date = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Error('--reference-date must be YYYY-MM-DD');
  }
  return { referenceDate: raw, controlNow: date };
}

function requireTargetPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`P7 live network modes require --target <path>.\n\n${usage()}`);
  }
  return value.trim();
}

function requireCredential(env) {
  const value = env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for P7 live network modes');
  }
  return value;
}

function resolveNetworkContext(args, env) {
  const target = readTargetBinding(requireTargetPath(args.target));
  assertBoundSupabaseUrl({ binding: target, supabaseUrl: env.SUPABASE_URL });
  const serviceRoleKey = requireCredential(env);
  return { target, serviceRoleKey };
}

function baseOutput(mode, referenceDate, target = null) {
  return {
    mode,
    production_source: PRODUCTION_SOURCE,
    reference_date: referenceDate,
    target,
    current_control_health: null,
    candidate_pool: null,
    status: null,
    summary: null,
  };
}

function emitOutput(output, { receiptOut, serviceRoleKey = null } = {}) {
  assertSecretFreeP7Receipt(output, [serviceRoleKey]);
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (receiptOut !== undefined) {
    if (typeof receiptOut !== 'string' || receiptOut.trim().length === 0) {
      throw new Error('--receipt-out requires a path');
    }
    writeFileSync(receiptOut.trim(), serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

function currentControlEvidence(referenceDate, controlNow) {
  const records = loadRecords();
  const cases = loadCases();
  return {
    records,
    cases,
    health: assessLegacyControlHealth({ records, cases, now: controlNow }),
    reference_date: referenceDate,
  };
}

function candidateComplete(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  return REQUIRED_CANDIDATE_FIELDS.every((field) => {
    if (!(field in row)) return false;
    if (field === 'legacy_id' || field === 'asset_id') {
      return typeof row[field] === 'string' && row[field].length > 0;
    }
    if (field === 'tags') return Array.isArray(row[field]);
    return true;
  });
}

function summarizeCandidatePool(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const legacyIds = list
    .map((row) => row?.legacy_id)
    .filter((value) => typeof value === 'string' && value.length > 0);
  return {
    status: 'available',
    eligible_count: list.length,
    complete_metadata_count: list.filter(candidateComplete).length,
    unique_legacy_id_count: new Set(legacyIds).size,
  };
}

async function readCandidatePool(store, referenceDate) {
  const rows = await store.quickCandidatePoolP7({ reference_date: referenceDate });
  return {
    rows,
    summary: summarizeCandidatePool(rows),
  };
}

async function parityEvidence({ target, store, referenceDate, controlNow }) {
  const { records, cases, health } = currentControlEvidence(referenceDate, controlNow);
  if (health.healthy !== true) {
    return {
      ...baseOutput('supabase-p7-parity-lexical', referenceDate, target),
      current_control_health: health,
      status: 'blocked',
      blockers: ['current legacy control is unhealthy'],
      case_count: cases.length,
      rows: [],
    };
  }

  const pool = await readCandidatePool(store, referenceDate);
  const graphRetrieve = createP7SupabaseShadowRetriever({ store });
  const evaluation = await runCatalogShadowEvaluation({
    records,
    cases,
    graphRetrieve,
    controlNow,
  });
  if (evaluation.production_source !== PRODUCTION_SOURCE) {
    throw new Error(`unexpected production source: ${evaluation.production_source}`);
  }

  return {
    ...baseOutput('supabase-p7-parity-lexical', referenceDate, target),
    current_control_health: health,
    candidate_pool: pool.summary,
    status: 'available',
    case_count: cases.length,
    control_health: evaluation.control_health,
    summary: evaluation.summary,
    latency_ms: evaluation.summary.latency_ms,
    rows: evaluation.rows,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = [
    ['current-control', args['current-control'] === true],
    ['candidate-pool', args['candidate-pool'] === true],
    ['supabase-p7-parity-lexical', args['supabase-p7-parity-lexical'] === true],
  ].filter(([, enabled]) => enabled);

  if (modes.length !== 1) {
    throw new Error(`Choose exactly one P7 live quality mode.\n\n${usage()}`);
  }

  const selectedMode = modes[0][0];
  const { referenceDate, controlNow } = parseReferenceDate(args['reference-date']);
  let serviceRoleKey = null;
  let output;

  if (selectedMode === 'current-control') {
    const { health } = currentControlEvidence(referenceDate, controlNow);
    output = {
      ...baseOutput('current-control', referenceDate),
      current_control_health: health,
      status: health.healthy ? 'available' : 'blocked',
    };
  } else {
    const context = resolveNetworkContext(args, process.env);
    serviceRoleKey = context.serviceRoleKey;
    const { target } = context;
    const store = ReferenceGraphSupabaseStore.fromEnv(process.env);

    if (selectedMode === 'candidate-pool') {
      const pool = await readCandidatePool(store, referenceDate);
      output = {
        ...baseOutput('candidate-pool', referenceDate, target),
        candidate_pool: pool.summary,
        status: 'available',
        rows: pool.rows,
      };
    } else {
      output = await parityEvidence({
        target,
        store,
        referenceDate,
        controlNow,
      });
    }
  }

  emitOutput(output, {
    receiptOut: args['receipt-out'],
    serviceRoleKey,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactDiagnostics(message, [process.env.SUPABASE_SERVICE_ROLE_KEY]));
  process.exitCode = 1;
});
