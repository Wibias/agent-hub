import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path) {
  return readFileSync(resolve(path), 'utf8');
}

test('perceptual hierarchy reference defines bounded hierarchy diagnostics', () => {
  const text = read('skills/design-with-ai/references/perceptual-hierarchy.md');
  for (const pattern of [
    /proximity/i,
    /similarity/i,
    /figure.?ground/i,
    /continuity/i,
    /semantic priority/i,
    /blur|thumbnail/i,
    /diagnostic/i,
    /not .*usability proof/i,
  ]) {
    assert.match(text, pattern);
  }
});

test('design dials are evidence-derived instead of category presets', () => {
  const text = read('skills/design-with-ai/references/dials.md');
  assert.doesNotMatch(text, /## Use-case presets/i);
  assert.doesNotMatch(text, /## Signal inference/i);
  assert.doesNotMatch(text, /Landing SaaS mainstream|premium, Apple-y, luxury|public-sector \/ trust-first/i);
  assert.match(text, /explicit user direction/i);
  assert.match(text, /incumbent.*measurement/i);
  assert.match(text, /inspected reference/i);
  assert.match(text, /do not.*product categor/i);
});

test('durable design contract covers imagery grammar and AI asset constraints without parallel truth', () => {
  const text = read('skills/design-with-ai/references/durable-design-contract.md');
  assert.match(text, /imagery grammar/i);
  assert.match(text, /positive.*negative examples/i);
  assert.match(text, /AI-generated (image|imagery)/i);
  assert.match(text, /prohibited (motifs|subjects|treatments)/i);
  assert.match(text, /do not create a parallel/i);
});

test('taste workflow operationalizes visual intent vocabulary', () => {
  const text = read('skills/design-with-ai/references/taste-workflow.md');
  assert.match(text, /desired.*avoid/i);
  assert.match(text, /tension statement/i);
  assert.match(text, /observable (choice|design choice)/i);
  assert.match(text, /modern.*clean.*premium.*sleek/i);
  assert.match(text, /insufficient/i);
});

test('skill loads perceptual hierarchy progressively rather than as a new route', () => {
  const skill = read('skills/design-with-ai/SKILL.md');
  assert.match(skill, /references\/perceptual-hierarchy\.md/);
  assert.match(skill, /hierarchy|grouping|salience/i);
  assert.doesNotMatch(skill, /\| `perceptual-hierarchy` \|/i);
});

test('motion audit checks removal hazards and cleanup before deleting animation code', () => {
  const text = read('skills/design-with-ai/references/audit-playbook.md');
  for (const pattern of [
    /removal safety/i,
    /hidden start states/i,
    /onAnimationEnd|transitionend|onExitComplete|setTimeout/i,
    /exit.*unmount|unmount.*exit/i,
    /layout.*(?:jump|shift)/i,
    /focus.*(?:callback|timing|immediate)/i,
    /tests?.*selectors?|selectors?.*tests?/i,
    /orphaned/i,
    /keyframes/i,
    /motion.*imports?|AnimatePresence/i,
    /(?:ask|approval|confirm).*dependency|dependency.*(?:ask|approval|confirm)/i,
  ]) {
    assert.match(text, pattern);
  }
});

test('Emil provenance pins the remove-animations safety delta without a new route', () => {
  const text = read('skills/design-with-ai/UPSTREAM.md');
  assert.match(text, /emilkowalski\/skills[^\n]*a81dbca07f2217b7103e510c0f13f8d5b017afc9/i);
  assert.match(text, /remove-animations/i);
  assert.match(text, /removal.*(?:hazard|safety)/i);
  assert.match(text, /no new.*(?:route|discovery surface)|not a new discovery surface/i);
});
