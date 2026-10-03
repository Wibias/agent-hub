import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  CAPTURE_POLICY_VERSION,
  memoryCandidateFingerprint,
} from '../../memory-engine/memory-capture-policy.mjs';
import {
  memoryUiClaim,
  memoryUiOverview,
  memoryUiScope,
} from '../../memory-engine/memory-ui-model.mjs';
import {
  createMemoryUiServer,
  parseMemoryUiArgs,
} from '../../scripts/memory-ui.mjs';

function seed(memory) {
  memory.registerProject({
    projectId: 'github.com/example/alpha',
    repoIdentity: 'github.com/example/alpha',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  memory.registerProject({
    projectId: 'github.com/example/beta',
    repoIdentity: 'github.com/example/beta',
    createdAt: '2026-10-01T00:00:00.000Z',
  });

  memory.ingest({
    evidence: {
      id: 'e-user-alpha',
      projectId: 'github.com/example/alpha',
      harness: 'codex',
      sessionId: 'session-user',
      sourceKind: 'session',
      sourceRef: 'session:session-user',
      capturedAt: '2026-10-02T10:00:00.000Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'memory: production database is Postgres',
      authorityClass: 'user_direct',
      metadata: {
        event_type: 'user_prompt',
      },
    },
    claim: {
      id: 'claim-user-alpha',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value: 'memory: production database is Postgres',
      state: 'active',
      branchScope: 'main',
      createdAt: '2026-10-02T10:00:00.000Z',
    },
  });

  memory.ingest({
    evidence: {
      id: 'e-agent-alpha',
      projectId: 'github.com/example/alpha',
      harness: 'codex',
      sessionId: 'session-agent',
      sourceKind: 'subagent',
      sourceRef: 'codex:subagent:agent-7',
      capturedAt: '2026-10-02T11:00:00.000Z',
      branch: 'feature/ui',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'Agent decision: keep the console read-only.',
      authorityClass: 'agent_inference',
      metadata: {
        event_type: 'subagent_stop',
        agent_id: 'agent-7',
        agent_type: 'explorer',
        turn_id: 'turn-7',
      },
    },
    claim: {
      id: 'claim-agent-alpha',
      kind: 'agent_inference',
      subject: 'agent decision',
      predicate: 'states',
      value: 'Agent decision: keep the console read-only.',
      state: 'active',
      branchScope: 'feature/ui',
      createdAt: '2026-10-02T11:00:00.000Z',
    },
  });

  memory.ingest({
    evidence: {
      id: 'e-beta',
      projectId: 'github.com/example/beta',
      harness: 'codex',
      sessionId: 'session-beta',
      sourceKind: 'session',
      sourceRef: 'session:session-beta',
      capturedAt: '2026-10-01T08:00:00.000Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'memory: queue is durable',
      authorityClass: 'user_direct',
      metadata: {
        event_type: 'user_prompt',
      },
    },
    claim: {
      id: 'claim-beta',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value: 'memory: queue is durable',
      state: 'active',
      branchScope: 'main',
      createdAt: '2026-10-01T08:00:00.000Z',
    },
  });

  memory.startPipelineRun({
    id: 'pipeline-run:ui',
    projectId: 'github.com/example/alpha',
    branch: 'main',
    revisionSha: 'a'.repeat(40),
    trigger: 'Stop',
    startedAt: '2026-10-02T12:00:00.000Z',
  });
  memory.finishPipelineRun({
    id: 'pipeline-run:ui',
    status: 'drained',
    finishedAt: '2026-10-02T12:00:00.050Z',
    durationMs: 50,
    rounds: 1,
    promotedCount: 1,
    stageCounts: {
      agent_importance: {
        total: 1,
        promoted: 1,
      },
    },
    candidateRefs: ['~1234567890'],
  });
}

function seedReviewCandidate(memory, {
  id,
  value,
} = {}) {
  const evidence = memory.recordEvidence({
    id: 'e-' + id,
    projectId: 'github.com/example/alpha',
    harness: 'codex',
    sessionId: 'review',
    sourceKind: 'session',
    sourceRef: 'session:review',
    capturedAt: '2026-10-02T13:00:00.000Z',
    branch: 'main',
    content: value,
    authorityClass: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      candidate_capture: true,
    },
  });
  const candidate = memory.recordCandidate({
    id,
    evidenceId: evidence.id,
    type: 'decision',
    proposedValue: evidence.content_redacted,
    decisionReason: 'rule:decision:definitive',
    policyVersion: CAPTURE_POLICY_VERSION,
    fingerprint: memoryCandidateFingerprint({
      type: 'decision',
      value: evidence.content_redacted,
    }),
    createdAt: '2026-10-02T13:00:00.000Z',
  });
  memory.evaluateCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:importance-v2',
    evaluatedAt: '2026-10-02T13:01:00.000Z',
    evaluation: {
      decision: 'needs_confirmation',
      suggested_type: 'decision',
      durability: 'medium',
      future_utility: 'medium',
      specificity: 'high',
      confidence: 'medium',
      meaning_preserved: true,
      canonical_fact: null,
      reason: 'Explicit UI review fixture.',
      risk_flags: ['scope_unclear'],
    },
  });
  return memory.getCandidate(candidate.id);
}

test('memory console browser source parses and keeps the divider-first visual contract', async () => {
  const appPath = new URL('../../memory-ui/app.js', import.meta.url);
  const cssPath = new URL('../../memory-ui/styles.css', import.meta.url);
  const htmlPath = new URL('../../memory-ui/index.html', import.meta.url);

  const syntax = spawnSync(
    process.execPath,
    ['--check', fileURLToPath(appPath)],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(
    syntax.status,
    0,
    syntax.stderr || syntax.stdout || 'browser source failed syntax check',
  );

  const [appSource, css, html] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(cssPath, 'utf8'),
    readFile(htmlPath, 'utf8'),
  ]);
  assert.doesNotMatch(appSource, /style="/i);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/i);
  const radii = [...css.matchAll(/border-radius:\s*([^;]+);/gi)]
    .map((match) => match[1].trim());
  assert.equal(radii.length > 0, true);
  assert.deepEqual([...new Set(radii)], ['0']);
  assert.match(css, /border-bottom:\s*1px solid var\(--line\)/i);
  assert.match(html, /class="sidebar"/);
  assert.match(html, /class="tabs"/);
  assert.doesNotMatch(html, /class="[^"]*card/i);
});

test('memory console args expose port/db only and keep host fixed internally', () => {
  const parsed = parseMemoryUiArgs([
    '--port', '5001',
    '--db-path', './fixture.sqlite3',
  ]);
  assert.equal(parsed.port, 5001);
  assert.match(parsed.dbPath, /fixture\.sqlite3$/);

  assert.throws(
    () => parseMemoryUiArgs(['--host', '0.0.0.0']),
    /unknown argument/i,
  );
  assert.throws(
    () => parseMemoryUiArgs(['--port', '70000']),
    /between 1 and 65535/i,
  );
});

test('memory console overview groups durable memory by project and branch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-ui-overview-'));
  const memory = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
  });

  try {
    seed(memory);
    const overview = memoryUiOverview(memory);

    assert.equal(overview.projects.length, 2);
    const alpha = overview.projects.find(
      (item) => item.projectId === 'github.com/example/alpha',
    );
    assert.equal(alpha.total, 2);
    assert.equal(alpha.active, 2);
    assert.equal(alpha.defaultBranch, 'main');
    assert.deepEqual(
      alpha.branches.map((item) => item.branch),
      ['main', 'feature/ui'],
    );

    const feature = alpha.branches.find(
      (item) => item.branch === 'feature/ui',
    );
    assert.equal(feature.agentInference, 1);
    assert.equal(feature.userDirect, 0);
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('memory console scope and inspector expose authority provenance and observability', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-ui-scope-'));
  const memory = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
    clock: () => '2026-10-03T00:00:00.000Z',
  });

  try {
    seed(memory);

    const main = memoryUiScope(memory, {
      projectId: 'github.com/example/alpha',
      branch: 'main',
    });
    assert.equal(main.memories.length, 1);
    assert.equal(main.memories[0].authority, 'user_direct');
    assert.match(main.memories[0].ref, /^@[0-9a-f]{10}$/);
    assert.equal(main.pipeline.runs.length, 1);
    assert.match(main.pipeline.runs[0].ref, /^@p[0-9a-f]{10}$/);
    assert.equal(main.health.db_healthy, true);

    const feature = memoryUiScope(memory, {
      projectId: 'github.com/example/alpha',
      branch: 'feature/ui',
    });
    assert.equal(feature.memories.length, 1);
    assert.equal(feature.memories[0].authority, 'agent_inference');
    assert.equal(feature.memories[0].provenance.type, 'subagent');
    assert.equal(feature.memories[0].provenance.agentId, 'agent-7');
    assert.equal(feature.memories[0].provenance.agentType, 'explorer');

    const detail = memoryUiClaim(memory, {
      projectId: 'github.com/example/alpha',
      branch: 'feature/ui',
      claimId: 'claim-agent-alpha',
    });
    assert.equal(detail.claim.authority, 'agent_inference');
    assert.equal(detail.claim.provenance.sessionId, 'session-agent');
    assert.equal(detail.claim.provenance.turnId, 'turn-7');
    assert.equal(detail.semanticIndexed, false);
    assert.deepEqual(detail.lifecycle, []);
    assert.deepEqual(detail.conflicts, []);
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('MemoryEngine read-only mode permits inspection and rejects mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-ui-readonly-'));
  const dbPath = join(root, 'memory.sqlite3');
  const writable = new MemoryEngine({ dbPath });
  seed(writable);
  writable.close();

  const readOnly = new MemoryEngine({
    dbPath,
    readOnly: true,
  });
  try {
    const overview = memoryUiOverview(readOnly);
    assert.equal(overview.projects.length, 2);
    const scope = memoryUiScope(readOnly, {
      projectId: 'github.com/example/alpha',
      branch: 'main',
    });
    assert.equal(scope.memories.length, 1);
    assert.equal(scope.health.db_healthy, true);
    assert.equal(scope.pipeline.runs.length, 1);
    assert.throws(
      () => readOnly.registerProject({
        projectId: 'github.com/example/write-attempt',
        repoIdentity: 'github.com/example/write-attempt',
      }),
      /readonly|read-only|attempt to write/i,
    );
  } finally {
    readOnly.close();
    await rm(root, { recursive: true, force: true });
  }
});

function requestWithHost({
  port,
  path,
  hostHeader,
}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        Host: hostHeader,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolvePromise({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', rejectPromise);
    req.end();
  });
}

test('memory console HTTP surface keeps reads loopback-only and protects explicit actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-ui-http-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  seed(memory);
  seedReviewCandidate(memory, {
    id: 'candidate-ui-reject',
    value: 'We should keep this only if the user confirms it.',
  });
  seedReviewCandidate(memory, {
    id: 'candidate-ui-confirm',
    value: 'We should store signed release evidence across sessions.',
  });

  const runtime = createMemoryUiServer({
    dbPath,
    memory,
    includeRuntimeHealth: false,
  });

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      runtime.server.once('error', rejectPromise);
      runtime.server.listen(0, runtime.host, () => {
        runtime.server.off('error', rejectPromise);
        resolvePromise();
      });
    });

    const address = runtime.server.address();
    assert.equal(runtime.host, '127.0.0.1');
    assert.equal(typeof address, 'object');
    const base = `http://127.0.0.1:${address.port}`;

    let response = await fetch(base + '/api/overview');
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.projects.length, 2);
    assert.equal(payload.actions.enabled, true);
    assert.match(payload.actions.token, /^[0-9a-f]{48}$/);
    const actionToken = payload.actions.token;

    const rebound = await requestWithHost({
      port: address.port,
      path: '/api/overview',
      hostHeader: 'evil.example',
    });
    assert.equal(rebound.status, 403);
    payload = JSON.parse(rebound.body);
    assert.equal(payload.error, 'invalid_host');

    response = await fetch(
      base
      + '/api/scope?projectId='
      + encodeURIComponent('github.com/example/alpha')
      + '&branch=main',
    );
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.memories.length, 1);
    assert.equal(payload.pipeline.runs.length, 1);

    response = await fetch(
      base
      + '/api/claim?projectId='
      + encodeURIComponent('github.com/example/alpha')
      + '&branch=feature%2Fui'
      + '&claimId=claim-agent-alpha',
    );
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.claim.provenance.agentId, 'agent-7');

    response = await fetch(base + '/api/actions/replace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: 'github.com/example/alpha',
        branch: 'main',
        claimRef: memoryUiScope(memory, {
          projectId: 'github.com/example/alpha',
          branch: 'main',
        }).memories.find((item) => item.claimId === 'claim-user-alpha').ref,
        newValue: 'memory: production database is CockroachDB',
      }),
    });
    assert.equal(response.status, 403);

    response = await fetch(base + '/api/actions/replace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Hub-Action-Token': actionToken,
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({
        projectId: 'github.com/example/alpha',
        branch: 'main',
        claimRef: '@0000000000',
        newValue: 'memory: malicious replacement',
      }),
    });
    assert.equal(response.status, 403);

    const initialScope = memoryUiScope(memory, {
      projectId: 'github.com/example/alpha',
      branch: 'main',
    });
    const originalRef = initialScope.memories.find(
      (item) => item.claimId === 'claim-user-alpha',
    ).ref;

    response = await fetch(base + '/api/actions/replace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Hub-Action-Token': actionToken,
      },
      body: JSON.stringify({
        projectId: 'github.com/example/alpha',
        branch: 'main',
        claimRef: originalRef,
        newValue: 'memory: production database is CockroachDB',
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.match(payload.reason, /replaced/i);
    assert.equal(memory.getClaim('claim-user-alpha').state, 'superseded');

    const replacedScope = memoryUiScope(memory, {
      projectId: 'github.com/example/alpha',
      branch: 'main',
    });
    const replacement = replacedScope.memories.find(
      (item) => item.value === 'memory: production database is CockroachDB',
    );
    assert.ok(replacement);
    assert.equal(replacement.state, 'active');

    response = await fetch(base + '/api/actions/forget', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Hub-Action-Token': actionToken,
      },
      body: JSON.stringify({
        projectId: 'github.com/example/alpha',
        branch: 'main',
        claimRef: replacement.ref,
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.match(payload.reason, /forgotten/i);

    let scope = memoryUiScope(memory, {
      projectId: 'github.com/example/alpha',
      branch: 'main',
    });
    assert.equal(
      scope.memories.find((item) => item.claimId === replacement.claimId).state,
      'rejected',
    );

    const rejectCandidate = scope.candidates.find(
      (item) => item.id === 'candidate-ui-reject',
    );
    assert.equal(rejectCandidate.reviewable, true);
    response = await fetch(base + '/api/actions/candidate-reject', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Hub-Action-Token': actionToken,
      },
      body: JSON.stringify({
        projectId: 'github.com/example/alpha',
        branch: 'main',
        candidateRef: rejectCandidate.ref,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(memory.getCandidate(rejectCandidate.id).status, 'ignored');
    assert.equal(
      memory.getCandidateRejection(rejectCandidate.id).status,
      'ignored',
    );

    scope = memoryUiScope(memory, {
      projectId: 'github.com/example/alpha',
      branch: 'main',
    });
    const confirmCandidate = scope.candidates.find(
      (item) => item.id === 'candidate-ui-confirm',
    );
    response = await fetch(base + '/api/actions/candidate-confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Hub-Action-Token': actionToken,
      },
      body: JSON.stringify({
        projectId: 'github.com/example/alpha',
        branch: 'main',
        candidateRef: confirmCandidate.ref,
        relation: 'unrelated',
        targetRef: null,
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.match(payload.reason, /confirmed/i);
    assert.equal(memory.getCandidate(confirmCandidate.id).status, 'promoted');
    assert.equal(
      memory.getCandidateConfirmation(confirmCandidate.id).status,
      'promoted',
    );

    response = await fetch(base + '/api/overview', {
      method: 'POST',
    });
    assert.equal(response.status, 405);
    payload = await response.json();
    assert.equal(payload.message, 'Unsupported Memory Console method.');

    response = await fetch(base + '/styles.css');
    assert.equal(response.status, 200);
    const css = await response.text();
    assert.doesNotMatch(css, /linear-gradient|radial-gradient/i);
    assert.match(css, /border-bottom: 1px solid var\(--line\)/);
  } finally {
    await new Promise((resolvePromise) => {
      runtime.server.close(resolvePromise);
    });
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});
