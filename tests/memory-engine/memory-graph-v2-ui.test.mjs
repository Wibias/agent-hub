import assert from 'node:assert/strict';
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
  assert.match(css, /\.graph-edge\.typed_relation/);
  assert.match(css, /\.graph-node\.freshness-unchecked/);
  assert.match(model, /buildMemoryGraphV2\(memory/);
});

test('D4 HTTP route does not take user query revisionSha as trusted Git evidence', async () => {
  const server = await readFile(new URL('../../scripts/memory-ui.mjs', import.meta.url), 'utf8');
  const scopeRoute = server.slice(server.indexOf("if (url.pathname === '/api/graph')"), server.indexOf("if (url.pathname === '/api/claim')"));
  assert.match(scopeRoute, /await resolveMemoryConsoleGitScopeAsync\(\{/);
  assert.match(scopeRoute, /memoryUiGraph\(graphMemory,\s*\{/);
  assert.match(scopeRoute, /revisionSha:\s*gitScope\.revisionSha/);
  assert.doesNotMatch(scopeRoute, /queryValue\(url,\s*['"](?:revisionSha|repoRoot|repoPath)['"]\)/);
  assert.doesNotMatch(scopeRoute, /searchParams\.get\(\s*['"](?:revisionSha|repoRoot|repoPath)['"]\s*\)/);
  assert.equal(scopeRoute.includes("queryValue(url, 'revisionSha')"), false);
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
  assert.match(js, /typed omitted by limit/);
});
