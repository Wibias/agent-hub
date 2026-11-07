import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const lock = JSON.parse(readFileSync('reference-graph/p35-pr-stack-lock.json', 'utf8'));
const cli = fileURLToPath(new URL('../../reference-graph/cli/p35-release-preflight.mjs', import.meta.url));
const moment = '2026-11-07T19:00:00.000Z';

function syntheticEvidence() {
  return {
    githubSnapshot: {
      schema_version: 'reference-graph.p35-github-snapshot.v1',
      repository: lock.repository,
      observed_at: '2026-11-07T18:59:00.000Z',
      prs: [...lock.independent_release_prs, ...lock.stacked_prs].map(pin => ({
        ...pin,
        author: 'Wibias',
        state: 'open', merged: false, draft: false,
        unresolved_review_threads: 0, reviews: [],
        workflows: lock.expected_ci_workflow_names.map(name => ({
          name, head_sha: pin.head_sha, conclusion: 'success',
        })),
      })),
    },
    projectInventory: {
      schema_version: 'reference-graph.p35-project-inventory.v1',
      observed_at: '2026-11-07T18:59:00.000Z',
      project_refs: ['qiaoerpncwbyglhyoftx'],
    },
  };
}

function invoke(input, overrides = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'p35-contract-'));
  try {
    const path = join(folder, 'evidence.json');
    const bytes = Buffer.from(JSON.stringify(input), 'utf8');
    writeFileSync(path, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    return spawnSync(process.execPath, [
      cli, '--evidence', path,
      '--sha256', overrides.sha256 || digest,
      '--as-of', overrides.asOf || moment,
      ...(overrides.extra || []),
    ], { encoding: 'utf8', timeout: 30_000 });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test('P35 CLI returns a well-formed blocked receipt without exposing private review identities', () => {
  const run = invoke(syntheticEvidence());
  assert.equal(run.status, 2, run.stderr);
  assert.equal(run.stderr, '');
  const result = JSON.parse(run.stdout);
  assert.equal(result.pr_count, 10);
  assert.equal(result.workflow_checks, 130);
  assert.equal(result.independently_approved_prs, 0);
  assert.equal(result.target_visible_in_supplied_inventory, false);
  assert.equal(result.deployment_authorized, false);
  assert.equal(result.activation_authorized, false);
  assert.ok(result.blockers.includes('independent-reviews-missing'));
  assert.doesNotMatch(run.stdout, /Wibias|independent-reviewer|service_role_key|search_text|qiaoerpncwbyglhyoftx/);
});

test('P35 CLI rejects forged byte pins, stale evidence and extra arguments without leaking data', () => {
  for (const overrides of [
    { sha256: 'f'.repeat(64) },
    { asOf: '2026-11-08T19:00:00.000Z' },
    { extra: ['--activate'] },
  ]) {
    const result = invoke(syntheticEvidence(), overrides);
    assert.equal(result.status, 1, JSON.stringify(overrides));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^P35 release preflight failed:/);
    assert.doesNotMatch(result.stderr, /evidence\.json|Wibias|secret|reference-graph\//);
  }
});

test('P35 CLI never returns approval even for simulated complete review/merge/target inventory', () => {
  const all = syntheticEvidence();
  for (const row of all.githubSnapshot.prs) {
    row.state = 'closed';
    row.merged = true;
    row.reviews.push({
      reviewer: 'separate-reviewer', state: 'APPROVED',
      commit_sha: row.head_sha, submitted_at: '2026-11-07T18:59:00.000Z',
    });
  }
  all.projectInventory.project_refs.push('vrznfnxzlxaavpqbzbzd');
  const result = invoke(all);
  assert.equal(result.status, 2);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.review_gate_satisfied, true);
  assert.equal(receipt.unmerged_prs, 0);
  assert.equal(receipt.deployment_authorized, false);
  assert.equal(receipt.activation_authorized, false);
  assert.ok(receipt.blockers.includes('external-release-authorization-missing'));
});

test('P35 CLI has no network, write, or production switch', () => {
  const code = readFileSync(cli, 'utf8');
  assert.doesNotMatch(code, /fetch\(|https\.request|http\.request|writeFileSync|process\.env|apply_migration|UPDATE |INSERT INTO |DELETE FROM /);
  assert.match(code, /return 2;/);
});
