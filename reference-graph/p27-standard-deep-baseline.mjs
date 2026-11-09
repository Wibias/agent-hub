import { createHash } from 'node:crypto';

import { TAXONOMY } from '../knowledge/design-references/scripts/lib.mjs';
import { selectPatterns } from '../knowledge/design-references/scripts/pattern-selection.mjs';
import { selectRecords } from '../knowledge/design-references/scripts/selection.mjs';

const SCHEMA = 'reference-graph.p27-standard-deep-baseline.v1';
const PROFILES = Object.freeze(['standard', 'deep']);
const TEMPLATE_KEYS = Object.freeze([
  'id', 'profile', 'limit', 'surface', 'platform', 'job', 'dimensions',
]);

function requireRows(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`P27 ${name} must be an array`);
  return value;
}

function hashOrderedIds(rows) {
  return createHash('sha256').update(rows.map(row => row.id).join('\n'), 'utf8').digest('hex');
}

function hasExactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requireTemplates(templates) {
  requireRows(templates, 'templates');
  if (templates.length === 0) throw new Error('P27 templates must be non-empty');
  const ids = new Set();
  for (const row of templates) {
    if (!hasExactKeys(row, TEMPLATE_KEYS)) {
      throw new Error('P27 template contains unexpected fields or missing fields');
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)) {
      throw new Error('P27 template id is invalid');
    }
    if (ids.has(row.id)) throw new Error('P27 duplicate template id');
    ids.add(row.id);
    if (row.profile !== 'quick' || row.limit !== TAXONOMY.profiles.quick.default) {
      throw new Error('P27 source template must use the unchanged Quick profile and default limit');
    }
    if (!Object.hasOwn(TAXONOMY.surfaceFamilies, row.surface)
        || !Object.hasOwn(TAXONOMY.platformTargets, row.platform)
        || !['job', 'dimensions'].every(key => typeof row[key] === 'string' && row[key].trim().length > 0)) {
      throw new Error('P27 invalid template request metadata');
    }
  }
  return [...templates].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Read-only, network-free Standard/Deep baseline. It invokes unchanged legacy
 * selectors with the declared profile sizes and hashes ordered identities.
 * No production routing code, activation, local usage log or Graph transport.
 */
export function evaluateP27StandardDeepBaseline({
  templates,
  records,
  patterns,
  now,
} = {}) {
  const rows = requireTemplates(templates);
  requireRows(records, 'records');
  requireRows(patterns, 'patterns');
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
    throw new TypeError('P27 now must be a valid Date');
  }

  const cases = [];
  for (const template of rows) {
    for (const profile of PROFILES) {
      const request = {
        profile,
        limit: TAXONOMY.profiles[profile].default,
        surface: template.surface,
        platform: template.platform,
        job: template.job,
        dimensions: template.dimensions,
      };
      const selected = selectRecords(records, request, { now });
      const selectedPatterns = selectPatterns(patterns, selected.selected, request);
      cases.push({
        source_case_id: template.id,
        profile,
        limit: request.limit,
        authoritative_source: 'legacy-control',
        selected_count: selected.selected.length,
        pattern_count: selectedPatterns.length,
        coverage_gap_kinds: selected.coverageGaps.map(gap => gap.kind ?? 'stratum'),
        ordered_record_ids_sha256: hashOrderedIds(selected.selected),
        ordered_pattern_ids_sha256: hashOrderedIds(selectedPatterns),
      });
    }
  }

  const summary = {};
  for (const profile of PROFILES) {
    const assessed = cases.filter(row => row.profile === profile);
    summary[profile] = {
      assessed_cases: assessed.length,
      complete_cases: assessed.filter(row => row.coverage_gap_kinds.length === 0).length,
      gap_cases: assessed.filter(row => row.coverage_gap_kinds.length > 0).length,
    };
  }
  return {
    schema_version: SCHEMA,
    reference_date: now.toISOString().slice(0, 10),
    source_case_count: rows.length,
    total_profile_cases: cases.length,
    profiles: [...PROFILES],
    summary,
    cases,
    repository_default_graph_enabled: false,
    activation_performed: false,
  };
}
