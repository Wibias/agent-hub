import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REDACTED_SECRET } from '../../memory-engine/index.mjs';
import { runRecallCase } from '../memory-ratchet/adapter-contract.mjs';
import { SYNTHETIC_SECRET } from '../memory-ratchet/runner.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';

async function runCase(caseId) {
  const root = await mkdtemp(join(tmpdir(), `memory-engine-${caseId.toLowerCase()}-`));
  return runRecallCase(createReferenceMemoryAdapter(), caseId, root);
}

function currentTexts(result) {
  return result.raw_recall.items.map((item) => item.evidence.content_redacted);
}

test('M01 keeps the later Postgres decision as current cross-harness truth', async () => {
  const result = await runCase('M01');
  const texts = currentTexts(result);

  assert.ok(texts.some((text) => /Postgres/i.test(text)));
  assert.ok(texts.every((text) => !/^Use SQLite\.?$/i.test(text)));
});

test('M03 hard-isolates project B from project A memory', async () => {
  const result = await runCase('M03');
  const texts = currentTexts(result);

  assert.ok(texts.some((text) => /MySQL/i.test(text)));
  assert.ok(texts.every((text) => !/Postgres|SQLite/i.test(text)));
});

test('M04 hard-isolates main from feature-only branch memory', async () => {
  const result = await runCase('M04');
  const texts = currentTexts(result);

  assert.ok(texts.some((text) => /sessionStore\.get/i.test(text)), JSON.stringify(result.raw_recall, null, 2));
  assert.ok(texts.every((text) => !/OAuth exchange/i.test(text)));
});

test('M06 exposes superseded SQLite only through historical recall', async () => {
  const result = await runCase('M06');

  assert.ok(currentTexts(result).some((text) => /Postgres/i.test(text)));
  assert.ok(currentTexts(result).every((text) => !/^Use SQLite\.?$/i.test(text)));

  const sqlite = result.raw_recall.history.find(
    (item) => /Use SQLite as the project database/i.test(item.evidence.content_redacted),
  );
  assert.ok(sqlite);
  assert.equal(sqlite.claim.state, 'superseded');
});

test('M08 preserves durable repository and conversation provenance', async () => {
  const result = await runCase('M08');
  const items = result.raw_recall.items;

  const repo = items.find((item) => item.evidence.path === 'docs/adr/0001-database.md');
  assert.ok(repo);
  assert.match(repo.evidence.commit_sha, /^[0-9a-f]{40}$/);
  assert.equal(repo.evidence.source_ref, 'docs/adr/0001-database.md');
  assert.equal(repo.evidence.source_kind, 'repository');
  assert.equal(repo.evidence.authority_class, 'repo_trusted');

  const session = items.find((item) => item.evidence.source_ref === 'session:A-S11');
  assert.ok(session);
  assert.equal(session.evidence.session_id, 'A-S11');
  assert.equal(session.evidence.source_kind, 'session');
  assert.equal(session.evidence.authority_class, 'user_direct');
});

test('M09 removes rejected and superseded SQLite claims from current truth', async () => {
  const result = await runCase('M09');
  const texts = currentTexts(result);

  assert.ok(texts.some((text) => /Postgres/i.test(text)));
  assert.ok(texts.some((text) => /SQLite is rejected/i.test(text)));
  assert.ok(texts.every((text) => !/^Use SQLite\.?$/i.test(text)));
  assert.ok(texts.every((text) => !/could use SQLite/i.test(text)));

  const oldDecision = result.raw_recall.history.find(
    (item) => /Use SQLite as the project database/i.test(item.evidence.content_redacted),
  );
  const proposal = result.raw_recall.history.find(
    (item) => /We could use SQLite for this service/i.test(item.evidence.content_redacted),
  );
  assert.equal(oldDecision?.claim.state, 'superseded');
  assert.equal(proposal?.claim.state, 'rejected');
});

test('M11 redacts the synthetic credential before normal recall', async () => {
  const result = await runCase('M11');
  const serialized = JSON.stringify(result.raw_recall);

  assert.equal(serialized.includes(SYNTHETIC_SECRET), false);
  assert.equal(serialized.includes(REDACTED_SECRET), true);
});
