import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  classifyCaptureFailure,
  classifyCaptureFailureOrigin,
  classifyCaptureValidationDetail,
  classifyCaptureValidationField,
  classifyCaptureValidationRule,
  inspectMemoryCapture,
} from '../../memory-engine/memory-capture-diagnostics.mjs';
import { parseCaptureDiagnosticArgs } from '../../scripts/diagnose-memory-capture.mjs';

test('failure groups classify hints but never return raw failure messages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capture-diagnostic-'));
  const dbPath = join(root, 'state.sqlite3');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE claims(project_id TEXT, branch_scope TEXT, state TEXT);
      CREATE TABLE memory_candidates(project_id TEXT, branch TEXT, status TEXT,
        source_authority TEXT, proposed_type TEXT, evaluated_at TEXT, relation TEXT);
      CREATE TABLE memory_evidence_proposals(project_id TEXT, branch TEXT, status TEXT,
        kind TEXT, importance_json TEXT, support_json TEXT);
      CREATE TABLE memory_pipeline_failures(project_id TEXT, branch TEXT, stage TEXT,
        error_class TEXT, error_text TEXT);
      CREATE TABLE memory_pipeline_runs(id TEXT, project_id TEXT, branch TEXT,
        trigger TEXT, status TEXT, promoted_count INTEGER, started_at TEXT);
    `);
    const projectId = 'github.com/example/project';
    const branch = 'main';
    db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?,?,?,?)').run(projectId, branch, 'pending', 'user_direct', 'constraint', null, null);
    db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?,?,?,?)').run(projectId, branch, 'ignored', 'user_direct', 'constraint', '2026-11-05', null);
    db.prepare('INSERT INTO memory_evidence_proposals VALUES (?,?,?,?,?,?)').run(projectId, branch, 'needs_confirmation', 'knowledge', '{}', null);
    db.prepare('INSERT INTO memory_evidence_proposals VALUES (?,?,?,?,?,?)').run(projectId, branch, 'ignored', 'knowledge', '{}', null);
    db.prepare('INSERT INTO memory_pipeline_failures VALUES (?,?,?,?,?)').run(projectId, branch, 'importance', 'candidate_stage_failure', '429 token: SECRET-ALPHA');
    db.prepare('INSERT INTO memory_pipeline_failures VALUES (?,?,?,?,?)').run(projectId, branch, 'importance', 'candidate_stage_failure', 'memory candidate judgment response must be JSON: Unexpected token SECRET-BETA');
    db.prepare('INSERT INTO memory_pipeline_failures VALUES (?,?,?,?,?)').run(projectId, branch, 'pipeline_control', 'PipelineStalled', 'automatic candidate queues made no progress');
    db.prepare('INSERT INTO memory_pipeline_failures VALUES (?,?,?,?,?)').run('other', branch, 'importance', 'candidate_stage_failure', '429 other');
    db.prepare('INSERT INTO memory_pipeline_runs VALUES (?,?,?,?,?,?,?)').run('private-run-id', projectId, branch, 'Stop', 'partial', 0, '2026-11-05T21:00:00Z');
    db.close();

    const result = inspectMemoryCapture({ dbPath, projectId, branch });
    assert.equal(result.claims, 0);
    assert.equal(result.candidates.total, 2);
    assert.deepEqual(result.candidates.groups.map((x) => [x.status, x.phase]).sort(), [['ignored','ignored'], ['pending','importance']]);
    assert.deepEqual(result.evidenceProposals.groups.map((x) => [x.status,x.phase]).sort(), [['ignored','ignored'], ['needs_confirmation','review']]);
    assert.equal(result.pipeline.failureCount, 3);
    assert.deepEqual(result.pipeline.failureGroups.map((x) => x.category).sort(), ['rate_limit','response_validation','unclassified']);
    assert.equal(result.pipeline.recentRuns[0].promotedCount, 0);
    const encoded = JSON.stringify(result);
    for (const secret of ['SECRET-ALPHA','SECRET-BETA','private-run-id','429 other']) {
      assert.equal(encoded.includes(secret), false, secret);
    }
    assert.throws(() => inspectMemoryCapture({ dbPath, projectId, branch, recentLimit: 999 }), /recentLimit/);
  } finally {
    try { db.close(); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});

test('validation failure detail is restricted to fixed safe labels', () => {
  const samples = [
    ['memory candidate judgment response must be JSON: Unexpected token SECRET-ALPHA', 'invalid_json'],
    ['unexpected field in memory candidate judgment: PRIVATE', 'unexpected_field'],
    ['missing field in memory candidate judgment: canonical_fact', 'missing_field'],
    ['promote requires empty risk_flags SECRET-BETA', 'decision_invariant'],
    ['meaning_preserved must be a boolean', 'schema_violation'],
    ['memory candidate judgment response must be non-empty JSON with unknown formatter SECRET-GAMMA', 'other_validation'],
  ];
  for (const [message, expected] of samples) {
    const detail = classifyCaptureValidationDetail(message);
    assert.equal(detail, expected);
    assert.equal(detail.includes('SECRET'), false);
    assert.equal(detail.includes('PRIVATE'), false);
  }
  assert.equal(classifyCaptureValidationDetail('429 rate limit'), null);
});

test('schema field is a fixed enum and never includes failing input', () => {
  const cases = [
    ['meaning_preserved must be a boolean', 'meaning_preserved'],
    ['risk_flags must be an array SECRET-ONE', 'risk_flags'],
    ['risk_flags must not contain duplicates', 'risk_flags'],
    ['suggested_type must be one of: PRIVATE', 'suggested_type'],
    ['canonical_fact must be at most 500 characters', 'canonical_fact'],
    ['memory candidate judgment must be an object', 'judgment_object'],
    ['promote requires durability=long', 'durability'],
    ['promote requires empty risk_flags', 'risk_flags'],
    ['ignore requires canonical_fact=null', 'canonical_fact'],
    ['promote requires UNKNOWN=long PRIVATE', 'unknown'],
  ];
  for (const [message, field] of cases) {
    assert.equal(classifyCaptureValidationField(message), field, message);
    assert.equal(classifyCaptureValidationField(message).includes('SECRET'), false);
    assert.equal(classifyCaptureValidationField(message).includes('PRIVATE'), false);
  }
  assert.equal(classifyCaptureValidationField('429 rate limit'), null);
  assert.equal(classifyCaptureValidationField('missing field in memory candidate judgment: SECRET-TWO'), null);
});

test('schema rule uses only fixed allowlisted labels', () => {
  const cases = [
    ['suggested_type must be one of: SECRET', 'invalid_enum'],
    ['meaning_preserved must be a boolean SECRET', 'invalid_type_or_empty'],
    ['risk_flags must not contain duplicates', 'duplicate_entries'],
    ['risk_flags must contain at most 7 entries', 'too_many_entries'],
    ['canonical_fact must be at most 500 characters', 'too_long'],
    ['reason must be a non-empty string', 'invalid_type_or_empty'],
    ['reason must contain SECRET-specific formatting', 'other_schema'],
  ];
  for (const [message, expected] of cases) {
    const actual = classifyCaptureValidationRule(message);
    assert.equal(actual, expected, message);
    assert.equal(actual.includes('SECRET'), false);
  }
  assert.equal(classifyCaptureValidationRule('promote requires durability=long'), null);
  assert.equal(classifyCaptureValidationRule('429 too many requests'), null);
});

test('judge subprocess output is not mistaken for canonical_fact validation', () => {
  const processError = 'codex candidate judge failed with exit 1: Provider output quoted the instruction: canonical_fact must be null.';
  assert.equal(classifyCaptureFailureOrigin(processError), 'judge_process_exit');
  assert.equal(classifyCaptureFailure(processError), 'judge_process_failure');
  assert.equal(classifyCaptureValidationDetail(processError), null);
  assert.equal(classifyCaptureValidationField(processError), null);
  assert.equal(classifyCaptureValidationRule(processError), null);

  const withRateLimit = 'codex candidate judge failed with exit 1: HTTP 429 rate limit; canonical_fact must be null.';
  assert.equal(classifyCaptureFailureOrigin(withRateLimit), 'judge_process_exit');
  assert.equal(classifyCaptureFailure(withRateLimit), 'rate_limit');
  assert.equal(classifyCaptureValidationDetail(withRateLimit), null);

  const validatorError = 'canonical_fact must be a non-empty string';
  assert.equal(classifyCaptureFailureOrigin(validatorError), 'candidate_validator');
  assert.equal(classifyCaptureFailure(validatorError), 'response_validation');
  assert.equal(classifyCaptureValidationDetail(validatorError), 'schema_violation');
  assert.equal(classifyCaptureValidationField(validatorError), 'canonical_fact');
  assert.equal(classifyCaptureValidationRule(validatorError), 'invalid_type_or_empty');
});

test('older schema and unknown error payloads degrade safely', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capture-diagnostic-legacy-'));
  const dbPath = join(root, 'state.sqlite3');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE claims(project_id TEXT, branch_scope TEXT, state TEXT)');
    db.close();
    const result = inspectMemoryCapture({ dbPath, projectId: 'project', branch: 'main' });
    assert.equal(result.candidates.available, false);
    assert.equal(result.evidenceProposals.available, false);
    assert.equal(result.pipeline.available, false);
    assert.equal(classifyCaptureFailure('400 invalid model format'), 'model_configuration');
    assert.equal(classifyCaptureFailure('opaque service failure'), 'unclassified');
  } finally {
    try { db.close(); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI requires a single explicit read-only scope', () => {
  assert.deepEqual(parseCaptureDiagnosticArgs([
    '--db-path', './memory.sqlite3', '--project-id', 'repo', '--branch', 'main',
  ]).branch, 'main');
  assert.throws(() => parseCaptureDiagnosticArgs(['--branch','main']), /expected/);
  assert.throws(() => parseCaptureDiagnosticArgs([
    '--db-path','/a','--db-path','/b','--project-id','repo','--branch','main',
  ]), /expected/);
});
