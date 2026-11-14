import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');

test('choreography is a progressive motion-build reference, not a new route', () => {
  const skill = read('skills/design-with-ai/SKILL.md');
  const build = read('skills/design-with-ai/references/motion-build.md');
  const review = read('skills/design-with-ai/references/motion-workflows.md');

  assert.match(skill, /motion-build/);
  assert.doesNotMatch(skill, /\| `choreograph`/);
  assert.match(build, /motion-choreography\.md/);
  assert.match(build, /multiple|two or more|several/i);
  assert.match(build, /single|one element/i);
  assert.match(review, /motion-choreography\.md/);
  assert.match(review, /multiple|coordination|several/i);
});

test('adapted choreography preserves purpose, interruption and reduced-motion behavior', () => {
  const ref = read('skills/design-with-ai/references/motion-choreography.md');

  for (const role of ['Lead', 'Support', 'Decoration', 'Static']) {
    assert.match(ref, new RegExp('\\b' + role + '\\b'));
  }
  for (const relationship of ['Together', 'Overlap', 'Sequence', 'Carry']) {
    assert.match(ref, new RegExp('\\b' + relationship + '\\b'));
  }
  assert.match(ref, /timeline/i);
  assert.match(ref, /interrupt|retrigger/i);
  assert.match(ref, /reduced.motion/i);
  assert.match(ref, /interaction.*visible|visible.*interaction/i);
  assert.match(ref, /zero (?:animated|moving) elements|no animation/i);
});

test('Motion modes agree with authoritative API instead of upstream generalizations', () => {
  const ref = read('skills/design-with-ai/references/motion-choreography.md');
  assert.match(ref, /mode="sync".*default|default.*mode="sync"/i);
  assert.match(ref, /mode="wait"/);
  assert.match(ref, /mode="popLayout"/);
  assert.match(ref, /one child at a time/i);
  assert.match(ref, /motion\.dev\/docs\/react-animate-presence/);
  assert.doesNotMatch(ref, /default mode.*sequential/i);
  assert.doesNotMatch(ref, /uniform stagger is forbidden/i);
});

test('new choreography guidance is selectively attributed without replacing local motion policy', () => {
  const provenance = read('skills/design-with-ai/UPSTREAM.md');
  const motion = read('skills/design-with-ai/references/motion-choreography.md');
  assert.match(provenance, /c8a79627b59d72d764d6ab6f2c87c09a48169833/);
  assert.match(provenance, /choreograph/);
  assert.match(provenance, /selective|adapted/i);
  assert.match(motion, /standards\.md/);
  assert.match(motion, /emilkowalski\/skills/);
});

test('Impeccable pinned engine release requires executable verification', () => {
  const provenance = read('skills/impeccable/UPSTREAM.md');
  const engine = read('skills/impeccable/scripts/VERSION').trim();
  assert.match(provenance, /acb4cfe14470b1fdf51e855431af618d936b7db8/);
  assert.match(provenance, /binary|engine/i);
  assert.match(provenance, /runtime verification/i);
  assert.equal(engine, '0.1.24');
});
