import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine, evaluateReliance } from '../../memory-engine/index.mjs';

import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  resolveEvidenceBoundPromotion,
  runEvidenceBoundPromotionPipeline,
} from '../../memory-engine/evidence-bound-promotion.mjs';
import {
  EVIDENCE_EXTRACTION_POLICY_VERSION,
  evidenceExtractionFingerprint,
} from '../../memory-engine/evidence-bound-extraction.mjs';
import { EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION } from '../../memory-engine/evidence-bound-proposal-judge.mjs';
import { EVIDENCE_SUPPORT_POLICY_VERSION } from '../../memory-engine/evidence-bound-support-judge.mjs';
import {
  EVIDENCE_RELATION_POLICY_VERSION,
  evidenceRelationClaimRef,
} from '../../memory-engine/evidence-bound-relation-judge.mjs';

function safeSensitivity() { return { containsSecret: false }; }

async function seed({ toolOutcome = 'success' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'r10c-multi-evidence-promotion-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project_registry(project_id),
      branch TEXT,
      sensitivity TEXT NOT NULL,
      authority_class TEXT NOT NULL,
      content_redacted TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare('INSERT INTO project_registry VALUES (?)').run('project-a');
  const insert = db.prepare(`INSERT INTO evidence (
    id, project_id, branch, sensitivity, authority_class, content_redacted
  ) VALUES (?, ?, ?, ?, ?, ?)`);
  insert.run('e-user', 'project-a', 'main', 'normal', 'user_direct', 'Use Postgres for concurrent writers.');
  insert.run('e-tool', 'project-a', 'main', 'normal', 'tool_observation', 'Postgres accepted concurrent writes.');
  db.close();

  const store = new EvidenceBoundProposalStore({ dbPath, inspectTextSensitivity: safeSensitivity });
  const canonicalFact = 'Postgres is used for concurrent writers.';
  store.record({
    id: 'proposal-multi', projectId: 'project-a', branch: 'main', kind: 'knowledge', canonicalFact,
    evidenceIds: ['e-user', 'e-tool'],
    fingerprint: evidenceExtractionFingerprint({ kind: 'knowledge', canonicalFact }),
    policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
    evaluatorId: 'extractor:test', createdAt: '2026-10-11T12:00:00.000Z',
  });
  store.evaluateImportance({
    proposalId: 'proposal-multi', evaluatorId: 'importance:test',
    policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
    judgment: {
      decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
      meaning_preserved: true, reason: 'Durable.', risk_flags: [],
    }, evaluatedAt: '2026-10-11T12:01:00.000Z',
  });
  store.evaluateSupport({
    proposalId: 'proposal-multi', evaluatorId: 'support:test',
    policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
    judgment: {
      decision: 'supported', confidence: 'high', meaning_preserved: true,
      reason: 'Both sources support the fact.', risk_flags: [],
    }, evaluatedAt: '2026-10-11T12:02:00.000Z',
  });
  store.close();

  const evidence = new Map([
    ['e-user', {
      id: 'e-user', project_id: 'project-a', branch: 'main', sensitivity: 'normal',
      authority_class: 'user_direct', content_redacted: 'Use Postgres for concurrent writers.',
      metadata: {}, path: null,
    }],
    ['e-tool', {
      id: 'e-tool', project_id: 'project-a', branch: 'main', sensitivity: 'normal',
      authority_class: 'tool_observation', content_redacted: 'Postgres accepted concurrent writes.',
      metadata: { tool_outcome: toolOutcome }, path: null,
    }],
  ]);
  const claims = new Map();
  const provenance = new Map();
  const assertCalls = [];
  const memory = {
    getEvidence(id) { return evidence.get(id) ?? null; },
    getClaim(id) { return claims.get(id) ?? null; },
    getClaimEvidence(id) { return provenance.get(id) ?? []; },
    assertClaim({ evidenceId, evidenceIds, claim, lifecycle }) {
      assertCalls.push({ evidenceId, evidenceIds: [...evidenceIds], claim, lifecycle });
      const stored = {
        id: claim.id, project_id: 'project-a', branch_scope: claim.branchScope,
        kind: claim.kind, subject: claim.subject, predicate: claim.predicate,
        value: claim.value, state: claim.state, created_from_evidence_id: evidenceId,
        created_at: claim.createdAt,
      };
      claims.set(stored.id, stored);
      provenance.set(stored.id, evidenceIds.map((id) => ({
        evidence: evidence.get(id), role: id === evidenceId ? 'primary' : 'supporting',
        linked_at: claim.createdAt,
      })).sort((a, b) => (a.role === b.role ? a.evidence.id.localeCompare(b.evidence.id) : a.role === 'primary' ? -1 : 1)));
      return { evidence: evidence.get(evidenceId), claim: stored };
    },
  };
  return { dbPath, memory, assertCalls };
}

async function relateUnrelated(dbPath) {
  const store = new EvidenceBoundProposalStore({ dbPath, inspectTextSensitivity: safeSensitivity });
  try {
    const pending = store.listRelationPending({ projectId: 'project-a', branch: 'main' });
    assert.deepEqual(pending.map((item) => item.id), ['proposal-multi']);
    store.evaluateRelation({
      proposalId: 'proposal-multi', evaluatorId: 'relation:test',
      policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
      relation: {
        relation: 'unrelated', target_ref: null, confidence: 'high',
        meaning_preserved: true, reason: 'No comparable claim.',
      }, relatedClaimId: null, evaluatedAt: '2026-10-11T12:03:00.000Z',
    });
  } finally { store.close(); }
}

test('multi-evidence proposal becomes relation-ready and promotion-ready', async () => {
  const { dbPath } = await seed();
  await relateUnrelated(dbPath);
  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try {
    assert.deepEqual(
      store.listPromotionReady({ projectId: 'project-a', branch: 'main' }).map((item) => item.id),
      ['proposal-multi'],
    );
  } finally { store.close(); }
});

test('multi-evidence unrelated promotion selects least-privileged primary and asserts complete provenance', async () => {
  const { dbPath, memory, assertCalls } = await seed();
  await relateUnrelated(dbPath);
  const result = await runEvidenceBoundPromotionPipeline({
    dbPath, memory, projectId: 'project-a', branch: 'main',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:04:00.000Z',
  });
  assert.equal(result.promoted, 1);
  assert.equal(assertCalls.length, 1);
  assert.equal(assertCalls[0].evidenceId, 'e-tool');
  assert.deepEqual(assertCalls[0].evidenceIds, ['e-tool', 'e-user']);
  assert.equal(assertCalls[0].claim.kind, 'knowledge');
  assert.equal(assertCalls[0].claim.subject, 'evidence memory');
});

test('unknown tool observation in a multi-evidence proposal requires confirmation even with user evidence', async () => {
  const { dbPath, memory, assertCalls } = await seed({ toolOutcome: 'unknown' });
  await relateUnrelated(dbPath);
  const result = await runEvidenceBoundPromotionPipeline({
    dbPath, memory, projectId: 'project-a', branch: 'main',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:04:00.000Z',
  });
  assert.equal(result.promoted, 0);
  assert.equal(result.needs_confirmation, 1);
  assert.equal(assertCalls.length, 0);
});

test('failed tool observation in a multi-evidence proposal fails closed and remains pending', async () => {
  const { dbPath, memory, assertCalls } = await seed({ toolOutcome: 'failure' });
  await relateUnrelated(dbPath);
  const result = await runEvidenceBoundPromotionPipeline({
    dbPath, memory, projectId: 'project-a', branch: 'main',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:04:00.000Z',
  });
  assert.equal(result.promoted, 0);
  assert.equal(result.failed, 1);
  assert.equal(assertCalls.length, 0);
  const store = new EvidenceBoundProposalStore({ dbPath, readOnly: true, inspectTextSensitivity: safeSensitivity });
  try { assert.equal(store.get('proposal-multi').status, 'pending'); }
  finally { store.close(); }
});



function resolverProposal(overrides = {}) {
  return {
    id: 'proposal-resolver',
    project_id: 'project-a',
    branch: 'main',
    kind: 'knowledge',
    canonical_fact: 'Durable fact.',
    status: 'pending',
    fingerprint: 'f'.repeat(64),
    evidence_ids: ['e-a', 'e-b'],
    authorities: ['repo_trusted', 'user_direct'],
    importance: { decision: 'promote' },
    support: { decision: 'supported' },
    relation: {
      relation: 'unrelated', target_ref: null, confidence: 'high',
      meaning_preserved: true, reason: 'No related claim.',
    },
    related_claim_id: null,
    ...overrides,
  };
}

function resolverEvidence(id, authority, overrides = {}) {
  return {
    id,
    project_id: 'project-a',
    branch: 'main',
    sensitivity: 'normal',
    authority_class: authority,
    content_redacted: 'Durable evidence.',
    metadata: {},
    path: null,
    ...overrides,
  };
}

test('primary selection is deterministic across input order and ties repo/user by evidence id', () => {
  const proposal = resolverProposal({
    evidence_ids: ['e-z-user', 'e-a-repo'],
    authorities: ['user_direct', 'repo_trusted'],
  });
  const user = resolverEvidence('e-z-user', 'user_direct');
  const repo = resolverEvidence('e-a-repo', 'repo_trusted');

  const first = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidenceSet: [user, repo],
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });
  const second = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidenceSet: [repo, user],
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });

  assert.equal(first.status, 'promoted');
  assert.equal(first.primary_evidence_id, 'e-a-repo');
  assert.deepEqual(first.evidence_ids, ['e-a-repo', 'e-z-user']);
  assert.equal(second.primary_evidence_id, first.primary_evidence_id);
  assert.deepEqual(second.evidence_ids, first.evidence_ids);
});

test('multi-evidence same never mutates target provenance and mixed authority requires confirmation', () => {
  const targetClaim = {
    id: 'c-existing', project_id: 'project-a', branch_scope: 'main', state: 'active',
    kind: 'knowledge', subject: 'evidence memory', predicate: 'states', value: 'Durable fact.',
    created_from_evidence_id: 'e-target-user',
  };
  const targetEvidenceSet = [{
    evidence: resolverEvidence('e-target-user', 'user_direct'),
    role: 'primary', linked_at: '2026-10-11T11:00:00.000Z',
  }];
  const proposal = resolverProposal({
    evidence_ids: ['e-source-user', 'e-source-tool'],
    authorities: ['user_direct', 'tool_observation'],
    relation: {
      relation: 'same', target_ref: evidenceRelationClaimRef('c-existing'),
      confidence: 'high', meaning_preserved: true, reason: 'Same proposition.',
    },
    related_claim_id: 'c-existing',
  });
  const sourceEvidenceSet = [
    resolverEvidence('e-source-user', 'user_direct'),
    resolverEvidence('e-source-tool', 'tool_observation', {
      metadata: { tool_outcome: 'success' },
    }),
  ];

  const resolved = resolveEvidenceBoundPromotion({
    proposal,
    sourceEvidenceSet,
    targetClaim,
    targetEvidenceSet,
    finalizedAt: '2026-10-11T12:04:00.000Z',
  });

  assert.equal(resolved.status, 'needs_confirmation');
  assert.equal(resolved.claim, null);
  assert.equal(resolved.lifecycle, null);
  assert.deepEqual(targetEvidenceSet.map((row) => row.evidence.id), ['e-target-user']);
});

test('multi-evidence update and contradict remain confirmation-only', () => {
  for (const relation of ['update', 'contradict']) {
    const targetClaim = {
      id: 'c-existing', project_id: 'project-a', branch_scope: 'main', state: 'active',
      kind: 'knowledge', subject: 'evidence memory', predicate: 'states', value: 'Old fact.',
      created_from_evidence_id: 'e-target',
    };
    const targetEvidenceSet = [{
      evidence: resolverEvidence('e-target', 'repo_trusted'),
      role: 'primary', linked_at: '2026-10-11T11:00:00.000Z',
    }];
    const proposal = resolverProposal({
      evidence_ids: ['e-user', 'e-repo'],
      authorities: ['user_direct', 'repo_trusted'],
      relation: {
        relation, target_ref: evidenceRelationClaimRef('c-existing'),
        confidence: 'high', meaning_preserved: true, reason: relation,
      },
      related_claim_id: 'c-existing',
    });
    const resolved = resolveEvidenceBoundPromotion({
      proposal,
      sourceEvidenceSet: [
        resolverEvidence('e-user', 'user_direct'),
        resolverEvidence('e-repo', 'repo_trusted'),
      ],
      targetClaim,
      targetEvidenceSet,
      finalizedAt: '2026-10-11T12:04:00.000Z',
    });
    assert.equal(resolved.status, 'needs_confirmation');
    assert.equal(resolved.claim, null);
    assert.equal(resolved.lifecycle, null);
  }
});

test('multi-evidence promotion retry is idempotent after terminal proposal audit', async () => {
  const { dbPath, memory, assertCalls } = await seed();
  await relateUnrelated(dbPath);
  const args = {
    dbPath, memory, projectId: 'project-a', branch: 'main',
    inspectTextSensitivity: safeSensitivity,
    clock: () => '2026-10-11T12:04:00.000Z',
  };
  const first = await runEvidenceBoundPromotionPipeline(args);
  const second = await runEvidenceBoundPromotionPipeline(args);
  assert.equal(first.promoted, 1);
  assert.equal(second.total, 0);
  assert.equal(second.promoted, 0);
  assert.equal(assertCalls.length, 1);
});

test('multi-evidence source set fails closed on missing, cross-scope, secret or ineligible evidence', () => {
  const proposal = resolverProposal();
  const goodA = resolverEvidence('e-a', 'repo_trusted');
  const goodB = resolverEvidence('e-b', 'user_direct');
  const cases = [
    [goodA, null],
    [goodA, { ...goodB, project_id: 'project-b' }],
    [goodA, { ...goodB, branch: 'feature' }],
    [goodA, { ...goodB, sensitivity: 'secret_redacted' }],
    [goodA, { ...goodB, authority_class: 'external_untrusted' }],
  ];
  for (const sourceEvidenceSet of cases) {
    assert.throws(() => resolveEvidenceBoundPromotion({
      proposal,
      sourceEvidenceSet,
      finalizedAt: '2026-10-11T12:04:00.000Z',
    }), /source evidence|source authority|invariant/i);
  }
});


test('real MemoryEngine promotion persists complete provenance and recall enforces full authority set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'r10c-real-memory-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath, clock: () => '2026-10-11T12:04:00.000Z' });
  try {
    memory.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
    memory.recordEvidence({
      id: 'e-user-real', projectId: 'project-a', sourceKind: 'session',
      sourceRef: 'session:S1', capturedAt: '2026-10-11T12:00:00.000Z', branch: 'main',
      content: 'Use Postgres for concurrent writers.', authorityClass: 'user_direct', metadata: {},
    });
    memory.recordEvidence({
      id: 'e-tool-real', projectId: 'project-a', sourceKind: 'tool',
      sourceRef: 'tool:Bash:1', capturedAt: '2026-10-11T12:00:30.000Z', branch: 'main',
      content: 'Postgres accepted concurrent writes.', authorityClass: 'tool_observation',
      metadata: { tool_outcome: 'success' },
    });

    const canonicalFact = 'Postgres is used for concurrent writers.';
    const store = new EvidenceBoundProposalStore({ dbPath, inspectTextSensitivity: safeSensitivity });
    try {
      store.record({
        id: 'proposal-real', projectId: 'project-a', branch: 'main', kind: 'knowledge', canonicalFact,
        evidenceIds: ['e-user-real', 'e-tool-real'],
        fingerprint: evidenceExtractionFingerprint({ kind: 'knowledge', canonicalFact }),
        policyVersion: EVIDENCE_EXTRACTION_POLICY_VERSION,
        evaluatorId: 'extractor:test', createdAt: '2026-10-11T12:01:00.000Z',
      });
      store.evaluateImportance({
        proposalId: 'proposal-real', evaluatorId: 'importance:test',
        policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
        judgment: {
          decision: 'promote', durability: 'long', future_utility: 'high', confidence: 'high',
          meaning_preserved: true, reason: 'Durable.', risk_flags: [],
        }, evaluatedAt: '2026-10-11T12:02:00.000Z',
      });
      store.evaluateSupport({
        proposalId: 'proposal-real', evaluatorId: 'support:test',
        policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
        judgment: {
          decision: 'supported', confidence: 'high', meaning_preserved: true,
          reason: 'Both sources support the fact.', risk_flags: [],
        }, evaluatedAt: '2026-10-11T12:02:30.000Z',
      });
      store.evaluateRelation({
        proposalId: 'proposal-real', evaluatorId: 'relation:test',
        policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
        relation: {
          relation: 'unrelated', target_ref: null, confidence: 'high',
          meaning_preserved: true, reason: 'No comparable claim.',
        }, relatedClaimId: null, evaluatedAt: '2026-10-11T12:03:00.000Z',
      });
    } finally {
      store.close();
    }

    const result = await runEvidenceBoundPromotionPipeline({
      dbPath, memory, projectId: 'project-a', branch: 'main',
      inspectTextSensitivity: safeSensitivity,
      clock: () => '2026-10-11T12:04:00.000Z',
    });
    assert.equal(result.promoted, 1);
    const claimId = result.results[0].claim_id;
    const claim = memory.getClaim(claimId);
    assert.equal(claim.created_from_evidence_id, 'e-tool-real');
    assert.deepEqual(
      memory.getClaimEvidence(claimId).map((row) => [row.role, row.evidence.id]),
      [['primary', 'e-tool-real'], ['supporting', 'e-user-real']],
    );

    const recalled = memory.recall({
      projectId: 'project-a', branch: 'main', query: 'Postgres concurrent writers',
      mode: 'current', limit: 10,
    });
    assert.equal(recalled.items.length, 1);
    assert.deepEqual(
      recalled.items[0].provenance.map((row) => row.evidence.authority_class),
      ['tool_observation', 'user_direct'],
    );
    assert.equal(evaluateReliance({ items: recalled.items, conflicts: [], use: 'answer' }).selected.length, 1);
    assert.equal(evaluateReliance({ items: recalled.items, conflicts: [], use: 'project_policy' }).selected.length, 0);
  } finally {
    memory.close();
  }
});
