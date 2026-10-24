import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CLI = 'reference-graph/cli/p12-activation-preflight.mjs';
const QUERY = 'knowledge/design-references/scripts/query.mjs';
const ROUTER = 'reference-graph/p11-runtime-router.mjs';
const P11_EVIDENCE = 'reference-graph/evidence/p11-quick-activation-evidence.json';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

test('P12 plan is credential-free and explicitly non-authorizing', () => {
  const result = run(['--plan']);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.mode, 'plan');
  assert.equal(value.profile, 'quick');
  assert.equal(value.activation_flag, 'REFERENCE_GRAPH_QUICK_RUNTIME');
  assert.equal(value.activation_value, 'graph');
  assert.equal(value.runtime_auth_mode, 'publishable');
  assert.equal(value.timeout_ms, 1500);
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.deepEqual(value.allowed_modes, ['--plan', '--verify-repository', '--finalize-snapshot <path>']);
});

test('P12 repository verification hashes the exact bound production sources and P11 evidence', () => {
  const result = run(['--verify-repository']);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.mode, 'verify-repository');
  assert.equal(value.repository.query_source_sha256, sha256(QUERY));
  assert.equal(value.repository.router_source_sha256, sha256(ROUTER));
  assert.equal(value.repository.p11_evidence_sha256, sha256(P11_EVIDENCE));
  assert.equal(value.repository.p11_evidence_head_matches, true);
  assert.equal(value.repository.repository_default_graph_enabled, false);
  assert.equal(value.repository.migration_010_present, false);
  assert.equal(value.repository.service_role_runtime_reference, false);
  assert.match(value.binding_hash, /^[0-9a-f]{64}$/);
});

test('P12 finalizes a supplied live snapshot through structural preflight and canonical receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p12-preflight-'));
  try {
    const file = join(dir, 'snapshot.json');
    writeFileSync(file, JSON.stringify({
      reference_time: '2026-10-24T02:00:00.000Z',
      verification_at: '2026-10-24T02:01:00.000Z',
      git_sha: '1'.repeat(40),
      live_projection: {
        target_status: 'ACTIVE_HEALTHY',
        snapshot_date: '2026-10-24',
        candidate_count: 275,
        metadata_complete_count: 275,
        unique_legacy_id_count: 275,
        empty_legacy_id_count: 0,
        duplicate_legacy_id_count: 0,
      },
      security: {
        runtime_auth_mode: 'publishable',
        service_role_runtime_used: false,
        security_advisor_p9_p10_warn_error_count: 0,
      },
    }));

    const result = run(['--finalize-snapshot', file]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.schema_version, 'reference-graph.p12-activation-authority.v1');
    assert.equal(receipt.preflight_ready, true);
    assert.equal(receipt.grant_state, 'not-issued');
    assert.equal(receipt.activation_authorized, false);
    assert.equal(receipt.activation_performed, false);
    assert.equal(receipt.repository_default_graph_enabled, false);
    assert.equal(receipt.production_source, 'legacy-control');
    assert.deepEqual(receipt.blockers, []);
    assert.match(receipt.binding_hash, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P12 operator requires exactly one mode and refuses unknown activation-like modes', () => {
  for (const args of [
    [],
    ['--plan', '--verify-repository'],
    ['--activate'],
    ['--apply'],
    ['--deploy'],
    ['--set-env'],
    ['--finalize-snapshot'],
  ]) {
    const result = run(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
  }
});

test('P12 operator source has no executable activation, write, refresh, or privileged credential path', () => {
  const source = readFileSync(CLI, 'utf8');
  for (const forbidden of [
    /--activate\b/,
    /--apply\b/,
    /--deploy\b/,
    /--set-env\b/,
    /process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=/,
    /SERVICE_ROLE_KEY/i,
    /SUPABASE_SERVICE_ROLE/i,
    /reference_graph_refresh_quick_runtime_projection/i,
    /recordVerifications\s*\(/,
    /upsert/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
