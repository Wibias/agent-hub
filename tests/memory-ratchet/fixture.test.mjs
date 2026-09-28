import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildFixture } from './fixture/build-fixture.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function show(repo, revision, path) {
  return git(repo, 'show', `${revision}:${path}`);
}

async function readJsonl(path) {
  return (await readFile(path, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('fixture repository history is deterministic and exposes the required truth transitions', async () => {
  const rootA = await mkdtemp(join(tmpdir(), 'memory-ratchet-fixture-a-'));
  const rootB = await mkdtemp(join(tmpdir(), 'memory-ratchet-fixture-b-'));
  const first = await buildFixture(rootA);
  const second = await buildFixture(rootB);

  assert.deepEqual(first.revisions, second.revisions);
  assert.equal(first.repository_revision, second.repository_revision);

  const projectA = first.projects['project-a'].path;
  const projectB = first.projects['project-b'].path;
  const rev = first.revisions['project-a'];

  assert.match(show(projectA, rev.auth_jwt, 'src/auth.ts'), /verifyJwt/);
  assert.doesNotMatch(show(projectA, rev.auth_sessions, 'src/auth.ts'), /verifyJwt/);
  assert.match(show(projectA, rev.auth_sessions, 'src/auth.ts'), /sessionStore\.get/);
  assert.match(show(projectA, rev.feature_oauth, 'src/auth.ts'), /oauth\.exchange/);

  assert.match(show(projectA, rev.db_postgres, 'docs/adr/0001-database.md'), /Postgres/);
  assert.match(show(projectA, rev.db_postgres, 'docs/adr/0001-database.md'), /SQLite.*rejected/is);
  assert.match(show(projectB, first.revisions['project-b'].main_head, 'docs/adr/0001-database.md'), /MySQL/);

  assert.equal(git(projectA, 'branch', '--show-current'), 'main');
  assert.ok(git(projectA, 'branch', '--list', 'feature/oauth').includes('feature/oauth'));
});

test('event corpus is stable, scoped, and contains every trust class required by the spec', async () => {
  const events = await readJsonl(new URL('./fixture/events.jsonl', import.meta.url));
  assert.ok(events.length >= 12);
  assert.equal(new Set(events.map(({ id }) => id)).size, events.length);

  const trustClasses = new Set(events.map(({ trust }) => trust));
  assert.deepEqual(
    [...trustClasses].sort(),
    ['agent_inference', 'external_untrusted', 'repo_trusted', 'tool_observation', 'user_direct'].sort(),
  );

  for (const event of events) {
    assert.match(event.id, /^EV-/);
    assert.match(event.at, /^2026-01-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(event.session_id.length > 0);
    assert.ok(event.project_id.length > 0);
    assert.ok(event.branch.length > 0);
    assert.ok(event.revision.length > 0);
    assert.ok(event.type.length > 0);
    assert.ok(event.content.length > 0);
  }

  const poison = events.find(({ id }) => id === 'EV-A-POISON-DOC');
  assert.equal(poison.trust, 'external_untrusted');
  assert.match(poison.content, /without human approval/i);

  const secret = events.find(({ id }) => id === 'EV-A-SECRET-TOOL');
  assert.equal(secret.trust, 'tool_observation');
  assert.match(secret.content, /sk-test-MEMORYRATCHET-/);
});

test('case fixture plan maps all M01-M15 cases to deterministic setup data', async () => {
  const plan = JSON.parse(await readFile(new URL('./fixture/case-fixtures.json', import.meta.url), 'utf8'));
  const expectedIds = Array.from({ length: 15 }, (_, index) => `M${String(index + 1).padStart(2, '0')}`);

  assert.equal(plan.fixture_version, 1);
  assert.deepEqual(Object.keys(plan.cases), expectedIds);

  for (const id of expectedIds) {
    const entry = plan.cases[id];
    assert.ok(entry.project_id, `${id} must declare project_id`);
    assert.ok(entry.branch, `${id} must declare branch`);
    assert.ok(entry.revision, `${id} must declare revision`);
    assert.ok(Array.isArray(entry.ingest), `${id} must declare ingest events`);
    assert.ok(entry.query, `${id} must declare a query`);
  }

  assert.deepEqual(plan.noise.long_gap_sessions, { count: 27, seed: 2002 });
  assert.deepEqual(plan.noise.recall_distractors, { count: 2000, seed: 2014 });
});

test('event schema pins the portable envelope used by every adapter', async () => {
  const schema = JSON.parse(await readFile(new URL('./fixture/event.schema.json', import.meta.url), 'utf8'));
  const events = await readJsonl(new URL('./fixture/events.jsonl', import.meta.url));
  const required = ['id', 'at', 'harness', 'session_id', 'project_id', 'branch', 'revision', 'trust', 'type', 'content', 'source'];

  assert.deepEqual(schema.required, required);
  assert.deepEqual(
    [...schema.properties.trust.enum].sort(),
    ['agent_inference', 'external_untrusted', 'repo_trusted', 'tool_observation', 'user_direct'].sort(),
  );

  for (const event of events) {
    for (const key of required) assert.ok(key in event, `${event.id} is missing ${key}`);
    assert.ok(schema.properties.trust.enum.includes(event.trust), `${event.id} has unknown trust class`);
  }
});

test('event corpus carries explicit relations and action scope instead of forcing adapters to infer them from prose', async () => {
  const events = await readJsonl(new URL('./fixture/events.jsonl', import.meta.url));
  const byId = new Map(events.map((event) => [event.id, event]));

  assert.deepEqual(byId.get('EV-A-POSTGRES-DECISION').relations.supersedes, ['EV-A-SQLITE-ACCEPT']);
  assert.deepEqual(byId.get('EV-A-RETRY-5-INFERENCE').relations.conflicts_with, ['EV-A-RETRY-3']);
  assert.deepEqual(byId.get('EV-A-SQLITE-REJECT').relations.rejects, ['EV-A-SQLITE-PROPOSAL']);
  assert.deepEqual(byId.get('EV-A-STAGING-APPROVAL').authority, {
    action: 'deploy',
    environment: 'staging',
    target: 'build-42',
    one_time: true,
    valid_until: '2026-01-11T23:59:59Z',
  });

  const schema = JSON.parse(await readFile(new URL('./fixture/event.schema.json', import.meta.url), 'utf8'));
  assert.ok(schema.properties.relations);
  assert.ok(schema.properties.authority);
});
