import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectP6LexicalResults,
  selectP6SemanticResults,
  selectP6GuardedHybridResults,
} from '../../reference-graph/retrieval-policy.mjs';

function asset(id, {
  product = id,
  surface = 'other-surface',
  platform = 'web-responsive',
  sourceFamily = `source-${id}`,
  topology = `topology-${id}`,
} = {}) {
  return {
    id,
    metadata: {
      product,
      surface_family: surface,
      platform,
    },
    surface_family: surface,
    platform,
    source_family: sourceFamily,
    topology,
  };
}

function candidate(id, score, rank) {
  return { id, asset_id: id, score, rank };
}

const quick = (overrides = {}) => ({
  profile: 'quick',
  surface: 'target-surface',
  platform: 'native-mobile',
  ...overrides,
});

test('lexical policy uses the frozen pre-P6 request weights', () => {
  const assets = [
    asset('a', { surface: 'target-surface', platform: 'native-mobile' }),
    asset('b', { surface: 'other-surface', platform: 'web-responsive' }),
  ];
  const lexicalCandidates = [candidate('a', 1, 2), candidate('b', 5, 1)];

  const result = selectP6LexicalResults({
    lexicalCandidates,
    assets,
    request: quick(),
    maxItems: 1,
  });

  // a = 1*5 + 60 + 15 = 80; b = 5*5 = 25.
  assert.deepEqual(result.ids, ['a']);
});

test('lexical policy recalculates frozen product/source/topology diversity penalties', () => {
  const assets = [
    asset('a', { surface: 'target-surface', platform: 'native-mobile', product: 'p', sourceFamily: 's', topology: 't' }),
    asset('b', { surface: 'target-surface', platform: 'native-mobile', product: 'p', sourceFamily: 's', topology: 't' }),
    asset('c', { surface: 'target-surface', platform: 'native-mobile', product: 'q', sourceFamily: 'u', topology: 'v' }),
  ];
  const lexicalCandidates = [candidate('a', 1, 1), candidate('b', 1, 2), candidate('c', 1, 3)];

  const result = selectP6LexicalResults({
    lexicalCandidates,
    assets,
    request: quick(),
    maxItems: 2,
  });

  // a wins the initial stable-ID tie. b then pays 20+8+6 while c pays no repeat penalty.
  assert.deepEqual(result.ids, ['a', 'c']);
});

test('quick lexical selection preserves feasible surface and platform completion', () => {
  const assets = [
    asset('n1'),
    asset('n2'),
    asset('n3'),
    asset('both', { surface: 'target-surface', platform: 'native-mobile' }),
    asset('mobile', { platform: 'native-mobile' }),
  ];
  const lexicalCandidates = [
    candidate('n1', 100, 1),
    candidate('n2', 99, 2),
    candidate('n3', 98, 3),
    candidate('both', 1, 4),
    candidate('mobile', 1, 5),
  ];

  const result = selectP6LexicalResults({ lexicalCandidates, assets, request: quick(), maxItems: 4 });

  assert.equal(result.ids.length, 4);
  assert.equal(result.ids.includes('both'), true);
  assert.equal(result.ids.includes('mobile'), true);
  assert.equal(result.ids.includes('n3'), false);
  assert.equal(result.diagnostics.coverage.feasible, true);
  assert.equal(result.diagnostics.coverage.exact_surface >= 1, true);
  assert.equal(result.diagnostics.coverage.exact_platform >= 2, true);
  assert.deepEqual(result.diagnostics.coverage.gaps, []);
});

test('quick lexical selection reports an infeasible request honestly and deterministically', () => {
  const assets = [asset('a'), asset('b'), asset('c'), asset('mobile', { platform: 'native-mobile' })];
  const lexicalCandidates = [candidate('a', 4, 1), candidate('b', 3, 2), candidate('c', 2, 3), candidate('mobile', 1, 4)];

  const first = selectP6LexicalResults({ lexicalCandidates, assets, request: quick(), maxItems: 4 });
  const second = selectP6LexicalResults({ lexicalCandidates: [...lexicalCandidates].reverse(), assets: [...assets].reverse(), request: quick(), maxItems: 4 });

  assert.deepEqual(first.ids, second.ids);
  assert.equal(first.ids.length, 4);
  assert.equal(first.diagnostics.coverage.feasible, false);
  assert.equal(first.diagnostics.coverage.gaps.some((gap) => gap.kind === 'surface'), true);
  assert.equal(first.diagnostics.coverage.gaps.some((gap) => gap.kind === 'platform'), true);
});

test('P6 policy rejects standard/deep instead of silently defining them', () => {
  const assets = [asset('a')];
  const lexicalCandidates = [candidate('a', 1, 1)];

  assert.throws(
    () => selectP6LexicalResults({ lexicalCandidates, assets, request: quick({ profile: 'standard' }), maxItems: 1 }),
    /quick/i,
  );
});

test('semantic diagnostic keeps semantic relevance order while preserving feasible quick coverage', () => {
  const assets = [
    asset('n1'),
    asset('n2'),
    asset('both', { surface: 'target-surface', platform: 'native-mobile' }),
    asset('mobile', { platform: 'native-mobile' }),
  ];
  const semanticCandidates = [
    candidate('n1', 0.99, 1),
    candidate('n2', 0.98, 2),
    candidate('both', 0.70, 3),
    candidate('mobile', 0.60, 4),
  ];

  const result = selectP6SemanticResults({ semanticCandidates, assets, request: quick(), maxItems: 4 });

  assert.deepEqual(result.ids, ['n1', 'n2', 'both', 'mobile']);
  assert.equal(result.diagnostics.coverage.feasible, true);
  assert.deepEqual(result.diagnostics.coverage.gaps, []);
});

test('guarded hybrid cannot evict fillable positive lexical results', () => {
  const assets = [
    asset('l1', { surface: 'target-surface', platform: 'native-mobile' }),
    asset('l2', { platform: 'native-mobile' }),
    asset('l3'),
    asset('l4'),
    asset('semantic-only', { surface: 'target-surface', platform: 'native-mobile' }),
  ];
  const lexicalCandidates = [
    candidate('l1', 5, 1), candidate('l2', 4, 2), candidate('l3', 3, 3), candidate('l4', 2, 4),
  ];
  const semanticCandidates = [candidate('semantic-only', 0.999, 1), candidate('l4', 0.5, 2)];

  const lexical = selectP6LexicalResults({ lexicalCandidates, assets, request: quick(), maxItems: 4 });
  const hybrid = selectP6GuardedHybridResults({ lexicalCandidates, semanticCandidates, assets, request: quick(), maxItems: 4 });

  assert.deepEqual(hybrid.ids, lexical.ids);
  assert.equal(hybrid.ids.includes('semantic-only'), false);
  assert.equal(hybrid.diagnostics.selected_counts.semantic_only, 0);
});

test('guarded hybrid may supplement missing lexical slots with semantic-only candidates', () => {
  const assets = [
    asset('l1', { surface: 'target-surface', platform: 'native-mobile' }),
    asset('l2', { platform: 'native-mobile' }),
    asset('s1'),
    asset('s2'),
  ];
  const lexicalCandidates = [candidate('l1', 3, 1), candidate('l2', 2, 2)];
  const semanticCandidates = [candidate('s1', 0.9, 1), candidate('s2', 0.8, 2)];

  const hybrid = selectP6GuardedHybridResults({ lexicalCandidates, semanticCandidates, assets, request: quick(), maxItems: 4 });

  assert.deepEqual(hybrid.ids, ['l1', 'l2', 's1', 's2']);
  assert.equal(hybrid.diagnostics.selected_counts.lexical, 2);
  assert.equal(hybrid.diagnostics.selected_counts.semantic_only, 2);
});

test('semantic rank replaces only stable-id tie-break at identical adjusted lexical score', () => {
  const assets = [asset('a'), asset('b')];
  const lexicalCandidates = [candidate('a', 2, 1), candidate('b', 2, 2)];
  const semanticCandidates = [candidate('b', 0.9, 1), candidate('a', 0.8, 2)];
  const request = quick({ surface: undefined, platform: undefined });

  const lexical = selectP6LexicalResults({ lexicalCandidates, assets, request, maxItems: 2 });
  const hybrid = selectP6GuardedHybridResults({ lexicalCandidates, semanticCandidates, assets, request, maxItems: 2 });

  assert.deepEqual(lexical.ids, ['a', 'b']);
  assert.deepEqual(hybrid.ids, ['b', 'a']);
});
