import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('D4 graph UI has grouped authority, explicit advisory and optional similarity labels', async () => {
  const [js, css, model] = await Promise.all([
    readFile(new URL('../../memory-ui/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../../memory-ui/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../../memory-engine/memory-ui-model.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(js, /id="graph-group-filter"/);
  assert.match(js, /Advisory typed/);
  assert.match(js, /Inferred similarity \(optional\)/);
  assert.match(js, /Git freshness/);
  assert.match(js, /source === 'typed_relation'/);
  assert.match(js, /graph-community-filter/);
  assert.match(js, /graph-threshold/);
  assert.match(js, /graph-zoom-in/);
  assert.match(js, /Graph projection/);
  assert.match(js, /Entity nodes/);
  assert.match(js, /Claims with entities/);
  assert.match(js, /Quality validation/);
  assert.match(js, /NOT HUMAN-VALIDATED/);
  assert.match(js, /Topic nodes/);
  assert.match(js, /Semantic coverage measures embeddings, not memory accuracy/);
  assert.match(css, /\.graph-edge\.typed_relation/);
  assert.match(css, /\.graph-node\.freshness-unchecked/);
  assert.match(css, /\.graph-node-dot/);
  assert.match(css, /\.graph-canvas-wrap[\s\S]*min-width: 0/);
  assert.match(model, /buildMemoryGraphV2\(memory/);
});

test('D12 communities use compact recorded entity labels without inventing topics', async () => {
  const app = await readFile(new URL('../../memory-ui/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function graphCommunityData(');
  const stop = app.indexOf('\n/** Apply project-local', start);
  assert.ok(start >= 0 && stop > start);
  const context = {
    memoryDisplayTitle(value) {
      return String(value ?? '').replace(/\s+/g, ' ').trim() || 'Untitled memory';
    },
    graphCommunityLabel(value, maxChars = 52) {
      const full = String(value ?? '').replace(/\s+/g, ' ').trim() || 'Untitled memory';
      const chars = [...full];
      return chars.length <= maxChars ? full : chars.slice(0, maxChars - 1).join('').trimEnd() + '…';
    },
  };
  const graphCommunityData = vm.runInNewContext(
    app.slice(start, stop) + '\ngraphCommunityData', context,
  );
  const nodes = [
    { id: 'c1', nodeType: 'claim', value: 'First very long claim about a workshop and its furniture.' },
    { id: 'c2', nodeType: 'claim', value: 'Second very long claim about the same workshop theme.' },
    { id: 'e1', nodeType: 'entity', value: 'Light Forge', claimIds: ['c1', 'c2'] },
  ];
  const edges = [{ from: 'e1', to: 'c1' }, { from: 'e1', to: 'c2' }];
  const entityCommunity = graphCommunityData(nodes, edges).list[0];
  assert.equal(entityCommunity.label, 'Light Forge');
  assert.equal(entityCommunity.basis, 'entity');
  assert.equal(entityCommunity.claimCount, 2);
  assert.equal(entityCommunity.entityCount, 1);

  const claimCommunity = graphCommunityData(
    nodes.slice(0, 2), [{ from: 'c1', to: 'c2' }],
  ).list[0];
  assert.equal(claimCommunity.basis, 'claim');
  assert.ok([...claimCommunity.label].length <= 52);
  assert.match(claimCommunity.label, /…$/);
});

test('D4 HTTP route does not take user query revisionSha as trusted Git evidence', async () => {
  const server = await readFile(new URL('../../scripts/memory-ui.mjs', import.meta.url), 'utf8');
  const scopeRoute = server.slice(server.indexOf("if (url.pathname === '/api/graph')"), server.indexOf("if (url.pathname === '/api/claim')"));
  assert.match(scopeRoute, /await resolveMemoryConsoleGitScopeAsync\(\{/);
  assert.match(scopeRoute, /memoryUiGraph\(graphMemory,\s*\{/);
  assert.match(scopeRoute, /memoryUiGraph\(graphMemory,\s*\{/);
  assert.match(scopeRoute, /revisionSha:\s*gitScope\.revisionSha/);
  assert.doesNotMatch(scopeRoute, /queryValue\(url,\s*['"](?:revisionSha|repoRoot|repoPath)['"]\)/);
  assert.doesNotMatch(scopeRoute, /searchParams\.get\(\s*['"](?:revisionSha|repoRoot|repoPath)['"]\s*\)/);
  assert.equal(scopeRoute.includes("queryValue(url, 'revisionSha')"), false);
  assert.match(scopeRoute, /repositoryRoots:\s*approvedGitRoots/);
});

test('D4 typed edges never display fabricated similarity weights', async () => {
  const js = await readFile(new URL('../../memory-ui/app.js', import.meta.url), 'utf8');
  assert.match(js, /edge\.relation === 'semantic_similarity' && Number\.isFinite\(edge\.weight\)/);
  assert.doesNotMatch(js, /edge\.origin === 'inferred' \? ` ·/);
});

test('D4 resets authority group on both graph reset and project/branch switch', async () => {
  const js = await readFile(new URL('../../memory-ui/app.js', import.meta.url), 'utf8');
  const resets = js.match(/state\.graphOrigin = 'all';\s*state\.graphGroup = 'all';\s*state\.graphNodeState = 'all';/g) ?? [];
  assert.equal(resets.length, 2);
});

test('D4 displays typed truncation independently of omitted claims', async () => {
  const js = await readFile(new URL('../../memory-ui/app.js', import.meta.url), 'utf8');
  assert.match(js, /stats\.typedRelationsOmittedByBound > 0/);
  assert.match(js, /advisory links omitted/);
});
