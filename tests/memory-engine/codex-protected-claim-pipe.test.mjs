import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROTECTED_LAB_BRANCH, PROTECTED_LAB_PROJECT, PROTECTED_LAB_PROTOCOL,
  verifyProtectedLabReadEnvelope, readScopedProtectedLabMemory,
} from '../../memory-engine/adapters/codex-protected-claim-pipe.mjs';
import { createCodexMemoryMcpDispatcher } from '../../memory-engine/adapters/codex-readonly-memory-mcp.mjs';
import { parseMemoryMcpArgs } from '../../scripts/run-codex-memory-mcp.mjs';

const nonce = 'A'.repeat(43);
const value = 'Synthetic non-authorizing lab fact';
const digest = createHash('sha256').update(value).digest('hex');
const genKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pair = genKey();
const pem = pair.publicKey.export({ type: 'spki', format: 'pem' });

function payload(extra = {}) {
  return {
    protocol: PROTECTED_LAB_PROTOCOL,
    nonce,
    project_id: PROTECTED_LAB_PROJECT,
    branch: PROTECTED_LAB_BRANCH,
    status: 'found_lab_only',
    read_only: true,
    service_signed: true,
    human_approval_verified: false,
    items: [{
      claim_id: 'C~' + 'a'.repeat(24),
      project_id: PROTECTED_LAB_PROJECT,
      branch: PROTECTED_LAB_BRANCH,
      revision_sha: 'a'.repeat(40),
      fact_sha256: digest,
      evidence_sha256: 'b'.repeat(64),
      kind: 'knowledge',
      value,
      created_at: '2026-11-14T10:00:00.000Z',
      provenance: 'synthetic_disposable_lab',
      human_approval_verified: false,
    }],
    ...extra,
  };
}
function signed(p, privateKey = pair.privateKey) {
  const raw = Buffer.from(JSON.stringify(p));
  return {
    protocol: PROTECTED_LAB_PROTOCOL,
    payload_b64: raw.toString('base64'),
    signature_b64: sign('sha256', raw, privateKey).toString('base64'),
  };
}
const args = envelope => ({
  envelope, pinnedPublicKeyPem: pem, expectedNonce: nonce,
  projectId: PROTECTED_LAB_PROJECT, branch: PROTECTED_LAB_BRANCH,
});

test('signed protected result is scoped and remains explicitly synthetic, not human approved', () => {
  const item = verifyProtectedLabReadEnvelope(args(signed(payload())));
  assert.equal(item.status, 'found_lab_only');
  assert.equal(item.signed_response_verified, true);
  assert.equal(item.trusted_for_production_recall, false);
  assert.equal(item.real_human_approval_verified, false);
  assert.equal(item.items[0].value, value);
});

test('wrong signing key, tampered payload, swapped nonce and foreign scope are denied', () => {
  const good = signed(payload());
  const badKey = genKey();
  assert.throws(() => verifyProtectedLabReadEnvelope(args(
    signed(payload(), badKey.privateKey))), /protected_read_unverified/);
  const altered = structuredClone(good);
  altered.payload_b64 = Buffer.from(JSON.stringify(payload({
    items: [{ ...payload().items[0], value: 'injected claim' }],
  }))).toString('base64');
  assert.throws(() => verifyProtectedLabReadEnvelope(args(altered)), /protected_read_unverified/);
  assert.throws(() => verifyProtectedLabReadEnvelope({
    ...args(good), expectedNonce: 'B'.repeat(43),
  }), /protected_read_unverified/);
  assert.throws(() => verifyProtectedLabReadEnvelope({
    ...args(good), projectId: 'github.com/other/secret',
  }), /protected_read_unverified/);
});

test('even validly signed forged status, digest and human approval cannot become authority', () => {
  const claim = payload().items[0];
  const changes = [
    payload({ human_approval_verified: true }),
    payload({ items: [{ ...claim, human_approval_verified: true }] }),
    payload({ items: [{ ...claim, fact_sha256: 'f'.repeat(64) }] }),
    payload({ items: [{ ...claim, project_id: 'github.com/other/secret' }] }),
    payload({ items: [{ ...claim, provenance: 'user_direct' }] }),
    payload({ status: 'approved_production' }),
    payload({ status: 'no_match_lab_only' }),
  ];
  for (const item of changes) {
    assert.throws(() => verifyProtectedLabReadEnvelope(args(signed(item))),
      /protected_read_unverified/);
  }
  const empty = verifyProtectedLabReadEnvelope(args(signed(payload({
    status: 'no_match_lab_only', items: [],
  }))));
  assert.equal(empty.items.length, 0);
});

test('lab reader uses actual approved Git root/branch and fails before IPC for wrong identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-protected-scope-'));
  try {
    const scopePath = join(root, 'scope.json');
    const pinPath = join(root, 'pin.pem');
    const manifest = {
      projects: [{
        root, project_id: PROTECTED_LAB_PROJECT, repo_identity: PROTECTED_LAB_PROJECT,
      }],
    };
    let called = 0;
    const base = {
      cwd: root, scopePath, pinPath, query: value,
      scopeLoader: () => manifest,
      describe: () => ({
        root, project_id: PROTECTED_LAB_PROJECT,
        repo_identity: PROTECTED_LAB_PROJECT,
      }),
      gitResolver: () => ({ branch: PROTECTED_LAB_BRANCH }),
      request: async () => {
        called++;
        return { status: 'found_lab_only', signed_response_verified: true, items: [] };
      },
    };
    assert.equal((await readScopedProtectedLabMemory(base)).status, 'found_lab_only');
    assert.equal(called, 1);
    assert.equal((await readScopedProtectedLabMemory({
      ...base, gitResolver: () => ({ branch: 'foreign' }),
    })).status, 'protected_lab_scope_not_enrolled');
    assert.equal((await readScopedProtectedLabMemory({
      ...base, describe: () => ({
        root, project_id: 'github.com/foreign/repo',
        repo_identity: 'github.com/foreign/repo',
      }),
    })).status, 'project_identity_changed');
    assert.equal((await readScopedProtectedLabMemory({
      ...base, scopeLoader: () => ({ projects: [] }),
    })).status, 'project_not_approved');
    assert.equal(called, 1);
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test('existing memory_recall dispatcher can await async signed read; model cannot choose source', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agenthub-signed-mcp-'));
  try {
    const dispatch = createCodexMemoryMcpDispatcher({
      cwd, recall: async ({ query }) => ({
        status: 'found_lab_only', query,
        signed_response_verified: true,
        human_approval_verified: false,
        trusted_for_production_recall: false,
        items: [],
      }),
    });
    const tool = async arguments_ => dispatch({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'memory_recall', arguments: arguments_ },
    });
    const good = await tool({ query: 'Synthetic' });
    assert.equal(JSON.parse(good.result.content[0].text).signed_response_verified, true);
    const denied = await tool({
      query: 'Synthetic', projectId: 'github.com/foreign/repo',
    });
    assert.equal(JSON.parse(denied.result.content[0].text).status, 'forbidden_argument');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('protected read mode is explicit, separate from normal Codex global recall', () => {
  const root = join(tmpdir(), 'agenthub-signed-absolute');
  assert.equal(parseMemoryMcpArgs([
    '--lab-protected-read', '--scope', join(root, 'scope.json'),
    '--pin', join(root, 'pin.pem'),
  ]).mode, 'protected_lab_read');
  assert.equal(parseMemoryMcpArgs(['--global']).mode, 'global_scoped');
  assert.throws(() => parseMemoryMcpArgs(['--global', '--pin', join(root, 'pin.pem')]));
});
