import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  prepareCase,
  redactSyntheticSecret,
  SYNTHETIC_SECRET,
} from './runner.mjs';

test('prepareCase resolves semantic revision labels to immutable fixture SHAs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-ratchet-case-'));
  const prepared = await prepareCase('M05', root);

  assert.equal(prepared.case_id, 'M05');
  assert.equal(prepared.current.project_id, 'mr-project-a');
  assert.equal(prepared.current.branch, 'main');
  assert.match(prepared.current.revision_sha, /^[0-9a-f]{40}$/);
  assert.equal(prepared.events.length, 1);
  assert.equal(prepared.events[0].id, 'EV-A-JWT-OBS');
  assert.match(prepared.events[0].revision_sha, /^[0-9a-f]{40}$/);
  assert.notEqual(prepared.events[0].revision_sha, prepared.current.revision_sha);
});

test('long-gap noise is deterministic and creates exactly 27 later sessions', async () => {
  const rootA = await mkdtemp(join(tmpdir(), 'memory-ratchet-gap-a-'));
  const rootB = await mkdtemp(join(tmpdir(), 'memory-ratchet-gap-b-'));
  const first = await prepareCase('M02', rootA);
  const second = await prepareCase('M02', rootB);

  assert.equal(first.events.length, 29);
  assert.equal(first.events[0].id, 'EV-A-SQLITE-ACCEPT');
  assert.equal(first.events[1].id, 'EV-A-POSTGRES-DECISION');
  assert.equal(first.events.slice(2).length, 27);
  assert.ok(first.events.slice(2).every((event) => event.type === 'noise_session'));
  assert.equal(new Set(first.events.slice(2).map(({ session_id }) => session_id)).size, 27);

  const stable = (prepared) => prepared.events.map(({ repo_path, ...event }) => event);
  assert.deepEqual(stable(first), stable(second));
});

test('M14 surrounds the target with 2,000 deterministic distractors and bounds recall to 10 items', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-ratchet-noise-'));
  const prepared = await prepareCase('M14', root);

  assert.equal(prepared.events.length, 2002);
  assert.equal(prepared.events[1000].id, 'EV-A-SQLITE-ACCEPT');
  assert.equal(prepared.events[1001].id, 'EV-A-POSTGRES-DECISION');
  assert.ok(prepared.events.slice(0, 1000).every((event) => event.type === 'noise_memory'));
  assert.ok(prepared.events.slice(1002).every((event) => event.type === 'noise_memory'));
  assert.equal(prepared.recall.limit, 10);
});

test('synthetic secret redaction works recursively without mutating non-secret evidence', () => {
  const input = {
    text: `token=${SYNTHETIC_SECRET}`,
    nested: [{ value: SYNTHETIC_SECRET }, 'safe'],
    count: 2,
  };
  const redacted = redactSyntheticSecret(input);

  assert.doesNotMatch(JSON.stringify(redacted), /sk-test-MEMORYRATCHET-/);
  assert.equal(redacted.text, 'token=[REDACTED_SYNTHETIC_SECRET]');
  assert.equal(redacted.nested[1], 'safe');
  assert.equal(redacted.count, 2);
});

test('fixture revision includes corpus assets, not only generated repository commits', async () => {
  const { computeFixtureRevision } = await import('./runner.mjs');
  const base = computeFixtureRevision('repo-revision', ['events-a', 'plan-a', 'schema-a']);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.notEqual(base, computeFixtureRevision('repo-revision', ['events-b', 'plan-a', 'schema-a']));
  assert.notEqual(base, computeFixtureRevision('repo-revision', ['events-a', 'plan-b', 'schema-a']));
  assert.notEqual(base, computeFixtureRevision('repo-revision', ['events-a', 'plan-a', 'schema-b']));
});
