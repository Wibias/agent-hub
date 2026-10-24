import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { adaptLegacyDesignReference } from '../../reference-graph/legacy-import.mjs';
import { selectP7ParityLexicalResults } from '../../reference-graph/p7-parity-policy.mjs';
import {
  isFresh,
  loadRecords,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { selectRecords } from '../../knowledge/design-references/scripts/selection.mjs';

const CONTROL_NOW = new Date('2026-10-23T12:00:00.000Z');

function candidate(overrides = {}) {
  return {
    asset_id: overrides.asset_id ?? `asset-${overrides.legacy_id ?? 'base'}`,
    legacy_id: overrides.legacy_id ?? 'ref-base',
    search_text: '',
    product: 'Product Base',
    surface_family: 'other-surface',
    platform: 'other-platform',
    page_role: 'product surface',
    motion: 'none',
    source_family: 'source-base',
    topology: 'topology-base',
    access_status: 'PAYWALLED',
    evidence_class: 'OBSERVED',
    ordinary_or_failure_prone: false,
    multi_state_flow: false,
    tags: ['baseline'],
    ...overrides,
  };
}

function quickRequest(overrides = {}) {
  return {
    profile: 'quick',
    limit: overrides.limit ?? 2,
    surface: overrides.surface,
    platform: overrides.platform,
    job: overrides.job ?? '',
    dimensions: overrides.dimensions ?? '',
    ...overrides,
  };
}

function traceById(result, id) {
  const row = result.diagnostics?.selection_trace?.find((item) => item.legacy_id === id);
  assert.ok(row, `missing selection trace for ${id}`);
  return row;
}

function graphCandidateFromRecord(record) {
  const capture = adaptLegacyDesignReference(record);
  const topology = capture.observations.find(
    (row) => row.observation_kind === 'topology',
  )?.body ?? null;
  return {
    asset_id: capture.asset.id,
    legacy_id: capture.asset.metadata.legacy_id,
    search_text: capture.chunks.map((row) => row.content).join('\n'),
    product: capture.asset.metadata.product,
    surface_family: capture.asset.metadata.surface_family,
    platform: capture.asset.metadata.platform,
    page_role: capture.asset.metadata.page_role,
    motion: capture.asset.metadata.motion,
    source_family: capture.source.source_family,
    topology,
    access_status: capture.asset.metadata.access_status,
    evidence_class: capture.asset.metadata.evidence_class,
    ordinary_or_failure_prone: capture.asset.metadata.ordinary_or_failure_prone,
    multi_state_flow: capture.asset.metadata.multi_state_flow,
    tags: capture.tags,
  };
}

test('P7 parity score reproduces every frozen legacy quick static component exactly', () => {
  const request = quickRequest({
    limit: 1,
    surface: 'target-surface',
    platform: 'target-platform',
    job: 'alpha beta',
  });
  const row = candidate({
    legacy_id: 'ref-score',
    surface_family: 'target-surface',
    platform: 'target-platform',
    search_text: 'alpha beta gamma',
    multi_state_flow: true,
    ordinary_or_failure_prone: true,
    evidence_class: 'TESTED',
    access_status: 'AVAILABLE',
  });

  const result = selectP7ParityLexicalResults({ candidates: [row], request, maxItems: 1 });
  const trace = traceById(result, 'ref-score');

  assert.equal(trace.base_score, 60 + 15 + (4 * 5) + 4 + 3 + 3 + 2);
  assert.equal(trace.diversity_penalty, 0);
  assert.equal(trace.adjusted_score, 107);
});

test('P7 parity tokenization reconstructs legacy search text from chunk text plus surface and motion', () => {
  const request = quickRequest({
    limit: 2,
    surface: 'public-home',
    job: 'hero launch',
    dimensions: 'motion',
  });
  const matching = candidate({
    legacy_id: 'ref-z-match',
    search_text: 'Hero, launch!',
    surface_family: 'public-home',
    motion: 'Motion-rich',
  });
  const nonmatching = candidate({
    legacy_id: 'ref-a-nonmatch',
    search_text: 'unrelated words',
    surface_family: 'other-surface',
    motion: 'none',
  });

  const result = selectP7ParityLexicalResults({
    candidates: [nonmatching, matching],
    request,
    maxItems: 2,
  });
  assert.equal(traceById(result, 'ref-z-match').overlap_count, 5);
  assert.deepEqual(result.ids, ['ref-z-match', 'ref-a-nonmatch']);
});

test('P7 visual request applies the frozen visual-verified boost and help/docs penalty', () => {
  const request = quickRequest({ limit: 3, dimensions: 'visual-world typography' });
  const verified = candidate({
    legacy_id: 'ref-z-verified',
    tags: ['visual-verified'],
  });
  const neutral = candidate({ legacy_id: 'ref-m-neutral' });
  const help = candidate({
    legacy_id: 'ref-a-help',
    page_role: 'Help guide',
  });

  const result = selectP7ParityLexicalResults({
    candidates: [help, neutral, verified],
    request,
    maxItems: 3,
  });

  assert.equal(traceById(result, 'ref-z-verified').base_score, 25);
  assert.equal(traceById(result, 'ref-m-neutral').base_score, 0);
  assert.equal(traceById(result, 'ref-a-help').base_score, -20);
  assert.deepEqual(result.ids, ['ref-z-verified', 'ref-m-neutral', 'ref-a-help']);
});

test('P7 diversity penalties reproduce frozen product source and topology values', () => {
  const request = quickRequest({
    limit: 4,
    surface: 'target-surface',
    platform: 'target-platform',
    job: 'alpha',
  });
  const first = candidate({
    legacy_id: 'ref-00-first',
    product: 'Shared Product',
    source_family: 'shared-source',
    topology: 'shared-topology',
    surface_family: 'target-surface',
    platform: 'target-platform',
    search_text: 'alpha',
  });
  const productRepeat = candidate({
    legacy_id: 'ref-10-product-repeat',
    product: 'Shared Product',
    source_family: 'product-own-source',
    topology: 'product-own-topology',
    platform: 'target-platform',
    search_text: 'alpha',
  });
  const sourceRepeat = candidate({
    legacy_id: 'ref-20-source-repeat',
    product: 'source-own-product',
    source_family: 'shared-source',
    topology: 'source-own-topology',
    multi_state_flow: true,
    ordinary_or_failure_prone: true,
    access_status: 'AVAILABLE',
  });
  const topologyRepeat = candidate({
    legacy_id: 'ref-30-topology-repeat',
    product: 'topology-own-product',
    source_family: 'topology-own-source',
    topology: 'shared-topology',
    multi_state_flow: true,
    access_status: 'AVAILABLE',
  });

  const result = selectP7ParityLexicalResults({
    candidates: [first, productRepeat, sourceRepeat, topologyRepeat],
    request,
    maxItems: 4,
  });

  assert.equal(traceById(result, 'ref-10-product-repeat').diversity_penalty, 20);
  assert.equal(traceById(result, 'ref-20-source-repeat').diversity_penalty, 8);
  assert.equal(traceById(result, 'ref-30-topology-repeat').diversity_penalty, 6);
});

test('P7 constructive quick coverage preserves jointly feasible surface and platform minima', () => {
  const request = quickRequest({
    limit: 4,
    surface: 'wanted-surface',
    platform: 'wanted-platform',
    job: 'high score',
  });
  const highNonmatches = [1, 2, 3, 4].map((index) => candidate({
    legacy_id: `ref-high-${index}`,
    search_text: 'high score extra',
    product: `product-high-${index}`,
    source_family: `source-high-${index}`,
    topology: `topology-high-${index}`,
  }));
  const both = candidate({
    legacy_id: 'ref-z-both',
    surface_family: 'wanted-surface',
    platform: 'wanted-platform',
    product: 'product-both',
    source_family: 'source-both',
    topology: 'topology-both',
  });
  const platformOnly = candidate({
    legacy_id: 'ref-z-platform',
    platform: 'wanted-platform',
    product: 'product-platform',
    source_family: 'source-platform',
    topology: 'topology-platform',
  });

  const result = selectP7ParityLexicalResults({
    candidates: [...highNonmatches, both, platformOnly],
    request,
    maxItems: 4,
  });

  assert.equal(result.diagnostics.coverage.feasible, true);
  assert.ok(result.ids.includes('ref-z-both'));
  assert.ok(result.ids.includes('ref-z-platform'));
  assert.ok(result.diagnostics.coverage.exact_surface >= 1);
  assert.ok(result.diagnostics.coverage.exact_platform >= 2);
  assert.deepEqual(result.diagnostics.coverage.gaps, []);
});

test('P7 infeasible quick coverage stays deterministic and reports the real gap', () => {
  const request = quickRequest({
    limit: 4,
    surface: 'wanted-surface',
    platform: 'wanted-platform',
  });
  const rows = [
    candidate({ legacy_id: 'ref-d', surface_family: 'wanted-surface' }),
    candidate({ legacy_id: 'ref-c' }),
    candidate({ legacy_id: 'ref-b' }),
    candidate({ legacy_id: 'ref-a' }),
  ];

  const forward = selectP7ParityLexicalResults({ candidates: rows, request, maxItems: 4 });
  const reversed = selectP7ParityLexicalResults({ candidates: [...rows].reverse(), request, maxItems: 4 });

  assert.equal(forward.diagnostics.coverage.feasible, false);
  assert.deepEqual(forward.ids, reversed.ids);
  assert.ok(forward.diagnostics.coverage.gaps.some((gap) => gap.kind === 'platform'));
});

test('P7 final score ties use legacy_id, never asset transport order', () => {
  const request = quickRequest({ limit: 2 });
  const rows = [
    candidate({ asset_id: 'asset-000', legacy_id: 'ref-z-later' }),
    candidate({ asset_id: 'asset-999', legacy_id: 'ref-a-earlier' }),
  ];

  const result = selectP7ParityLexicalResults({ candidates: rows, request, maxItems: 2 });
  assert.deepEqual(result.ids, ['ref-a-earlier', 'ref-z-later']);
});

test('P7 rejects missing or duplicate legacy identities instead of falling back to asset ids', () => {
  const request = quickRequest({ limit: 1 });
  assert.throws(
    () => selectP7ParityLexicalResults({
      candidates: [candidate({ legacy_id: '' })],
      request,
      maxItems: 1,
    }),
    /legacy_id/i,
  );
  assert.throws(
    () => selectP7ParityLexicalResults({
      candidates: [
        candidate({ asset_id: 'asset-1', legacy_id: 'ref-duplicate' }),
        candidate({ asset_id: 'asset-2', legacy_id: 'ref-duplicate' }),
      ],
      request,
      maxItems: 1,
    }),
    /duplicate.*legacy/i,
  );
});

test('P7 production parity policy stays independent from legacy selector and benchmark evidence', () => {
  const source = readFileSync(
    new URL('../../reference-graph/p7-parity-policy.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /knowledge\/design-references/i);
  assert.doesNotMatch(source, /shadow-cases\.json/i);
  assert.doesNotMatch(source, /p[3-7]-.*evidence\.json/i);
  assert.doesNotMatch(source, /expected[_-]?legacy/i);
});

test('P7 graph-native policy matches legacy quick selection on independent synthetic fixtures', () => {
  const records = [
    {
      id: 'ref-synth-a', title: 'A', product: 'Alpha', surfaceFamily: 'surface-a', platform: 'mobile',
      pageRole: 'product surface', firstScreenJob: 'launch alpha', topology: 'grid', traversal: 'a to b',
      responsiveBehavior: 'stacks', motion: 'subtle', visualWorld: 'dark', flowStates: ['home'],
      strengths: ['clear'], weaknesses: ['dense'], transferableDecisions: ['keep cta'], tags: ['visual-verified', 'alpha', 'home'],
      sourceFamily: 'source-a', primaryStratum: 'direct-domain', evidenceClass: 'TESTED', accessStatus: 'AVAILABLE',
      reviewStatus: 'reviewed', lastVerifiedAt: '2026-10-20', ttlDays: 90,
      multiStateFlow: true, ordinaryOrFailureProne: true,
    },
    {
      id: 'ref-synth-b', title: 'B', product: 'Beta', surfaceFamily: 'surface-b', platform: 'mobile',
      pageRole: 'help guide', firstScreenJob: 'launch beta', topology: 'list', traversal: 'b to c',
      responsiveBehavior: 'stacks', motion: 'none', visualWorld: 'light', flowStates: ['home'],
      strengths: ['simple'], weaknesses: ['generic'], transferableDecisions: ['group items'], tags: ['beta', 'help', 'home'],
      sourceFamily: 'source-b', primaryStratum: 'adjacent-domain', evidenceClass: 'OBSERVED', accessStatus: 'PAYWALLED',
      reviewStatus: 'reviewed', lastVerifiedAt: '2026-10-20', ttlDays: 90,
      multiStateFlow: false, ordinaryOrFailureProne: false,
    },
    {
      id: 'ref-synth-c', title: 'C', product: 'Gamma', surfaceFamily: 'surface-a', platform: 'web-responsive',
      pageRole: 'product surface', firstScreenJob: 'resume gamma', topology: 'rail', traversal: 'c to d',
      responsiveBehavior: 'wraps', motion: 'subtle', visualWorld: 'dark', flowStates: ['resume'],
      strengths: ['resume'], weaknesses: ['busy'], transferableDecisions: ['show recent'], tags: ['gamma', 'resume', 'home'],
      sourceFamily: 'source-c', primaryStratum: 'evidence-craft', evidenceClass: 'OBSERVED', accessStatus: 'AVAILABLE',
      reviewStatus: 'reviewed', lastVerifiedAt: '2026-10-20', ttlDays: 90,
      multiStateFlow: true, ordinaryOrFailureProne: false,
    },
    {
      id: 'ref-synth-d', title: 'D', product: 'Delta', surfaceFamily: 'surface-b', platform: 'web-responsive',
      pageRole: 'marketing', firstScreenJob: 'tell story', topology: 'story', traversal: 'd to e',
      responsiveBehavior: 'stacks', motion: 'high', visualWorld: 'editorial', flowStates: ['story'],
      strengths: ['visual'], weaknesses: ['slow'], transferableDecisions: ['pace sections'], tags: ['delta', 'story', 'editorial'],
      sourceFamily: 'source-d', primaryStratum: 'outside-domain', evidenceClass: 'TESTED', accessStatus: 'AVAILABLE',
      reviewStatus: 'reviewed', lastVerifiedAt: '2026-10-20', ttlDays: 90,
      multiStateFlow: false, ordinaryOrFailureProne: true,
    },
  ];
  const requests = [
    quickRequest({ limit: 3, surface: 'surface-a', platform: 'mobile', job: 'launch alpha', dimensions: 'visual-world' }),
    quickRequest({ limit: 3, surface: 'surface-b', platform: 'web-responsive', job: 'story resume', dimensions: 'typography' }),
  ];
  const candidates = records.map((record) => {
    const searchable = [
      record.title, record.product, record.pageRole, record.firstScreenJob, record.topology,
      record.traversal, record.responsiveBehavior, record.visualWorld,
      ...record.strengths, ...record.weaknesses, ...record.transferableDecisions,
      ...record.flowStates, ...record.tags,
    ].join('\n');
    return candidate({
      asset_id: `asset-${record.id}`,
      legacy_id: record.id,
      search_text: searchable,
      product: record.product,
      surface_family: record.surfaceFamily,
      platform: record.platform,
      page_role: record.pageRole,
      motion: record.motion,
      source_family: record.sourceFamily,
      topology: record.topology,
      access_status: record.accessStatus,
      evidence_class: record.evidenceClass,
      ordinary_or_failure_prone: record.ordinaryOrFailureProne,
      multi_state_flow: record.multiStateFlow,
      tags: record.tags,
    });
  });

  for (const request of requests) {
    const legacy = selectRecords(records, request, { now: CONTROL_NOW }).selected.map((row) => row.id);
    const graph = selectP7ParityLexicalResults({ candidates, request, maxItems: request.limit }).ids;
    assert.deepEqual(graph, legacy, request.job);
  }
});

test('P7 graph-native policy exactly matches the current legacy control on all 24 committed quick cases', () => {
  const records = loadRecords();
  const eligible = records.filter(
    (record) => record.reviewStatus === 'reviewed'
      && ['AVAILABLE', 'PAYWALLED'].includes(record.accessStatus)
      && isFresh(record, CONTROL_NOW),
  );
  assert.equal(eligible.length, 275);

  const candidates = eligible.map(graphCandidateFromRecord);
  const cases = JSON.parse(readFileSync(
    new URL('../../reference-graph/shadow-cases.json', import.meta.url),
    'utf8',
  ));
  assert.equal(cases.length, 24);

  for (const request of cases) {
    const legacy = selectRecords(records, request, { now: CONTROL_NOW }).selected.map((row) => row.id);
    const graph = selectP7ParityLexicalResults({
      candidates,
      request,
      maxItems: request.limit,
    }).ids;
    assert.deepEqual(graph, legacy, request.id);
  }
});
