import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const skill = read('../SKILL.md');
const baseline = read('../references/baseline-ui.md');
const quality = read('../references/quality-stack.md');
const verification = read('../references/verification-contract.md');
const contract = read('../references/desktop-monitoring-surfaces.md');

test('desktop monitor gate is conditional, discoverable and not a popup gate', () => {
  assert.match(skill, /desktop-monitoring-surfaces\.md/);
  assert.match(contract, /not a generic rule for every dashboard/);
  assert.match(contract, /G74/);
  assert.match(contract, /dark surfaces/);
});
test('dense monitor acceptance covers tangible window geometry and honest chart history', () => {
  for (const concept of ['KPI vertical fit', 'Table column budget', 'Vertical workspace budget',
    'Control identity and hierarchy', 'Table and graph honesty', 'Action prerequisites',
    'Typography and contrast', 'Host and edge cases']) {
    assert.ok(contract.includes(concept), 'Missing inspection category: ' + concept);
  }
  for (const concept of ['No process selected', '125%', '150%', 'absent samples', 'DPI', 'ellipsis']) {
    assert.ok(contract.includes(concept), 'Missing critical negative/edge case: ' + concept);
  }
});
test('baseline and quality explicitly block empty-pane pressure and header clipping', () => {
  assert.match(baseline, /table headings/);
  assert.match(quality, /column width vs header/);
  assert.match(quality, /empty panels/);
  assert.match(verification, /list-versus-empty-inspector/);
});
test('static screenshot cannot certify disabled destructive action or live-data freshness', () => {
  assert.match(contract, /A screenshot that \*looks\* enabled is a REVIEW lead/);
  assert.match(contract, /not proof the handler is enabled/);
  assert.match(contract, /NOT_VERIFIED/);
  assert.match(verification, /a static\nscreenshot alone leaves those behaviors `NOT_VERIFIED`/);
});
test('desktop monitoring eval cases are explicit and quick general polish stays unaffected', () => {
  const cases = read('./evals/cases.jsonl').trim().split(/\r?\n/).map(JSON.parse);
  const ids = new Set(cases.map(x => x.id));
  for (const id of ['E104','E105','E106','E107']) assert.ok(ids.has(id));
  const unrelated = cases.find(x=>x.id==='E107');
  assert.ok(unrelated.unnecessary_resources.includes('references/desktop-monitoring-surfaces.md'));
});

test("dense desktop COMPLETE requires an honest v2 window matrix and cross-viewport findings", () => {
  for (const concept of ["schemaVersion 2", "COMPACT", "MEDIUM", "MAXIMIZED",
    "SCALED", "COLLECTING", "findingViewportReviews", "duplicate", "PARTIAL"]) {
    assert.ok(contract.includes(concept), "Missing viewport regression guidance " + concept);
  }
  assert.match(verification, /single-window manifest cannot certify COMPLETE/);
  assert.match(quality, /multi-viewport/);
  assert.match(baseline, /compact, medium and maximized/);
});
