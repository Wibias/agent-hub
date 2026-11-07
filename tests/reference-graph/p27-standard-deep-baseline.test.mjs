import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPatterns, loadRecords, TAXONOMY,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { selectPatterns } from '../../knowledge/design-references/scripts/pattern-selection.mjs';
import { selectRecords } from '../../knowledge/design-references/scripts/selection.mjs';
import { evaluateP27StandardDeepBaseline } from '../../reference-graph/p27-standard-deep-baseline.mjs';

const now = new Date('2026-11-07T00:00:00.000Z');
const records = loadRecords();
const patterns = loadPatterns();
const allQuickCases = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const fixtureCases = allQuickCases.slice(0, 3);
const hashIds = (rows) => createHash('sha256')
  .update(rows.map((x) => x.id).join('\n'), 'utf8').digest('hex');

test('P27 produces a deterministic read-only Standard/Deep baseline without changing legacy contract', () => {
  const snapshot = structuredClone(fixtureCases);
  const report = evaluateP27StandardDeepBaseline({
    templates: fixtureCases, records, patterns, now,
  });
  assert.equal(report.schema_version, 'reference-graph.p27-standard-deep-baseline.v1');
  assert.equal(report.reference_date, '2026-11-07');
  assert.equal(report.source_case_count, fixtureCases.length);
  assert.equal(report.total_profile_cases, fixtureCases.length * 2);
  assert.deepEqual(report.profiles, ['standard', 'deep']);
  assert.equal(report.repository_default_graph_enabled, false);
  assert.equal(report.activation_performed, false);
  assert.equal(report.cases.length, 6);
  for (const row of report.cases) {
    assert.equal(row.authoritative_source, 'legacy-control');
    assert.ok(['standard', 'deep'].includes(row.profile));
    assert.equal(row.limit, TAXONOMY.profiles[row.profile].default);
    assert.ok(row.selected_count >= 0 && row.selected_count <= row.limit);
    assert.ok(row.pattern_count >= 0);
    assert.match(row.ordered_record_ids_sha256, /^[a-f0-9]{64}$/);
    assert.match(row.ordered_pattern_ids_sha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(row, 'records'), false);
    assert.equal(Object.hasOwn(row, 'patterns'), false);
  }
  assert.deepEqual(fixtureCases, snapshot);
  assert.deepEqual(report, evaluateP27StandardDeepBaseline({
    templates: [...fixtureCases].reverse(), records, patterns, now,
  }));
});

test('P27 case hashes match direct unchanged legacy selection and pattern ordering', () => {
  const template = fixtureCases[0];
  const report = evaluateP27StandardDeepBaseline({
    templates: [template], records, patterns, now,
  });
  for (const profile of ['standard', 'deep']) {
    const request = {
      profile,
      limit: TAXONOMY.profiles[profile].default,
      surface: template.surface,
      platform: template.platform,
      job: template.job,
      dimensions: template.dimensions,
    };
    const selection = selectRecords(records, request, { now });
    const selectedPatterns = selectPatterns(patterns, selection.selected, request);
    const row = report.cases.find((x) => x.profile === profile);
    assert.ok(row);
    assert.equal(row.ordered_record_ids_sha256, hashIds(selection.selected));
    assert.equal(row.ordered_pattern_ids_sha256, hashIds(selectedPatterns));
    assert.deepEqual(row.coverage_gap_kinds, selection.coverageGaps.map(x => x.kind ?? 'stratum'));
    assert.equal(row.selected_count, selection.selected.length);
    assert.equal(row.pattern_count, selectedPatterns.length);
  }
});

test('P27 reports profile coverage counts without fabricating eligibility', () => {
  const report = evaluateP27StandardDeepBaseline({ templates: fixtureCases, records, patterns, now });
  for (const profile of ['standard', 'deep']) {
    const rows = report.cases.filter(x => x.profile === profile);
    assert.equal(report.summary[profile].assessed_cases, rows.length);
    assert.equal(report.summary[profile].complete_cases, rows.filter(x => x.coverage_gap_kinds.length === 0).length);
    assert.equal(report.summary[profile].gap_cases, rows.filter(x => x.coverage_gap_kinds.length > 0).length);
  }
  assert.equal(Object.hasOwn(report, 'eligible'), false);
  assert.equal(Object.hasOwn(report, 'activation_authorized'), false);
});

test('P27 rejects duplicate template ids, invalid profiles, unexpected fields and malformed dates', () => {
  const evaluate = templates => evaluateP27StandardDeepBaseline({ templates, records, patterns, now });
  assert.throws(() => evaluate([fixtureCases[0], { ...fixtureCases[0] }]), /duplicate/i);
  assert.throws(() => evaluate([{ ...fixtureCases[0], profile: 'standard' }]), /quick|profile/i);
  assert.throws(() => evaluate([{ ...fixtureCases[0], activation_authorized: true }]), /unexpected|allowlist|fields/i);
  assert.throws(() => evaluate([]), /non.empty|template/i);
  assert.throws(() => evaluateP27StandardDeepBaseline({
    templates: fixtureCases, records, patterns, now: new Date('bad'),
  }), /date|now/i);
});
