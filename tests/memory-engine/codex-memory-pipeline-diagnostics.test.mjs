import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { manageGlobalMemoryProject } from '../../memory-engine/adapters/codex-global-memory-scope.mjs';
import {
  diagnoseCodexMemoryPipeline,
  inspectCodexJudgePrerequisites,
} from '../../scripts/diagnose-codex-memory-pipeline.mjs';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'agenthub-memory-diagnostic-'));
  const first = join(base, 'alpha');
  const second = join(base, 'beta');
  const codexHome = join(base, 'codex-home');
  mkdirSync(first); mkdirSync(second); mkdirSync(codexHome);
  const repo = (path, name) => {
    execFileSync('git', ['init', '-b', 'main', path], { stdio: 'ignore' });
    execFileSync('git', ['-C', path, '-c', 'user.name=Test',
      '-c', 'user.email=test@example.invalid',
      'commit', '--allow-empty', '-m', 'initial'], { stdio: 'ignore' });
    execFileSync('git', ['-C', path, 'remote', 'add', 'origin',
      'https://github.com/example/' + name + '.git']);
  };
  repo(first, 'alpha');
  repo(second, 'beta');
  const memoryDb = join(base, 'memory.sqlite3');
  const scopePath = join(base, 'scopes.json');
  const memory = new MemoryEngine({ dbPath: memoryDb });
  memory.registerProject({
    projectId: 'github.com/example/alpha',
    repoIdentity: 'github.com/example/alpha',
  });
  memory.registerProject({
    projectId: 'github.com/example/beta',
    repoIdentity: 'github.com/example/beta',
  });
  memory.ingest({
    evidence: {
      id: 'e-real', projectId: 'github.com/example/alpha', harness: 'codex',
      sessionId: 'real-session', sourceKind: 'session',
      sourceRef: 'session:real-session',
      capturedAt: '2026-11-12T00:00:00Z', branch: 'main',
      commitSha: null, path: null, blobOid: null,
      content: 'Choose SQLite for the application',
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    },
    claim: {
      id: 'c-real', kind: 'decision', subject: 'storage', predicate: 'uses',
      value: 'SQLite', branchScope: 'main',
      createdAt: '2026-11-12T00:00:00Z',
    },
  });
  memory.recordEvidence({
    id: 'e-pending', projectId: 'github.com/example/beta', harness: 'codex',
    sessionId: 'real-beta', sourceKind: 'session',
    sourceRef: 'session:real-beta',
    capturedAt: '2026-11-12T00:00:00Z', branch: 'main',
    commitSha: null, path: null, blobOid: null,
    content: 'We decided to use SQLite',
    authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt' },
  });
  memory.recordCandidate({
    id: 'candidate-pending', evidenceId: 'e-pending', type: 'decision',
    proposedValue: 'We decided to use SQLite',
    decisionReason: 'rule:decision:definitive', policyVersion: 'capture-v1',
    fingerprint: 'a'.repeat(64), createdAt: '2026-11-12T00:00:00Z',
  });
  memory.close();
  for (const path of [first, second]) {
    manageGlobalMemoryProject({
      operation: 'add', cwd: path, dbPath: memoryDb, scopePath, apply: true,
    });
  }
  return {
    base, first, second, codexHome, memoryDb, scopePath,
    close() { rmSync(base, { recursive: true, force: true }); },
  };
}

test('judge prerequisite inspection is content-free and makes no CLI or model calls', () => {
  const f = fixture();
  try {
    let resolves = 0;
    const resolveJudge = () => {
      resolves += 1;
      return { kind: 'npm_js', command: 'private-path-value', prefixArgs: [] };
    };
    assert.deepEqual(inspectCodexJudgePrerequisites({
      codexHome: f.codexHome,
      env: {},
      platform: 'win32',
      resolveJudge,
    }), {
      executable: 'resolved_unverified',
      executable_kind: 'npm_js',
      auth_file: 'missing',
      status: 'auth_file_not_ready',
      actual_cli_login_verified: false,
      model_call_performed: false,
      note: 'A resolved executable and auth.json file do not prove login, network access, quotas or an executable judge model.',
    });
    writeFileSync(join(f.codexHome, 'auth.json'), 'PRIVATE_SECRET_NOT_TO_BE_READ');
    const report = diagnoseCodexMemoryPipeline({
      scopePath: f.scopePath,
      codexHome: f.codexHome,
      env: {},
      judgeInspector: (params) => inspectCodexJudgePrerequisites({
        ...params, platform: 'win32', resolveJudge,
      }),
    });
    assert.equal(report.judge_prerequisites.status, 'prerequisites_present_unverified');
    assert.equal(report.judge_prerequisites.auth_file, 'present_unverified');
    assert.equal(report.judge_prerequisites.actual_cli_login_verified, false);
    assert.equal(resolves, 2);
    assert.ok(!JSON.stringify(report).includes('PRIVATE_SECRET'));
    assert.ok(!JSON.stringify(report).includes('private-path-value'));
  } finally { f.close(); }
});

test('judge prerequisite inspection fails closed for unresolvable CLI', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.codexHome, 'auth.json'), 'PRIVATE_TEST_CREDENTIAL');
    const report = inspectCodexJudgePrerequisites({
      env: {}, platform: 'win32', codexHome: f.codexHome,
      resolveJudge() { throw new Error('PRIVATE_LOCAL_PATH'); },
    });
    assert.equal(report.status, 'cli_not_resolved');
    assert.equal(report.executable, 'unavailable');
    assert.equal(report.auth_file, 'present_unverified');
    assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  } finally { f.close(); }
});

test('judge prerequisite inspection does not interpret a directory as auth.json', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.codexHome, 'auth.json'));
    const report = inspectCodexJudgePrerequisites({
      env: {}, codexHome: f.codexHome,
      resolveJudge: () => ({ kind: 'native', command: '/fake/codex.exe' }),
    });
    assert.equal(report.auth_file, 'not_regular_file');
    assert.equal(report.status, 'auth_file_not_ready');
  } finally { f.close(); }
});

test('no memory values escape and original SQLite remains byte-for-byte unchanged', () => {
  const f = fixture();
  try {
    const hash = () => createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex');
    const before = hash();
    const report = diagnoseCodexMemoryPipeline({
      scopePath: f.scopePath, codexHome: f.codexHome,
    });
    assert.equal(report.status, 'inspected');
    assert.equal(report.read_only, true);
    assert.equal(report.approved_project_count, 2);
    assert.equal(report.hooks.status, 'missing');
    assert.equal(report.hooks.runtime_execution_observed, false);
    assert.equal(hash(), before);
    assert.equal(JSON.stringify(report).includes('Choose SQLite'), false);
    assert.equal(JSON.stringify(report).includes('We decided'), false);
    assert.equal(JSON.stringify(report).includes('real-session'), false);

    const alpha = report.projects.find(x => x.project_id.endsWith('/alpha'));
    assert.equal(alpha.status, 'inspected');
    assert.equal(alpha.branch, 'main');
    assert.equal(alpha.counts.user_prompt_evidence, 1);
    assert.equal(alpha.counts.claims_current_branch_by_state.active, 1);
    assert.equal(alpha.counts.eligible_claims_upper_bound, 1);
    assert.ok(alpha.findings.includes('some_potentially_retrievable_claims_check_query_matching'));

    const beta = report.projects.find(x => x.project_id.endsWith('/beta'));
    assert.equal(beta.status, 'inspected');
    assert.equal(beta.counts.pending_user_candidates, 1);
    assert.equal(beta.counts.eligible_claims_upper_bound, 0);
    assert.ok(beta.findings.includes('pending_user_candidates_without_pipeline_runs'));
  } finally { f.close(); }
});

test('missing scope and missing SQLite are reported without generating files', () => {
  const f = fixture();
  try {
    const absent = join(f.base, 'absent.json');
    const report = diagnoseCodexMemoryPipeline({
      scopePath: absent, codexHome: f.codexHome,
    });
    assert.equal(report.status, 'scope_not_configured');
    assert.equal(existsSync(absent), false);
    assert.deepEqual(report.projects, []);
  } finally { f.close(); }
});

test('hook configuration is inspected without claiming actual host execution', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.codexHome, 'hooks.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command',
            command: 'node scripts/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --candidate-capture --auto-pipeline' }],
        }],
      },
    }));
    const r = diagnoseCodexMemoryPipeline({
      scopePath: f.scopePath, codexHome: f.codexHome,
    });
    assert.equal(r.hooks.status, 'parsed');
    assert.equal(r.hooks.configured, true);
    assert.equal(r.hooks.flags.candidate_capture, true);
    assert.equal(r.hooks.flags.auto_pipeline_configured, true);
    assert.equal(r.hooks.runtime_execution_observed, false);
  } finally { f.close(); }
});


test('failure-stage codes identify real pipeline blockers without exposing error text', () => {
  const f = fixture();
  try {
    const memory = new MemoryEngine({ dbPath: f.memoryDb });
    try {
      memory.startPipelineRun({
        id: 'test-run-1', projectId: 'github.com/example/beta', branch: 'main',
        trigger: 'Stop', startedAt: '2026-11-12T00:00:00Z',
      });
      memory.recordPipelineFailure({
        runId: 'test-run-1', projectId: 'github.com/example/beta',
        branch: 'main', candidateId: 'candidate-pending',
        stage: 'importance', errorClass: 'TimeoutError',
        error: 'PRIVATE secret description that must not leak',
        occurredAt: '2026-11-12T00:01:00Z',
      });
      memory.recordPipelineFailure({
        runId: 'test-run-1', projectId: 'github.com/example/beta',
        branch: 'main', stage: 'pipeline_control',
        errorClass: 'PipelineStalled',
        error: 'PRIVATE internal failure description',
        occurredAt: '2026-11-12T00:01:01Z',
      });
      memory.finishPipelineRun({
        id: 'test-run-1', status: 'partial',
        finishedAt: '2026-11-12T00:01:02Z', durationMs: 62_000,
      });
      memory.startPipelineRun({
        id: 'test-running-stale', projectId: 'github.com/example/beta',
        branch: 'main', trigger: 'Stop', startedAt: '2020-01-01T00:00:00Z',
      });
    } finally { memory.close(); }

    const beforeHash = createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex');
    const report = diagnoseCodexMemoryPipeline({
      scopePath: f.scopePath, codexHome: f.codexHome,
    });
    const beta = report.projects.find((p) => p.project_id.endsWith('/beta'));
    assert.equal(beta.status, 'inspected');
    assert.equal(beta.counts.pipeline_failures, 2);
    assert.deepEqual(beta.counts.pipeline_failure_codes.by_stage,
      { importance: 1, pipeline_control: 1 });
    assert.deepEqual(beta.counts.pipeline_failure_codes.by_error_class,
      { PipelineStalled: 1, TimeoutError: 1 });
    assert.equal(beta.counts.pipeline_running_older_than_30m, 1);
    assert.ok(beta.findings.includes('pipeline_control_failures_detected'));
    assert.ok(beta.findings.includes('pipeline_running_older_than_30m'));
    assert.equal(beta.counts.pipeline_latest_failure_at, '2026-11-12T00:01:01Z');
    const out = JSON.stringify(report);
    assert.equal(out.includes('PRIVATE'), false);
    assert.equal(out.includes('secret description'), false);
    assert.equal(
      createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex'),
      beforeHash,
    );
  } finally { f.close(); }
});


test('semantic sync failure signatures identify worker outages without reading or leaking error text', () => {
  const f = fixture();
  try {
    const memory = new MemoryEngine({ dbPath: f.memoryDb });
    try {
      memory.startPipelineRun({
        id: 'semantic-signature-run',
        projectId: 'github.com/example/beta', branch: 'main',
        trigger: 'Stop', startedAt: '2026-11-12T00:00:00Z',
      });
      for (const [i, message] of [
        'embedding worker unavailable C:\\PRIVATE_ACCOUNT\\secrets',
        'embedding worker unavailable; offline E5 cache missing PRIVATE_PATH',
        'embedding worker model identity mismatch PRIVATE_MODEL_NAME',
        'embedding worker request failed PRIVATE_ACCOUNT',
        'embedding worker returned an invalid response PRIVATE_ACCOUNT',
        'UNKNOWN PRIVATE_SECRET that cannot be classified',
      ].entries()) {
        memory.recordPipelineFailure({
          runId: 'semantic-signature-run',
          projectId: 'github.com/example/beta', branch: 'main',
          stage: 'semantic_sync', errorClass: 'Error', error: message,
          occurredAt: '2026-11-12T00:00:0' + i + 'Z',
        });
      }
      memory.finishPipelineRun({
        id: 'semantic-signature-run', status: 'partial',
        finishedAt: '2026-11-12T00:01:00Z', durationMs: 60_000,
      });
    } finally { memory.close(); }

    const hash = () => createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex');
    const before = hash();
    const report = diagnoseCodexMemoryPipeline({
      scopePath: f.scopePath, codexHome: f.codexHome,
    });
    const beta = report.projects.find(p => p.project_id.endsWith('/beta'));
    assert.deepEqual(beta.counts.semantic_failure_signatures, {
      embedding_worker_invalid_response: 1,
      embedding_worker_model_mismatch: 1,
      embedding_worker_request_failed: 1,
      embedding_worker_unavailable: 1,
      offline_e5_cache_missing: 1,
      unclassified: 1,
    });
    assert.ok(beta.findings.includes('semantic_embedding_worker_unavailable'));
    assert.ok(beta.findings.includes('semantic_sync_failure_unclassified'));
    const publicReport = JSON.stringify(report);
    assert.ok(!publicReport.includes('PRIVATE'));
    assert.ok(!publicReport.includes('secrets'));
    assert.equal(hash(), before, 'read-only diagnostics must not change SQLite');
    const alpha = report.projects.find(p => p.project_id.endsWith('/alpha'));
    assert.deepEqual(alpha.counts.semantic_failure_signatures, {});
  } finally { f.close(); }
});

test('importance failure signatures are aggregate-only and do not expose raw Codex stderr', () => {
  const f = fixture();
  try {
    const memory = new MemoryEngine({ dbPath: f.memoryDb });
    try {
      memory.startPipelineRun({
        id: 'importance-signature-run',
        projectId: 'github.com/example/beta',
        branch: 'main',
        trigger: 'Stop',
        startedAt: '2026-11-12T00:00:00Z',
      });
      for (const [index, message] of [
        'codex candidate judge failed with exit 1: private token: PRIVATE_CREDENTIAL',
        'candidate judge requires an authenticated Codex home containing auth.json',
        'memory candidate judgment response must be JSON: PRIVATE_MODEL_RESPONSE',
        'spawn codex ENOENT C:\\\\private\\\\user\\\\path',
        'Unexpected uncategorized PRIVATE_DATA',
        'canonical_fact must be a non-empty string PRIVATE_CANARY_1',
        'canonical_fact must be at most 500 characters PRIVATE_CANARY_2',
      ].entries()) {
        memory.recordPipelineFailure({
          runId: 'importance-signature-run',
          projectId: 'github.com/example/beta',
          branch: 'main',
          candidateId: 'candidate-pending',
          stage: 'importance',
          errorClass: 'candidate_stage_failure',
          error: message,
          occurredAt: '2026-11-12T00:00:0' + index + 'Z',
        });
      }
      memory.finishPipelineRun({
        id: 'importance-signature-run', status: 'partial',
        finishedAt: '2026-11-12T00:01:00Z', durationMs: 60_000,
      });
    } finally { memory.close(); }

    const sha = () => createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex');
    const before = sha();
    const result = diagnoseCodexMemoryPipeline({
      scopePath: f.scopePath, codexHome: f.codexHome,
    });
    const beta = result.projects.find(x => x.project_id.endsWith('/beta'));
    assert.equal(beta.status, 'inspected');
    assert.deepEqual(beta.counts.importance_failure_signatures, {
      auth_file_missing: 1,
      canonical_fact_not_nonempty_string: 1,
      canonical_fact_over_500_chars: 1,
      codex_exec_nonzero: 1,
      codex_executable_not_found: 1,
      judge_json_invalid: 1,
      unclassified: 1,
    });
    assert.equal(
      Object.values(beta.counts.importance_failure_signatures)
        .reduce((total, count) => total + count, 0), 7,
    );
    assert.ok(beta.findings.includes('importance_failure_signature_unclassified'));
    for (const sensitive of ['PRIVATE_CREDENTIAL', 'PRIVATE_MODEL_RESPONSE',
      'PRIVATE_DATA', 'PRIVATE_CANARY_1', 'PRIVATE_CANARY_2', 'C:\\\\private']) {
      assert.ok(!JSON.stringify(result).includes(sensitive));
    }
    assert.equal(sha(), before);
  } finally { f.close(); }
});
