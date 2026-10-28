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
