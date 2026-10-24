#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  loadPatterns,
  loadRecords,
  parseArgs,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { selectPatterns } from '../../knowledge/design-references/scripts/pattern-selection.mjs';
import { selectRecords } from '../../knowledge/design-references/scripts/selection.mjs';
import {
  buildP8OfflineQuickCandidatePool,
  compareP8QuickHandoff,
} from '../p8-cutover-review.mjs';
import { selectP7ParityLexicalResults } from '../p7-parity-policy.mjs';
import { assertSecretFreeP8Receipt } from '../p8-receipt.mjs';
import { assessLegacyControlHealth } from '../shadow-eval.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';
import {
  assertBoundSupabaseUrl,
  readTargetBinding,
  redactDiagnostics,
} from '../target-binding.mjs';

const CASES_FILE = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));
const PRODUCTION_SOURCE = 'legacy-control';
const REQUIRED_POOL_FIELDS = Object.freeze([
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
    '  node reference-graph/cli/p8-cutover-review.mjs --offline-contract [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '  node reference-graph/cli/p8-cutover-review.mjs --supabase-quick-review --target <path> [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '',
    'P8 review is read-only. Production remains legacy-control.',
  ].join('\n');
}

function loadCases() {
  const cases = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('shadow-cases.json must contain at least one case');
  }
  for (const request of cases) {
    if (request.profile !== 'quick') {
      throw new Error('P8 graph review supports quick requests only');
    }
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
  const now = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(now.getTime()) || now.toISOString().slice(0, 10) !== raw) {
    throw new Error('--reference-date must be YYYY-MM-DD');
  }
  return { referenceDate: raw, now };
}

function requireTargetPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`P8 live review requires --target <path>.\n\n${usage()}`);
  }
  return value.trim();
}

function requireCredential(env) {
  const value = env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for P8 live review');
  }
  return value;
}

function resolveNetworkContext(args, env) {
  const target = readTargetBinding(requireTargetPath(args.target));
  assertBoundSupabaseUrl({ binding: target, supabaseUrl: env.SUPABASE_URL });
  const serviceRoleKey = requireCredential(env);
  return { target, serviceRoleKey };
}

function candidateComplete(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  return REQUIRED_POOL_FIELDS.every((field) => {
    if (!(field in row)) return false;
    if (field === 'asset_id' || field === 'legacy_id') {
      return typeof row[field] === 'string' && row[field].length > 0;
    }
    if (field === 'tags') return Array.isArray(row[field]);
    return true;
  });
}

function summarizePool(rows) {
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

function patternIds(rows) {
  return rows.map((row) => row.id);
}

function sameOrderedStrings(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function reviewCases({ records, patterns, cases, candidates, now }) {
  const rows = [];
  let exactHandoffCount = 0;
  let patternExactCount = 0;
  let hydrationFailureCount = 0;

  for (const request of cases) {
    if (request.profile !== 'quick') {
      throw new Error('P8 graph review supports quick requests only');
    }
    const legacySelection = selectRecords(records, request, { now });
    const graphSelection = selectP7ParityLexicalResults({
      candidates,
      request,
      maxItems: request.limit,
    });

    let handoff;
    try {
      handoff = compareP8QuickHandoff({
        records,
        request,
        graphLegacyIds: graphSelection.ids,
        legacySelection,
      });
    } catch (error) {
      hydrationFailureCount += 1;
      rows.push({
        case_id: request.id,
        handoff_exact: false,
        pattern_handoff_exact: false,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const legacyPatterns = selectPatterns(patterns, legacySelection.selected, request);
    const graphPatterns = selectPatterns(patterns, handoff.graph_records, request);
    const legacyPatternIds = patternIds(legacyPatterns);
    const graphPatternIds = patternIds(graphPatterns);
    const patternExact = sameOrderedStrings(legacyPatternIds, graphPatternIds);

    if (handoff.handoff_exact) exactHandoffCount += 1;
    if (patternExact) patternExactCount += 1;
    rows.push({
      case_id: request.id,
      handoff_exact: handoff.handoff_exact,
      pattern_handoff_exact: patternExact,
      legacy_ids: handoff.legacy_ids,
      graph_ids: handoff.graph_ids,
      legacy_pattern_ids: legacyPatternIds,
      graph_pattern_ids: graphPatternIds,
      missing_from_graph: handoff.missing_from_graph,
      unexpected_from_graph: handoff.unexpected_from_graph,
    });
  }

  const mismatchCount = rows.filter(
    (row) => row.handoff_exact !== true || row.pattern_handoff_exact !== true,
  ).length;

  return {
    summary: {
      status: hydrationFailureCount === 0 ? 'available' : 'blocked',
      case_count: cases.length,
      exact_handoff_count: exactHandoffCount,
      mismatch_count: mismatchCount,
      pattern_exact_count: patternExactCount,
      hydration_failure_count: hydrationFailureCount,
    },
    rows,
  };
}

function createOutput({ mode, referenceDate, target = null, records, cases, candidates, now }) {
  const patterns = loadPatterns();
  const health = assessLegacyControlHealth({ records, cases, now });
  const review = reviewCases({ records, patterns, cases, candidates, now });
  return {
    mode,
    production_source: PRODUCTION_SOURCE,
    activation_performed: false,
    production_activation_ready: false,
    reference_date: referenceDate,
    target,
    current_control_health: health,
    candidate_pool: summarizePool(candidates),
    review: review.summary,
    rows: review.rows,
  };
}

function emitOutput(output, { receiptOut, serviceRoleKey = null } = {}) {
  assertSecretFreeP8Receipt(output, [serviceRoleKey]);
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (receiptOut !== undefined) {
    if (typeof receiptOut !== 'string' || receiptOut.trim().length === 0) {
      throw new Error('--receipt-out requires a path');
    }
    writeFileSync(receiptOut.trim(), serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = [
    ['offline-contract', args['offline-contract'] === true],
    ['supabase-quick-review', args['supabase-quick-review'] === true],
  ].filter(([, enabled]) => enabled);
  if (modes.length !== 1) {
    throw new Error(`Choose exactly one P8 cutover review mode.\n\n${usage()}`);
  }

  const selectedMode = modes[0][0];
  const { referenceDate, now } = parseReferenceDate(args['reference-date']);
  const records = loadRecords();
  const cases = loadCases();
  let serviceRoleKey = null;
  let output;

  if (selectedMode === 'offline-contract') {
    const candidates = buildP8OfflineQuickCandidatePool(records, { now });
    output = createOutput({
      mode: selectedMode,
      referenceDate,
      records,
      cases,
      candidates,
      now,
    });
  } else {
    const context = resolveNetworkContext(args, process.env);
    serviceRoleKey = context.serviceRoleKey;
    const store = ReferenceGraphSupabaseStore.fromEnv(process.env);
    const candidates = await store.quickCandidatePoolP7({
      reference_date: referenceDate,
    });
    output = createOutput({
      mode: selectedMode,
      referenceDate,
      target: context.target,
      records,
      cases,
      candidates,
      now,
    });
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
