import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  commitCodexMemoryClaim,
} from '../../memory-engine/adapters/codex-memory-commit-cli.mjs';

function userEvidence(overrides = {}) {
  return {
    id: 'e-user',
    projectId: 'github.com/example/project',
    harness: 'codex',
    sessionId: 'session-1',
    sourceKind: 'session',
    sourceRef: 'session:session-1',
    capturedAt: '2026-09-30T08:00:00.000Z',
    branch: 'main',
    commitSha: null,
    path: null,
    blobOid: null,
    content: 'Use Postgres for concurrent writers.',
    authorityClass: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      turn_id: 'turn-1',
    },
    ...overrides,
  };
}

function claimInput(overrides = {}) {
  return {
    evidence_id: 'e-user',
    lifecycle: {},
    ...overrides,
  };
}

function fakeProjectScope(projectId = 'github.com/example/project') {
  return () => ({
    projectId,
    repoIdentity: projectId,
    canonicalRemote: projectId,
  });
}

function fakeGitContext(branch = 'main') {
  return () => ({
    repoPath: '/repo/project',
    branch,
    revisionSha: 'a'.repeat(40),
  });
}

test('explicit Codex commit stamps current project, branch, id, and time', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-memory-commit-success-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });

  try {
    memory.registerProject({
      projectId: 'github.com/example/project',
      canonicalRemote: 'github.com/example/project',
      repoIdentity: 'github.com/example/project',
    });
    memory.recordEvidence(userEvidence());
  } finally {
    memory.close();
  }

  try {
    const result = await commitCodexMemoryClaim({
      input: claimInput(),
      cwd: '/repo/project',
      env: { AGENT_HUB_MEMORY_DB: dbPath },
      resolveProjectScope: fakeProjectScope(),
      resolveContext: fakeGitContext('main'),
      claimIdFactory: () => 'c-explicit-1',
      clock: () => '2026-09-30T08:05:00.000Z',
    });

    assert.deepEqual(result, {
      project_id: 'github.com/example/project',
      branch: 'main',
      evidence_id: 'e-user',
      claim_id: 'c-explicit-1',
      state: 'active',
    });

    const verify = new MemoryEngine({ dbPath });
    try {
      assert.deepEqual(verify.getClaim('c-explicit-1'), {
        id: 'c-explicit-1',
        project_id: 'github.com/example/project',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value: 'Use Postgres for concurrent writers.',
        state: 'active',
        branch_scope: 'main',
        created_from_evidence_id: 'e-user',
        created_at: '2026-09-30T08:05:00.000Z',
        valid_from: null,
        valid_until: null,
        superseded_by_claim_id: null,
        rejected_by_evidence_id: null,
      });
    } finally {
      verify.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit Codex commit rejects non-user-direct evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-memory-commit-authority-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });

  try {
    memory.registerProject({
      projectId: 'github.com/example/project',
      repoIdentity: 'github.com/example/project',
    });
    memory.recordEvidence(userEvidence({
      authorityClass: 'agent_inference',
    }));
  } finally {
    memory.close();
  }

  try {
    await assert.rejects(
      () => commitCodexMemoryClaim({
        input: claimInput(),
        cwd: '/repo/project',
        env: { AGENT_HUB_MEMORY_DB: dbPath },
        resolveProjectScope: fakeProjectScope(),
        resolveContext: fakeGitContext(),
        claimIdFactory: () => 'c-denied-authority',
        clock: () => '2026-09-30T08:05:00.000Z',
      }),
      /not authorized|denied/i,
    );

    const verify = new MemoryEngine({ dbPath });
    try {
      assert.equal(verify.getClaim('c-denied-authority'), null);
    } finally {
      verify.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit Codex commit cannot use evidence from another project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-memory-commit-project-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });

  try {
    memory.registerProject({
      projectId: 'github.com/example/project',
      repoIdentity: 'github.com/example/project',
    });
    memory.registerProject({
      projectId: 'github.com/example/other',
      repoIdentity: 'github.com/example/other',
    });
    memory.recordEvidence(userEvidence({
      projectId: 'github.com/example/other',
      sourceRef: 'session:other',
    }));
  } finally {
    memory.close();
  }

  try {
    await assert.rejects(
      () => commitCodexMemoryClaim({
        input: claimInput(),
        cwd: '/repo/project',
        env: { AGENT_HUB_MEMORY_DB: dbPath },
        resolveProjectScope: fakeProjectScope('github.com/example/project'),
        resolveContext: fakeGitContext(),
        claimIdFactory: () => 'c-denied-project',
        clock: () => '2026-09-30T08:05:00.000Z',
      }),
      /not authorized|denied/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit Codex commit cannot mutate lifecycle targets from another branch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-memory-commit-branch-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });

  try {
    memory.registerProject({
      projectId: 'github.com/example/project',
      repoIdentity: 'github.com/example/project',
    });
    memory.recordEvidence(userEvidence());
    memory.ingest({
      evidence: userEvidence({
        id: 'e-feature',
        branch: 'feature/other',
        content: 'Feature branch used SQLite.',
      }),
      claim: {
        id: 'c-feature',
        kind: 'decision',
        subject: 'database',
        predicate: 'uses',
        value: 'SQLite',
        branchScope: 'feature/other',
        createdAt: '2026-09-30T07:00:00.000Z',
      },
    });
  } finally {
    memory.close();
  }

  try {
    await assert.rejects(
      () => commitCodexMemoryClaim({
        input: claimInput({
          lifecycle: {
            supersedes: ['c-feature'],
          },
        }),
        cwd: '/repo/project',
        env: { AGENT_HUB_MEMORY_DB: dbPath },
        resolveProjectScope: fakeProjectScope(),
        resolveContext: fakeGitContext('main'),
        claimIdFactory: () => 'c-main-new',
        clock: () => '2026-09-30T08:05:00.000Z',
      }),
      /not authorized|denied/i,
    );

    const verify = new MemoryEngine({ dbPath });
    try {
      assert.equal(verify.getClaim('c-feature').state, 'active');
      assert.equal(verify.getClaim('c-main-new'), null);
    } finally {
      verify.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit Codex commit forbids caller-controlled project, branch, ids, and timestamps', async () => {
  const forbidden = [
    {
      ...claimInput(),
      project_id: 'github.com/example/other',
    },
    {
      ...claimInput(),
      branch_scope: 'feature/other',
    },
    {
      ...claimInput(),
      claim: {
        kind: 'decision',
        subject: 'database',
        predicate: 'uses',
        value: 'A model-rewritten claim must not be accepted.',
      },
    },
    {
      ...claimInput(),
      created_at: '2000-01-01T00:00:00Z',
    },
  ];

  for (const input of forbidden) {
    await assert.rejects(
      () => commitCodexMemoryClaim({
        input,
        cwd: '/repo/project',
        env: { AGENT_HUB_MEMORY_DB: '/unused/memory.sqlite3' },
        resolveProjectScope: fakeProjectScope(),
        resolveContext: fakeGitContext(),
      }),
      /invalid|forbidden/i,
    );
  }
});

test('explicit Codex commit CLI writes through the production protocol in a real Git repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-memory-commit-cli-'));
  const repoDir = join(root, 'repo');
  const dbPath = join(root, 'memory.sqlite3');
  const cliPath = fileURLToPath(
    new URL('../../memory-engine/adapters/codex-memory-commit-cli.mjs', import.meta.url),
  );

  try {
    mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', '-b', 'main', repoDir], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Memory Test']);
    execFileSync('git', [
      '-C',
      repoDir,
      'remote',
      'add',
      'origin',
      'git@github.com:example/project.git',
    ]);
    writeFileSync(join(repoDir, 'README.md'), '# smoke\n');
    execFileSync('git', ['-C', repoDir, 'add', 'README.md']);
    execFileSync('git', ['-C', repoDir, 'commit', '-m', 'smoke'], { stdio: 'ignore' });

    const memory = new MemoryEngine({ dbPath });
    try {
      memory.registerProject({
        projectId: 'github.com/example/project',
        canonicalRemote: 'github.com/example/project',
        repoIdentity: 'github.com/example/project',
      });
      memory.recordEvidence(userEvidence());
    } finally {
      memory.close();
    }

    const result = spawnSync(process.execPath, [cliPath], {
      cwd: repoDir,
      input: JSON.stringify(claimInput()),
      encoding: 'utf8',
      env: {
        ...process.env,
        AGENT_HUB_MEMORY_DB: dbPath,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.result.project_id, 'github.com/example/project');
    assert.equal(output.result.branch, 'main');
    assert.equal(output.result.evidence_id, 'e-user');

    const verify = new MemoryEngine({ dbPath });
    try {
      const claim = verify.getClaim(output.result.claim_id);
      assert.equal(claim.project_id, 'github.com/example/project');
      assert.equal(claim.branch_scope, 'main');
      assert.equal(claim.created_from_evidence_id, 'e-user');
      assert.equal(claim.state, 'active');
    } finally {
      verify.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
