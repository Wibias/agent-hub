import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
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

test('memory console HTTP surface is loopback read-only and serves project drilldown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-ui-http-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  seed(memory);

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

    response = await fetch(base + '/api/overview', {
      method: 'POST',
    });
    assert.equal(response.status, 405);
    payload = await response.json();
    assert.equal(payload.message, 'Memory Console is read-only.');

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
