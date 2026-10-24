import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('P12 live evidence probe emits the canonical production receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p12-live-evidence-'));
  try {
    const snapshot = join(dir, 'snapshot.json');
    writeFileSync(snapshot, JSON.stringify({
      reference_time: '2026-10-24T00:45:39.128Z',
      verification_at: '2026-10-24T00:45:39.128Z',
      git_sha: '8031d9d7932db8c892c401de8dea4a7f9c97bee8',
      live_projection: {
        target_status: 'ACTIVE_HEALTHY',
        snapshot_date: '2026-10-24',
        candidate_count: 275,
        metadata_complete_count: 275,
        unique_legacy_id_count: 275,
        empty_legacy_id_count: 0,
        duplicate_legacy_id_count: 0
      },
      security: {
        runtime_auth_mode: 'publishable',
        service_role_runtime_used: false,
        security_advisor_p9_p10_warn_error_count: 0
      }
    }));
    const result = spawnSync(process.execPath, [
      'reference-graph/cli/p12-activation-preflight.mjs',
      '--finalize-snapshot',
      snapshot,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    console.log(`P12_CANONICAL_RECEIPT=${JSON.stringify(receipt)}`);
    assert.equal(receipt.preflight_ready, true);
    assert.equal(receipt.grant_state, 'not-issued');
    assert.equal(receipt.activation_authorized, false);
    assert.equal(receipt.activation_performed, false);
    assert.equal(receipt.repository_default_graph_enabled, false);
    assert.equal(receipt.production_source, 'legacy-control');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
