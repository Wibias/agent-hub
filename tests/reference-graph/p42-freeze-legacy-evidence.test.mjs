import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import {
  verifyP42LegacyCheckout, buildP42LegacyInputs,
  freezeP42LocalEvidence,
} from '../../reference-graph/cli/p42-freeze-legacy-evidence.mjs';

const CONTROL = '83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const now = new Date('2026-11-09T08:00:00.000Z');
const source = readFileSync('reference-graph/shadow-cases.json', 'utf8');
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const revision = { checkout_sha: 'a'.repeat(40), control_commit_sha: CONTROL };

test('P42 strictly checks immutable Legacy control paths and rejects Git drift', () => {
  const calls = [];
  const command = args => {
    calls.push(args);
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return process.cwd();
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'a'.repeat(40);
    return '';
  };
  const proof = verifyP42LegacyCheckout({ command });
  assert.deepEqual(proof, revision);
  assert.ok(calls.some(x => x.includes('merge-base')));
  assert.ok(calls.some(x => x.includes('diff') && x.includes(CONTROL)));
  assert.ok(calls.some(x => x.includes('knowledge/design-references')));
  assert.throws(() => verifyP42LegacyCheckout({
    command: args => args[0] === 'rev-parse' && args[1] === '--show-toplevel'
      ? '/untrusted/path' : 'a'.repeat(40),
  }), /BLOCKED/);
  assert.throws(() => verifyP42LegacyCheckout({
    command: args => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return process.cwd();
      if (args[0] === 'rev-parse') return 'a'.repeat(40);
      if (args[0] === 'ls-files') return 'untracked-catalog.json';
      return '';
    },
  }), /BLOCKED/);
});

test('P42 builds consistent 48-case Legacy-only P27/P34 inputs without Graph', async () => {
  const data = await buildP42LegacyInputs({
    date: '2026-11-09', records: loadRecords(),
    patterns: loadPatterns(), templatesRaw: source,
  });
  assert.equal(JSON.parse(data.baseline).cases.length, 48);
  assert.equal(JSON.parse(data.publicBaseline).cases.length, 48);
  assert.equal(JSON.parse(data.templates).length, 24);
  assert.ok(Array.isArray(JSON.parse(data.records)));
  assert.ok(Array.isArray(JSON.parse(data.patterns)));
  assert.throws(() => buildP42LegacyInputs({ date: '2026-02-30' }), /BLOCKED/);
});

test('P42 writes private new local files with correct byte pins; manifest cannot self-attest', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'p42-private-'));
  const dir = join(temp, 'new-evidence');
  try {
    const result = await freezeP42LocalEvidence({
      date: '2026-11-09', outputDir: dir,
      verifyCheckout: () => revision,
      readText: () => source,
      records: loadRecords(), patterns: loadPatterns(), observedAt: now,
    });
    assert.equal(result.artifact_count, 5);
    assert.equal(result.activation_authorized, false);
    const index = JSON.parse(readFileSync(join(dir,'p42-local-index.json'),'utf8'));
    const manifest = JSON.parse(readFileSync(join(dir,'p40-manifest-DRAFT.json'),'utf8'));
    assert.equal(index.legacy_control_sha, CONTROL);
    assert.equal(index.independent_source_attestation, false);
    assert.equal(manifest.approved_record_report_sha256, null);
    assert.equal(manifest.files.sourceWitness.sha256, 'UNATTESTED');
    for (const file of Object.values(index.files)) {
      assert.equal(file.sha256, sha(readFileSync(file.path, 'utf8')));
    }
    await assert.rejects(freezeP42LocalEvidence({
      date: '2026-11-09', outputDir: dir,
      verifyCheckout: () => revision, readText: () => source,
      records: loadRecords(), patterns: loadPatterns(), observedAt: now,
    }), /BLOCKED/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
