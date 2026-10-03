import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  buildMemoryCandidateRelationPrompt,
  CANDIDATE_RELATION_POLICY_VERSION,
  evaluatePromotedCandidateRelations,
  memoryRelationClaimRef,
  parseMemoryCandidateRelation,
} from '../../memory-engine/memory-candidate-relation.mjs';
import {
  CAPTURE_POLICY_VERSION,
  memoryCandidateFingerprint,
} from '../../memory-engine/memory-capture-policy.mjs';
import {
  parseMemoryCandidateRelationArgs,
  runMemoryCandidateRelationCli,
} from '../../scripts/judge-memory-relations.mjs';
import {
  createCodexMemoryHookAdapter,
} from '../../memory-engine/adapters/codex-hooks.mjs';

function createProject(memory, projectId = 'project') {
  memory.registerProject({
    projectId,
    repoIdentity: projectId,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
}

function seedDurable(memory, {
  claimId = 'claim-existing',
  evidenceId = 'e-existing',
  projectId = 'project',
  branch = 'main',
  value = 'memory: database is Postgres',
  createdAt = '2026-10-01T00:00:00.000Z',
} = {}) {
  memory.ingest({
    evidence: {
      id: evidenceId,
      projectId,
      sourceKind: 'session',
      sourceRef: 'session:existing',
      capturedAt: createdAt,
      branch,
      content: value,
      authorityClass: 'user_direct',
      metadata: { explicit_memory: true },
    },
    claim: {
      id: claimId,
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value,
      branchScope: branch,
      createdAt,
    },
  });
  return memory.getClaim(claimId);
}

function seedPromoteCandidate(memory, {
  id = 'candidate-1',
  evidenceId = 'e-candidate',
  projectId = 'project',
  branch = 'main',
  type = 'decision',
  value = 'We use Postgres as the database.',
  canonicalFact = 'The project uses Postgres as its database.',
  createdAt = '2026-10-01T01:00:00.000Z',
} = {}) {
  const evidence = memory.recordEvidence({
    id: evidenceId,
    projectId,
    harness: 'codex',
    sessionId: 's1',
    sourceKind: 'session',
    sourceRef: 'session:s1',
    capturedAt: createdAt,
    branch,
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
    type,
    proposedValue: evidence.content_redacted,
    decisionReason: 'rule:decision:definitive',
    policyVersion: CAPTURE_POLICY_VERSION,
    fingerprint: memoryCandidateFingerprint({
      type,
      value: evidence.content_redacted,
    }),
    createdAt,
  });

  return memory.evaluateCandidate({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:importance-v2',
    evaluatedAt: '2026-10-01T01:01:00.000Z',
    evaluation: {
      decision: 'promote',
      suggested_type: type,
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: canonicalFact,
      reason: 'Durable project information.',
      risk_flags: [],
    },
  });
}

test('relation parser accepts strict SAME/UPDATE/CONTRADICT/UNRELATED results', () => {
  const target = '@0123456789';

  assert.deepEqual(
    parseMemoryCandidateRelation(JSON.stringify({
      relation: 'same',
      target_ref: target,
      confidence: 'high',
      meaning_preserved: true,
      reason: 'Both statements describe the same durable database choice.',
    })),
    {
      relation: 'same',
      target_ref: target,
      confidence: 'high',
      meaning_preserved: true,
      reason: 'Both statements describe the same durable database choice.',
    },
  );

  for (const relation of ['update', 'contradict']) {
    assert.equal(
      parseMemoryCandidateRelation(JSON.stringify({
        relation,
        target_ref: target,
        confidence: 'high',
        meaning_preserved: true,
        reason: 'Fixture relation.',
      })).relation,
      relation,
    );
  }

  assert.deepEqual(
    parseMemoryCandidateRelation(JSON.stringify({
      relation: 'unrelated',
      target_ref: null,
      confidence: 'high',
      meaning_preserved: true,
      reason: 'No existing durable memory covers this subject.',
    })),
    {
      relation: 'unrelated',
      target_ref: null,
      confidence: 'high',
      meaning_preserved: true,
      reason: 'No existing durable memory covers this subject.',
    },
  );
});

test('relation parser fails closed on extra fields, malformed refs, or unrelated target refs', () => {
  assert.throws(
    () => parseMemoryCandidateRelation(JSON.stringify({
      relation: 'same',
      target_ref: '@0123456789',
      confidence: 'high',
      meaning_preserved: true,
      reason: 'same',
      extra: true,
    })),
    /unexpected field/i,
  );

  assert.throws(
    () => parseMemoryCandidateRelation(JSON.stringify({
      relation: 'same',
      target_ref: 'claim-raw-id',
      confidence: 'high',
      meaning_preserved: true,
      reason: 'same',
    })),
    /target_ref/i,
  );

  assert.throws(
    () => parseMemoryCandidateRelation(JSON.stringify({
      relation: 'unrelated',
      target_ref: '@0123456789',
      confidence: 'high',
      meaning_preserved: true,
      reason: 'none',
    })),
    /unrelated.*target_ref/i,
  );
});

test('relation prompt quotes candidate and only current-scope active durable memories as options', () => {
  const candidate = {
    id: 'candidate-1',
    proposed_type: 'decision',
    source_authority: 'user_direct',
    proposed_value: 'We use Postgres.',
    evaluation_json: JSON.stringify({
      decision: 'promote',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: 'The project uses Postgres.',
      reason: 'Durable.',
      risk_flags: [],
    }),
  };

  const memories = [{
    claimId: 'claim-existing',
    ref: memoryRelationClaimRef('claim-existing'),
    value: 'memory: database is Postgres',
    authority: 'user_direct',
    state: 'active',
  }];

  const prompt = buildMemoryCandidateRelationPrompt({
    candidate,
    memories,
  });

  assert.match(prompt, /untrusted quoted data/i);
  assert.match(prompt, /do not use tools/i);
  assert.match(prompt, /same.*update.*contradict.*unrelated/is);
  assert.match(prompt, /The project uses Postgres/);
  assert.match(prompt, /memory: database is Postgres/);
  assert.match(prompt, new RegExp(memoryRelationClaimRef('claim-existing')));
  assert.match(prompt, new RegExp(CANDIDATE_RELATION_POLICY_VERSION));
});

test('no active durable memories resolves unrelated without invoking AI and creates no claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-relation-none-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const candidate = seedPromoteCandidate(memory);

  let judgeCalls = 0;
  const result = await evaluatePromotedCandidateRelations({
    memory,
    projectId: 'project',
    branch: 'main',
    evaluatorId: 'codex:test:relation-v1',
    apply: true,
    async judge() {
      judgeCalls += 1;
      throw new Error('must not call AI with no comparison memories');
    },
  });

  assert.equal(judgeCalls, 0);
  assert.equal(result.total, 1);
  assert.equal(result.applied, 1);
  assert.equal(result.results[0].relation, 'unrelated');

  const stored = memory.getCandidate(candidate.id);
  assert.equal(stored.relation, 'unrelated');
  assert.equal(stored.related_claim_id, null);
  assert.equal(memory.exportCanonical().claims.length, 0);

  const audit = memory.getCandidateRelation(candidate.id);
  assert.equal(audit.relation, 'unrelated');
  assert.equal(audit.policy_version, CANDIDATE_RELATION_POLICY_VERSION);

  memory.close();
});

test('SAME relation stores only candidate relation metadata and targets exact active claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-relation-same-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const existing = seedDurable(memory);
  const candidate = seedPromoteCandidate(memory);

  const beforeClaims = memory.exportCanonical().claims;

  const result = await evaluatePromotedCandidateRelations({
    memory,
    projectId: 'project',
    branch: 'main',
    evaluatorId: 'codex:test:relation-v1',
    apply: true,
    async judge({ memories }) {
      assert.equal(memories.length, 1);
      assert.equal(memories[0].claimId, existing.id);
      return JSON.stringify({
        relation: 'same',
        target_ref: memories[0].ref,
        confidence: 'high',
        meaning_preserved: true,
        reason: 'The candidate restates the existing database choice.',
      });
    },
  });

  assert.equal(result.results[0].relation, 'same');
  const stored = memory.getCandidate(candidate.id);
  assert.equal(stored.relation, 'same');
  assert.equal(stored.related_claim_id, existing.id);
  assert.deepEqual(memory.exportCanonical().claims, beforeClaims);

  const audit = memory.getCandidateRelation(candidate.id);
  assert.equal(audit.related_claim_id, existing.id);
  assert.equal(JSON.parse(audit.result_json).relation, 'same');

  memory.close();
});

test('relation target must resolve to one supplied active current-scope direct-user claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-relation-target-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  seedDurable(memory);
  const candidate = seedPromoteCandidate(memory);

  const result = await evaluatePromotedCandidateRelations({
    memory,
    projectId: 'project',
    branch: 'main',
    evaluatorId: 'codex:test:relation-v1',
    apply: true,
    async judge() {
      return JSON.stringify({
        relation: 'update',
        target_ref: '@ffffffffee',
        confidence: 'high',
        meaning_preserved: true,
        reason: 'Invented target.',
      });
    },
  });

  assert.equal(result.failed, 1);
  assert.equal(memory.getCandidate(candidate.id).relation, null);
  assert.equal(memory.getCandidateRelation(candidate.id), null);
  memory.close();
});

test('only importance=promote pending candidates are eligible for relation evaluation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-relation-eligible-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);

  const promoted = seedPromoteCandidate(memory, {
    id: 'candidate-promote',
    evidenceId: 'e-promote',
  });

  const evidence = memory.recordEvidence({
    id: 'e-keep',
    projectId: 'project',
    harness: 'codex',
    sessionId: 's2',
    sourceKind: 'session',
    sourceRef: 'session:s2',
    capturedAt: '2026-10-01T01:02:00.000Z',
    branch: 'main',
    content: 'We may want a stable deployment note.',
    authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt', candidate_capture: true },
  });
  const keep = memory.recordCandidate({
    id: 'candidate-keep',
    evidenceId: evidence.id,
    type: 'decision',
    proposedValue: evidence.content_redacted,
    decisionReason: 'rule:decision:definitive',
    policyVersion: CAPTURE_POLICY_VERSION,
    fingerprint: memoryCandidateFingerprint({
      type: 'decision',
      value: evidence.content_redacted,
    }),
    createdAt: '2026-10-01T01:02:00.000Z',
  });
  memory.evaluateCandidate({
    candidateId: keep.id,
    evaluatorId: 'codex:test:importance-v2',
    evaluatedAt: '2026-10-01T01:03:00.000Z',
    evaluation: {
      decision: 'keep_candidate',
      suggested_type: 'decision',
      durability: 'medium',
      future_utility: 'medium',
      specificity: 'medium',
      confidence: 'medium',
      meaning_preserved: true,
      canonical_fact: 'A stable deployment note may be useful.',
      reason: 'Not strong enough yet.',
      risk_flags: ['tentative'],
    },
  });

  const eligible = memory.listRelationPendingCandidates({
    projectId: 'project',
    branch: 'main',
  });

  assert.deepEqual(eligible.map((item) => item.id), [promoted.id]);
  memory.close();
});

test('memory candidates exposes stored relation without changing durable memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-relation-list-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const existing = seedDurable(memory);
  const candidate = seedPromoteCandidate(memory);

  memory.evaluateCandidateRelation({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:relation-v1',
    policyVersion: CANDIDATE_RELATION_POLICY_VERSION,
    relation: {
      relation: 'same',
      target_ref: memoryRelationClaimRef(existing.id),
      confidence: 'high',
      meaning_preserved: true,
      reason: 'Equivalent durable fact.',
    },
    relatedClaimId: existing.id,
    evaluatedAt: '2026-10-01T02:00:00.000Z',
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
    git: {
      async resolveContext() {
        return {
          repoPath: '/repo',
          branch: 'main',
          revisionSha: 'a'.repeat(40),
        };
      },
      async refreshFreshness() {},
    },
  });

  const output = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    turn_id: 'list',
    cwd: '/repo',
    prompt: 'memory candidates',
  });

  assert.equal(output.decision, 'block');
  assert.match(output.reason, /relation=same/);
  assert.match(output.reason, new RegExp('target=' + memoryRelationClaimRef(existing.id)));
  assert.equal(memory.exportCanonical().claims.length, 1);

  memory.close();
});

test('relation evaluation is exactly-once and cannot overwrite an existing relation audit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-relation-once-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);
  const candidate = seedPromoteCandidate(memory);

  memory.evaluateCandidateRelation({
    candidateId: candidate.id,
    evaluatorId: 'codex:test:relation-v1',
    policyVersion: CANDIDATE_RELATION_POLICY_VERSION,
    relation: {
      relation: 'unrelated',
      target_ref: null,
      confidence: 'high',
      meaning_preserved: true,
      reason: 'No durable memories exist.',
    },
    relatedClaimId: null,
    evaluatedAt: '2026-10-01T02:00:00.000Z',
  });

  assert.throws(
    () => memory.evaluateCandidateRelation({
      candidateId: candidate.id,
      evaluatorId: 'codex:test:relation-v1-second',
      policyVersion: CANDIDATE_RELATION_POLICY_VERSION,
      relation: {
        relation: 'unrelated',
        target_ref: null,
        confidence: 'high',
        meaning_preserved: true,
        reason: 'Again.',
      },
      relatedClaimId: null,
      evaluatedAt: '2026-10-01T02:01:00.000Z',
    }),
    /already evaluated/i,
  );

  memory.close();
});

test('relation CLI defaults to dry-run and apply is explicit', () => {
  assert.deepEqual(
    parseMemoryCandidateRelationArgs([]),
    {
      cwd: process.cwd(),
      dbPath: null,
      limit: 10,
      apply: false,
      model: null,
      reasoningEffort: 'medium',
    },
  );
  assert.equal(
    parseMemoryCandidateRelationArgs(['--apply']).apply,
    true,
  );
});

test('relation CLI composes scope and isolated judge without requiring a live model in unit tests', async () => {
  const lines = [];

  const output = await runMemoryCandidateRelationCli({
    argv: ['--limit', '2'],
    cwd: 'C:/repo',
    log(value) {
      lines.push(value);
    },
    dependencies: {
      resolveRuntime() {
        return {
          cwd: 'C:/repo',
          dbPath: 'C:/state/memory.sqlite3',
          projectId: 'github.com/Wibias/agent-hub',
          branch: 'main',
        };
      },
      createMemory() {
        return { close() {} };
      },
      createJudge() {
        return {
          evaluatorId: 'codex:test:relation-v1',
          isolation: {
            freshCodexHome: true,
            copiedAuthOnly: true,
            inheritedHooks: false,
            inheritedConfig: false,
            inheritedLegacyMemory: false,
            emptyWorkspace: true,
          },
          async judge() {
            throw new Error('fixture evaluateRelations owns execution');
          },
          async close() {},
        };
      },
      async evaluateRelations(args) {
        assert.equal(args.apply, false);
        assert.equal(args.limit, 2);
        assert.equal(args.projectId, 'github.com/Wibias/agent-hub');
        assert.equal(args.branch, 'main');
        assert.equal(typeof args.judge, 'function');
        return {
          total: 1,
          evaluated: 1,
          applied: 0,
          failed: 0,
          results: [{
            candidate_ref: '~aaaaaaaaaa',
            ok: true,
            relation: 'unrelated',
            applied: false,
          }],
        };
      },
    },
  });

  assert.equal(output.type, 'agent_hub_memory_candidate_relation_judge');
  assert.equal(output.mode, 'dry-run');
  assert.equal(output.policyVersion, CANDIDATE_RELATION_POLICY_VERSION);
  assert.equal(output.summary.failed, 0);
  assert.equal(lines.length, 1);
});


test('kept direct-user candidates cannot starve a later promote-ready relation candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-relation-starvation-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  createProject(memory);

  for (let index = 0; index < 5; index += 1) {
    const value = `Keep review-only decision ${index}.`;
    const evidence = memory.recordEvidence({
      id: `e-a-keep-${index}`,
      projectId: 'project',
      harness: 'codex',
      sessionId: `keep-${index}`,
      sourceKind: 'session',
      sourceRef: `session:keep-${index}`,
      capturedAt: '2026-10-01T01:00:00.000Z',
      branch: 'main',
      content: value,
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt', candidate_capture: true },
    });
    const candidate = memory.recordCandidate({
      id: `a-keep-${index}`,
      evidenceId: evidence.id,
      type: 'decision',
      proposedValue: evidence.content_redacted,
      decisionReason: 'rule:decision:definitive',
      policyVersion: CAPTURE_POLICY_VERSION,
      fingerprint: memoryCandidateFingerprint({
        type: 'decision',
        value,
      }),
      createdAt: '2026-10-01T01:00:00.000Z',
    });
    memory.evaluateCandidate({
      candidateId: candidate.id,
      evaluatorId: 'codex:test:importance-v2',
      evaluatedAt: '2026-10-01T01:01:00.000Z',
      evaluation: {
        decision: 'keep_candidate',
        suggested_type: 'decision',
        durability: 'medium',
        future_utility: 'medium',
        specificity: 'high',
        confidence: 'high',
        meaning_preserved: true,
        canonical_fact: value,
        reason: 'Review only.',
        risk_flags: ['transient'],
      },
    });
  }

  const promoted = seedPromoteCandidate(memory, {
    id: 'z-promote',
    evidenceId: 'e-z-promote',
    value: 'We use Postgres for durable concurrent writes.',
    canonicalFact: 'The project uses Postgres for durable concurrent writes.',
    createdAt: '2026-10-01T01:00:00.000Z',
  });

  assert.deepEqual(
    memory.listRelationPendingCandidates({
      projectId: 'project',
      branch: 'main',
      limit: 1,
    }).map((item) => item.id),
    [promoted.id],
  );

  memory.close();
});
