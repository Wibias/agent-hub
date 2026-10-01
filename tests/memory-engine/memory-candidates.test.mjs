import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MemoryEngine,
} from '../../memory-engine/index.mjs';
import {
  CAPTURE_POLICY_VERSION,
  classifyMemoryCandidatePrompt,
  memoryCandidateFingerprint,
} from '../../memory-engine/memory-capture-policy.mjs';
import {
  createCodexMemoryHookAdapter,
  memoryCandidateRef,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import {
  parseCodexHookCliOptions,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';
import {
  createMemoryProtocol,
} from '../../memory-engine/protocol.mjs';

function createProject(memory, projectId = 'project') {
  memory.registerProject({
    projectId,
    repoIdentity: projectId,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
}

function fakeGit(branch = 'main') {
  return {
    async resolveContext() {
      return {
        repoPath: '/repo',
        branch,
        revisionSha: 'a'.repeat(40),
      };
    },
    async refreshFreshness() {},
  };
}

test('deterministic capture policy recognizes durable direct-user signals in English and German', () => {
  const cases = [
    [
      'We decided to use Postgres for concurrent writers.',
      'decision',
    ],
    [
      'Wir verwenden Postgres für mehrere schreibende Prozesse.',
      'decision',
    ],
    [
      'I prefer dark editorial UI over generic SaaS cards.',
      'preference',
    ],
    [
      'Ich bevorzuge fast rechteckige dunkle Flächen.',
      'preference',
    ],
    [
      'We must stay on the GitHub Free tier.',
      'constraint',
    ],
    [
      'Wir müssen bei GitHub Free bleiben.',
      'constraint',
    ],
    [
      'Do not use reconnects when the player role changes.',
      'rejected_approach',
    ],
    [
      'Bei Rollenwechsel keinen Reconnect verwenden.',
      'rejected_approach',
    ],
    [
      'Correction: the production database is Postgres, not SQLite.',
      'correction',
    ],
    [
      'Korrektur: Die Produktionsdatenbank ist Postgres, nicht SQLite.',
      'correction',
    ],
    [
      'Known issue: Host camera crop is still incorrect.',
      'known_issue',
    ],
    [
      'Bekanntes Problem: Der Host-Cam-Crop ist noch falsch.',
      'known_issue',
    ],
  ];

  for (const [prompt, expectedType] of cases) {
    const result = classifyMemoryCandidatePrompt(prompt);
    assert.ok(result, prompt);
    assert.equal(result.type, expectedType, prompt);
    assert.equal(result.value, prompt);
    assert.equal(result.policyVersion, CAPTURE_POLICY_VERSION);
    assert.match(result.decisionReason, /^rule:/);
    assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  }
});

test('capture policy rejects transient, tentative, question, explicit-memory and sensitive prompts', () => {
  const rejected = [
    'go',
    'Fahre fort',
    'Run tests.',
    'Maybe we should use Redis.',
    'Vielleicht sollten wir Redis verwenden.',
    'Should we use Postgres?',
    'Sollen wir Postgres verwenden?',
    'memory: database is Postgres',
    'memory list',
    'memory candidates',
    'My api_key=abcdefghijklmnop should be used for deployment.',
    'Password: supersecretpassword',
  ];

  for (const prompt of rejected) {
    assert.equal(
      classifyMemoryCandidatePrompt(prompt),
      null,
      prompt,
    );
  }
});

test('candidate fingerprint is stable across insignificant whitespace but type-sensitive', () => {
  assert.equal(
    memoryCandidateFingerprint({
      type: 'decision',
      value: 'We use   Postgres.\n',
    }),
    memoryCandidateFingerprint({
      type: 'decision',
      value: ' We use Postgres. ',
    }),
  );

  assert.notEqual(
    memoryCandidateFingerprint({
      type: 'decision',
      value: 'We use Postgres.',
    }),
    memoryCandidateFingerprint({
      type: 'preference',
      value: 'We use Postgres.',
    }),
  );
});

test('candidate ledger derives scope and authority from evidence and deduplicates by project+branch+fingerprint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-candidates-'));
  const memory = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
  });
  createProject(memory);

  const evidence1 = memory.recordEvidence({
    id: 'e-1',
    projectId: 'project',
    harness: 'codex',
    sessionId: 's1',
    sourceKind: 'session',
    sourceRef: 'session:s1',
    capturedAt: '2026-10-01T00:00:00.000Z',
    branch: 'main',
    content: 'We decided to use Postgres.',
    authorityClass: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      candidate_capture: true,
    },
  });

  const fingerprint = memoryCandidateFingerprint({
    type: 'decision',
    value: evidence1.content_redacted,
  });

  const first = memory.recordCandidate({
    id: 'candidate-1',
    evidenceId: evidence1.id,
    type: 'decision',
    proposedValue: evidence1.content_redacted,
    decisionReason: 'rule:decision:definitive',
    policyVersion: CAPTURE_POLICY_VERSION,
    fingerprint,
    createdAt: '2026-10-01T00:00:00.000Z',
  });

  assert.equal(first.project_id, 'project');
  assert.equal(first.branch, 'main');
  assert.equal(first.source_authority, 'user_direct');
  assert.equal(first.status, 'pending');
  assert.equal(first.proposed_type, 'decision');
  assert.equal(first.proposed_value, 'We decided to use Postgres.');
  assert.equal(first.source_evidence_id, 'e-1');

  const evidence2 = memory.recordEvidence({
    id: 'e-2',
    projectId: 'project',
    harness: 'codex',
    sessionId: 's2',
    sourceKind: 'session',
    sourceRef: 'session:s2',
    capturedAt: '2026-10-01T00:01:00.000Z',
    branch: 'main',
    content: 'We decided to use Postgres.',
    authorityClass: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      candidate_capture: true,
    },
  });

  const duplicate = memory.recordCandidate({
    id: 'candidate-2',
    evidenceId: evidence2.id,
    type: 'decision',
    proposedValue: evidence2.content_redacted,
    decisionReason: 'rule:decision:definitive',
    policyVersion: CAPTURE_POLICY_VERSION,
    fingerprint,
    createdAt: '2026-10-01T00:01:00.000Z',
  });

  assert.equal(duplicate.id, first.id);
  assert.equal(memory.listCandidates({
    projectId: 'project',
    branch: 'main',
    status: 'pending',
  }).length, 1);

  assert.equal(
    memory.findCandidateByFingerprint({
      projectId: 'project',
      branch: 'main',
      fingerprint,
    })?.id,
    first.id,
  );

  memory.close();
});

test('candidate ledger rejects non-direct evidence and never enters current recall as a claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-candidate-authority-'));
  const memory = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
  });
  createProject(memory);

  const evidence = memory.recordEvidence({
    id: 'e-agent',
    projectId: 'project',
    harness: 'codex',
    sessionId: 's1',
    sourceKind: 'session',
    sourceRef: 'agent:s1',
    capturedAt: '2026-10-01T00:00:00.000Z',
    branch: 'main',
    content: 'Postgres seems best.',
    authorityClass: 'agent_inference',
    metadata: {},
  });

  assert.throws(
    () => memory.recordCandidate({
      id: 'candidate-agent',
      evidenceId: evidence.id,
      type: 'decision',
      proposedValue: evidence.content_redacted,
      decisionReason: 'rule:decision:definitive',
      policyVersion: CAPTURE_POLICY_VERSION,
      fingerprint: memoryCandidateFingerprint({
        type: 'decision',
        value: evidence.content_redacted,
      }),
      createdAt: '2026-10-01T00:00:00.000Z',
    }),
    /user_direct/i,
  );

  assert.equal(memory.exportCanonical().claims.length, 0);
  memory.close();
});

test('candidate capture stores only selected ordinary prompts as evidence+pending candidates and creates no claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-candidate-hook-'));
  const memory = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
  });
  createProject(memory);
  const protocol = createMemoryProtocol({
    memory,
    classifyAuthority(channel) {
      if (
        channel.sourceKind === 'session'
        && channel.metadata?.event_type === 'user_prompt'
      ) return 'user_direct';
      return 'unclassified';
    },
  });

  const adapter = createCodexMemoryHookAdapter({
    protocol,
    memory,
    projectId: 'project',
    candidateCapture: true,
    explicitMemoryRequests: true,
    clock: () => '2026-10-01T00:00:00.000Z',
    git: fakeGit(),
  });

  await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    turn_id: 't1',
    cwd: '/repo',
    prompt: 'We decided to use Postgres for concurrent writers.',
  });

  const candidates = memory.listCandidates({
    projectId: 'project',
    branch: 'main',
    status: 'pending',
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].proposed_type, 'decision');
  assert.equal(
    candidates[0].proposed_value,
    'We decided to use Postgres for concurrent writers.',
  );
  assert.equal(memory.exportCanonical().claims.length, 0);
  assert.equal(memory.exportCanonical().evidence.length, 1);

  await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    turn_id: 't2',
    cwd: '/repo',
    prompt: 'Fahre fort',
  });

  assert.equal(memory.exportCanonical().evidence.length, 1);
  assert.equal(memory.listCandidates({
    projectId: 'project',
    branch: 'main',
    status: 'pending',
  }).length, 1);

  memory.close();
});

test('duplicate candidate prompt is not captured as duplicate evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-candidate-dedupe-hook-'));
  const memory = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
  });
  createProject(memory);

  const protocol = createMemoryProtocol({
    memory,
    classifyAuthority() {
      return 'user_direct';
    },
  });

  const adapter = createCodexMemoryHookAdapter({
    protocol,
    memory,
    projectId: 'project',
    candidateCapture: true,
    clock: () => '2026-10-01T00:00:00.000Z',
    git: fakeGit(),
  });

  for (const [turn, prompt] of [
    ['t1', 'We decided to use Postgres.'],
    ['t2', '  We decided to use   Postgres.  '],
  ]) {
    await adapter.handle({
      hook_event_name: 'UserPromptSubmit',
      session_id: 's1',
      turn_id: turn,
      cwd: '/repo',
      prompt,
    });
  }

  assert.equal(memory.exportCanonical().evidence.length, 1);
  assert.equal(memory.listCandidates({
    projectId: 'project',
    branch: 'main',
    status: 'pending',
  }).length, 1);

  memory.close();
});

test('memory candidates is a read-only terminal management command', async () => {
  assert.deepEqual(
    parseExplicitMemoryPrompt('memory candidates'),
    { mode: 'candidates' },
  );

  const root = await mkdtemp(join(tmpdir(), 'agent-hub-candidate-list-'));
  const memory = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
  });
  createProject(memory);

  const evidence = memory.recordEvidence({
    id: 'e-1',
    projectId: 'project',
    harness: 'codex',
    sessionId: 's1',
    sourceKind: 'session',
    sourceRef: 'session:s1',
    capturedAt: '2026-10-01T00:00:00.000Z',
    branch: 'main',
    content: 'We must stay on GitHub Free.',
    authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt' },
  });
  const fingerprint = memoryCandidateFingerprint({
    type: 'constraint',
    value: evidence.content_redacted,
  });
  const candidate = memory.recordCandidate({
    id: 'candidate-1',
    evidenceId: evidence.id,
    type: 'constraint',
    proposedValue: evidence.content_redacted,
    decisionReason: 'rule:constraint:must',
    policyVersion: CAPTURE_POLICY_VERSION,
    fingerprint,
    createdAt: '2026-10-01T00:00:00.000Z',
  });

  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('management command must not hit protocol');
      },
    },
    memory,
    projectId: 'project',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  const result = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    turn_id: 't2',
    cwd: '/repo',
    prompt: 'memory candidates',
  });

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /Pending memory candidates/);
  assert.match(result.reason, new RegExp(memoryCandidateRef(candidate.id)));
  assert.match(result.reason, /constraint/);
  assert.match(result.reason, /We must stay on GitHub Free/);

  assert.equal(memory.exportCanonical().evidence.length, 1);
  assert.equal(memory.exportCanonical().claims.length, 0);
  memory.close();
});

test('candidate capture is explicit CLI opt-in', () => {
  assert.deepEqual(
    parseCodexHookCliOptions([
      '--ignore-memory-env',
      '--explicit-memory-requests',
      '--hybrid-recall',
      '--candidate-capture',
    ]),
    {
      ignoreMemoryEnv: true,
      explicitMemoryRequests: true,
      hybridRecall: true,
      candidateCapture: true,
    },
  );

  assert.equal(
    parseCodexHookCliOptions([]).candidateCapture,
    undefined,
  );
});
