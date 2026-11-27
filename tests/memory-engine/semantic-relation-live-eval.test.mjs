import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareSyntheticRelationCases, shadowUsageFromCodex } from '../../scripts/eval-semantic-relations-live.mjs';
import { evaluateSemanticRelationShadowCases } from '../../memory-engine/semantic-relation-shadow.mjs';
import { buildSemanticRelationPrompt } from '../../memory-engine/semantic-relation-judge.mjs';

const load = async () => JSON.parse(await readFile(
  new URL('../fixtures/semantic-relation-live-v1.json', import.meta.url), 'utf8',
));

test('live relation fixture contains distinct bounded positive and negative synthetic cases', async () => {
  const cases = prepareSyntheticRelationCases(await load());
  assert.equal(cases.length, 8);
  assert.equal(cases.filter(item => item.expectedRelations.length).length, 4);
  const prompts = cases.map(({ memory, ...scope }) =>
    buildSemanticRelationPrompt({ ...scope, canonical: memory.exportCanonical() }));
  assert.equal(new Set(prompts).size, 8);
  const report = await evaluateSemanticRelationShadowCases({
    cases, judge: async () => '{"relations":[]}',
  });
  assert.equal(report.complete, true);
  assert.equal(report.counts.correctNegatives, 4);
  assert.equal(report.counts.missingEdges, 4);
});

test('live fixture rejects duplicate semantic contexts and unsupported format', async () => {
  const fixture = await load();
  fixture.cases.push({ ...fixture.cases[0], id: 'different-id', expectedRelations: [] });
  assert.throws(() => prepareSyntheticRelationCases(fixture), /Duplicate synthetic relation context/);
  assert.throws(() => prepareSyntheticRelationCases({ ...fixture, humanValidated: true }), /unvalidated/);
});

test('Codex usage adapter preserves aggregate counts and omits breakdown fields', async () => {
  const usage = shadowUsageFromCodex({
    input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 0,
    output_tokens: 20, reasoning_output_tokens: 8,
  });
  assert.deepEqual(usage, { input_tokens: 100, output_tokens: 20 });
  assert.equal(shadowUsageFromCodex(null), null);
  assert.throws(() => shadowUsageFromCodex({ input_tokens: -1, output_tokens: 20 }), /Invalid/);
  const [one] = prepareSyntheticRelationCases(await load());
  const report = await evaluateSemanticRelationShadowCases({
    cases: [one], judge: async () => ({ text: '{"relations":[]}', usage }),
  });
  assert.equal(report.counts.scored, 1);
  assert.deepEqual(report.usage.totals, { input_tokens: 100, output_tokens: 20, total_tokens: 120 });
});

test('live evaluator requires explicit --judge and does not start a provider by default', () => {
  const cli = fileURLToPath(new URL('../../scripts/eval-semantic-relations-live.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--judge/);
});
