import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIRECT_CI_PROJECT, DIRECT_CI_BRANCH, DIRECT_USER_CI_PROTOCOL,
  verifySignedDirectCiEnvelope,
} from '../../memory-engine/adapters/codex-protected-direct-read-ci.mjs';
import {
  readScopedUserDirectCi,
} from '../../memory-engine/adapters/codex-protected-user-ci-mcp.mjs';
import {
  describeGlobalMemoryProject,
} from '../../memory-engine/adapters/codex-global-memory-scope.mjs';
import {
  createCodexMemoryMcpDispatcher,
} from '../../memory-engine/adapters/codex-readonly-memory-mcp.mjs';
import { parseMemoryMcpArgs } from '../../scripts/run-codex-memory-mcp.mjs';

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const sid = 'S-1-5-21-111111-222222-333333-1001';
const value = 'This knowledge statement is proposed from unverified historical Evidence.';
const digest = createHash('sha256').update(value).digest('hex');
const nonce = 'A'.repeat(43);
const query = 'knowledge';

function signed(revision, changes = {}) {
  const payload = {
    protocol: DIRECT_USER_CI_PROTOCOL,
    nonce,
    principal_sid: sid, project_id: DIRECT_CI_PROJECT,
    branch: DIRECT_CI_BRANCH, revision_sha: revision,
    query, max_items: 3, status: 'found_direct_ci_only',
    service_signed: true, read_only: true, ci_simulation_only: true,
    physical_human_approval_verified: false,
    published_to_codex: false, trusted_for_production_recall: false,
    items: [{
      claim_id: 'C~' + 'a'.repeat(24),
      project_id: DIRECT_CI_PROJECT,
      branch: DIRECT_CI_BRANCH, revision_sha: revision,
      fact_sha256: digest, historical_evidence_sha256: 'b'.repeat(64),
      kind: 'knowledge', value, created_at: '2026-11-17T04:00:00.000Z',
      provenance: 'user_direct_reaffirmed_and_published_v1',
      historical_source_origin: 'operator_pinned_unverified_evidence_v1',
      historical_evidence_verified: false,
      physical_human_approval_verified: false,
      published_to_codex: false,
    }],
    ...changes,
  };
  const raw = Buffer.from(JSON.stringify(payload));
  return {
    protocol: DIRECT_USER_CI_PROTOCOL,
    payload_b64: raw.toString('base64'),
    signature_b64: sign('sha256', raw, pair.privateKey).toString('base64'),
  };
}

function makeGitFixture() {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-user-ci-repo-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 10_000,
  }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'ci@example.invalid');
  git('config', 'user.name', 'CI');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin',
    'https://github.com/example/operator-evidence.git');
  writeFileSync(join(root, 'README.md'), 'Real CI-only test checkout\n');
  git('add', 'README.md');
  git('commit', '-m', 'CI fixture');
  const revision = git('rev-parse', 'HEAD');
  const scopePath = join(root, 'scope.json');
  const pinPath = join(root, 'pin.pem');
  writeFileSync(scopePath, JSON.stringify({
    schema: 1, memory_db: join(root, 'not-used.sqlite3'),
    projects: [{
      root, project_id: DIRECT_CI_PROJECT, repo_identity: DIRECT_CI_PROJECT,
    }],
  }));
  writeFileSync(pinPath, pem);
  return { root, git, scopePath, pinPath, revision };
}

test('real Git checkout, exact revision and scope can read a CI-signed user Claim via existing memory_recall MCP only', async () => {
  const fixture = makeGitFixture();
  let calls = 0;
  try {
    const observed = describeGlobalMemoryProject({ cwd: fixture.root });
    assert.equal(observed.project_id, DIRECT_CI_PROJECT);
    const read = ({ cwd, query: q, maxItems }) => readScopedUserDirectCi({
      cwd, query: q, maxItems,
      scopePath: fixture.scopePath, pinPath: fixture.pinPath,
      platform: 'win32', ciEnv: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' },
      accountSid: () => sid,
      request: async args => {
        calls++;
        assert.equal(args.projectId, DIRECT_CI_PROJECT);
        assert.equal(args.branch, 'main');
        assert.equal(args.revisionSha, fixture.revision);
        assert.equal(args.expectedSid, sid);
        assert.equal(args.maxItems, 3);
        return verifySignedDirectCiEnvelope({
          envelope: signed(fixture.revision), pinnedPublicKeyPem: pem,
          expectedProtocol: DIRECT_USER_CI_PROTOCOL,
          expectedNonce: nonce, expectedSid: sid,
          projectId: args.projectId, branch: args.branch,
          revisionSha: args.revisionSha, query: args.query,
          maxItems: args.maxItems,
        });
      },
    });
    const dispatch = createCodexMemoryMcpDispatcher({
      cwd: fixture.root, recall: read,
    });
    const rpc = args => dispatch({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'memory_recall', arguments: args },
    });
    const result = await rpc({ query, max_items: 5 });
    const found = JSON.parse(result.result.content[0].text);
    assert.equal(found.status, 'found_direct_ci_only');
    assert.equal(found.items[0].value, value);
    assert.equal(found.published_to_codex, false);
    assert.equal(found.trusted_for_production_recall, false);
    assert.equal(found.physical_human_approval_verified, false);
    assert.equal(calls, 1);
    const rejected = await rpc({
      query, projectId: 'github.com/foreign/repo',
    });
    assert.equal(JSON.parse(rejected.result.content[0].text).status,
      'forbidden_argument');
    assert.equal(calls, 1);
    fixture.git('checkout', '-b', 'unapproved');
    const wrongBranch = await rpc({ query });
    assert.equal(JSON.parse(wrongBranch.result.content[0].text).status,
      'user_direct_ci_not_enrolled');
    assert.equal(calls, 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('separate CI mode cannot silently override default global/cwd memory_recall', () => {
  const scope = join(tmpdir(), 'ci-scope.json');
  const pin = join(tmpdir(), 'ci-pin.pem');
  assert.equal(parseMemoryMcpArgs([
    '--ci-user-direct-read', '--scope', scope, '--pin', pin,
  ]).mode, 'ci_user_direct_read');
  assert.equal(parseMemoryMcpArgs(['--global']).mode, 'global_scoped');
  assert.throws(() => parseMemoryMcpArgs(['--global', '--ci-user-direct-read']));
  assert.throws(() => parseMemoryMcpArgs(['--ci-user-direct-read']));
});

test('without CI runtime and on failed signed pipe, no canonical SQLite fallback occurs', async () => {
  const fixture = makeGitFixture();
  try {
    const a = {
      cwd: fixture.root, scopePath: fixture.scopePath, pinPath: fixture.pinPath,
      query, accountSid: () => sid,
    };
    assert.equal((await readScopedUserDirectCi({
      ...a, platform: 'linux', ciEnv: {},
    })).status, 'user_direct_ci_only');
    let calls = 0;
    const outcome = await readScopedUserDirectCi({
      ...a, platform: 'win32',
      ciEnv: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' },
      request: async () => { calls++; throw new Error('simulated_offline'); },
    });
    assert.equal(outcome.status, 'user_direct_ci_signed_read_unverified');
    assert.deepEqual(outcome.items, []);
    assert.equal(calls, 1);
  } finally { rmSync(fixture.root, { force: true, recursive: true }); }
});

test('valid signature with wrong protocol/nonce/approval flag cannot enter CI user read', () => {
  const revision = 'b'.repeat(40);
  const a = {
    pinnedPublicKeyPem: pem, expectedProtocol: DIRECT_USER_CI_PROTOCOL,
    expectedNonce: nonce, expectedSid: sid, projectId: DIRECT_CI_PROJECT,
    branch: 'main', revisionSha: revision, query, maxItems: 3,
  };
  const bad = [
    signed(revision, { published_to_codex: true }),
    signed(revision, { trusted_for_production_recall: true }),
    signed(revision, { principal_sid: 'S-1-5-21-111111-222222-333333-1002' }),
    signed(revision, { revision_sha: 'c'.repeat(40) }),
    signed(revision, { physical_human_approval_verified: true }),
  ];
  for (const envelope of bad) {
    assert.throws(() => verifySignedDirectCiEnvelope({ ...a, envelope }),
      /direct_ci_read_unverified/);
  }
  assert.throws(() => verifySignedDirectCiEnvelope({
    ...a, envelope: signed(revision), expectedNonce: 'B'.repeat(43),
  }), /direct_ci_read_unverified/);
});
