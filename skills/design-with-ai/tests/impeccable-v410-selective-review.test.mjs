import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('long design documents remain project-owned and compact navigation is opt-in', () => {
  const contract = read('../references/durable-design-contract.md');
  assert.match(contract, /navigation map/);
  assert.match(contract, /current document, linked tokens and/);
  assert.match(contract, /Propose any compaction or rewrite before changing an approved DESIGN\.md/);
  assert.match(contract, /Do not create an automatic index/);
  assert.match(contract, /not a new design-doc format/);
});

test('motion build optionally captures matched normal and reduced-motion evidence', () => {
  const motion = read('../references/motion-build.md');
  assert.match(motion, /same.*URL, viewport/);
  assert.match(motion, /normal and reduced-motion/);
  assert.match(motion, /blank, stale or clipped captures require recapture/);
  assert.match(motion, /A single static screenshot cannot prove timing/);
  assert.match(motion, /Do not start Impeccable.s release engine/);
  assert.match(motion, /NOT_VERIFIED/);
});

test('selective v4.10 review does not claim legacy runtime or specialist parity', () => {
  const upstream = read('../UPSTREAM.md');
  assert.match(upstream, /skill-v4\.10\.0/);
  assert.match(upstream, /issue #404/);
  assert.match(upstream, /not deployed[\s\S]*?claimed qualified/i);
  assert.match(upstream, /Full runtime,[\s\S]*?must be demonstrated/);
  assert.match(upstream, /engine-v0\.1\.28/);
});
