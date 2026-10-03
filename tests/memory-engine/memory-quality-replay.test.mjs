import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createCodexMemoryHookAdapter,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  MEMORY_REPLAY_FIXTURE_VERSION,
  replayCaptureReachability,
  scoreMemoryReplayImportance,
} from '../../memory-engine/memory-replay-fixtures.mjs';
import {
  CAPTURE_POLICY_VERSION,
  memoryCandidateFingerprint,
} from '../../memory-engine/memory-capture-policy.mjs';
import {
  runMemoryReplay,
} from '../../scripts/eval-memory-replay.mjs';

function userEvidence(memory, {
  id,
  value,
  at = '2026-10-03T01:00:00.000Z',
} = {}) {
  return memory.recordEvidence({
    id,
    projectId: 'project',
    harness: 'codex',
    sessionId: 'session',
    sourceKind: 'session',
    sourceRef: 'session:session',
    capturedAt: at,
    branch: 'main',
    content: value,
    authorityClass: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      candidate_capture: true,
    },
  });
}

function seedUserCandidate(memory, {
  id,
  evidenceId,
  value,
} = {}) {
  const evidence = userEvidence(memory, {
    id: evidenceId,
    value,
  });
  return memory.recordCandidate({
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
    createdAt: '2026-10-03T01:00:00.000Z',
  });
}

function seedAgentCandidate(memory, {
  id,
  evidenceId,
  value,
  fingerprint,
} = {}) {
  const evidence = memory.recordEvidence({
    id: evidenceId,
    projectId: 'project',
    harness: 'codex',
    sessionId: 'session',
    sourceKind: 'assistant',
    sourceRef: 'codex:stop:turn',
    capturedAt: '2026-10-03T01:00:00.000Z',
    branch: 'main',
    content: value,
    authorityClass: 'agent_inference',
    metadata: {
      event_type: 'assistant_stop',
      agent_type: 'root',
    },
  });
  return memory.recordAgentCandidate({
    id,
    evidenceId: evidence.id,
    proposedValue: evidence.content_redacted,
    decisionReason: 'rule:agent_decision:explicit_commitment',
    policyVersion: 'agent-capture-v1',
    fingerprint,
    createdAt: '2026-10-03T01:00:00.000Z',
  });
}

function fakeGit() {
  return {
    async resolveContext() {
      return {
        repoPath: '/repo/project',
        branch: 'main',
        revisionSha: 'a'.repeat(40),
      };
    },
    async refreshFreshness() {},
  };
}

function judgment(decision, {
  agent = false,
} = {}) {
  const promote = decision === 'promote';
  return JSON.stringify({
    decision,
    suggested_type: 'decision',
    durability: promote ? 'long' : decision === 'ignore' ? 'short' : 'medium',
    future_utility: promote ? 'high' : decision === 'ignore' ? 'low' : 'medium',
    specificity: 'high',
    confidence: promote ? 'high' : 'medium',
    meaning_preserved: true,
    canonical_fact: promote
      ? agent
        ? 'Agent decision: preserve the durable replay choice.'
        : 'Preserve the durable replay choice.'
      : null,
    reason: 'Replay fixture judgment.',
    risk_flags: promote ? [] : decision === 'ignore' ? ['transient'] : ['scope_unclear'],
  });
}

test('anonymized replay fixture preserves historical false-positive guards', () => {
  const result = replayCaptureReachability();

  assert.equal(result.version, MEMORY_REPLAY_FIXTURE_VERSION);
  assert.equal(result.total, 13);
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);

  const byId = new Map(result.cases.map((item) => [item.id, item]));
  assert.equal(
    byId.get('agent-declarative-not-commitment').observed_capture,
    false,
  );
  assert.equal(
    byId.get('agent-explicit-temporary-smoke').observed_capture,
    true,
  );
  assert.equal(
    byId.get('user-current-ci-status').observed_capture,
    false,
  );
});

test('replay scorer fails closed on false durable promotions', () => {
  const capture = replayCaptureReachability();
  assert.equal(capture.pass, true);

  const perfectUser = capture.cases
    .filter((item) => (
      item.authority === 'user_direct'
      && item.expected_capture
      && item.expected_importance !== null
    ))
    .map((item) => ({
      id: item.id,
      ok: true,
      decision: item.expected_importance,
    }));
  const perfectAgent = capture.cases
    .filter((item) => (
      item.authority === 'agent_inference'
      && item.expected_capture
      && item.expected_importance !== null
    ))
    .map((item) => ({
      id: item.id,
      ok: true,
      decision: item.expected_importance,
    }));

  let score = scoreMemoryReplayImportance({
    userPredictions: perfectUser,
    agentPredictions: perfectAgent,
  });
  assert.equal(score.quality_gate.pass, true);

  perfectAgent[perfectAgent.findIndex(
    (item) => item.id === 'agent-current-test-status',
  )] = {
    id: 'agent-current-test-status',
    ok: true,
    decision: 'promote',
  };
  score = scoreMemoryReplayImportance({
    userPredictions: perfectUser,
    agentPredictions: perfectAgent,
  });
  assert.equal(score.agent.false_promotions, 1);
  assert.equal(score.quality_gate.pass, false);
  assert.ok(
    score.quality_gate.failures.includes('agent:agent-current-test-status'),
  );
});

test('capture-only replay does not require a model provider', async () => {
  let factories = 0;
  const result = await runMemoryReplay({
    providerBacked: false,
    createUserJudge: async () => {
      factories += 1;
      throw new Error('must not run');
    },
    createAgentJudge: async () => {
      factories += 1;
      throw new Error('must not run');
    },
  });

  assert.equal(factories, 0);
  assert.equal(result.provider_backed, false);
  assert.equal(result.capture.pass, true);
  assert.equal(result.score, null);
});

test('provider-backed replay can gate both user and agent importance decisions', async () => {
  const result = await runMemoryReplay({
    providerBacked: true,
    sourceCodexHome: '/fixture/.codex',
    async createUserJudge() {
      return {
        async judge(candidate) {
          const value = candidate.proposed_value;
          if (/temporary smoke test/i.test(value)) return judgment('ignore');
          if (/Postgres as the production database/i.test(value)) {
            return judgment('promote');
          }
          if (/package\.json/i.test(value)) return judgment('ignore');
          if (/keep that private/i.test(value)) {
            return judgment('needs_confirmation');
          }
          throw new Error('unexpected user replay candidate: ' + value);
        },
        async close() {},
      };
    },
    async createAgentJudge() {
      return {
        async judge(prompt) {
          if (/temporary smoke test only/i.test(prompt)) {
            return judgment('ignore', { agent: true });
          }
          if (/PowerShell EncodedCommand/i.test(prompt)) {
            return judgment('promote', { agent: true });
          }
          if (/tests are green now/i.test(prompt)) {
            return judgment('ignore', { agent: true });
          }
          if (/package version currently recorded/i.test(prompt)) {
            return judgment('ignore', { agent: true });
          }
          throw new Error('unexpected agent replay prompt');
        },
        async close() {},
      };
    },
  });

  assert.equal(result.provider_backed, true);
  assert.equal(result.capture.pass, true);
  assert.equal(result.score.quality_gate.pass, true);
  assert.equal(result.score.user.false_promotions, 0);
  assert.equal(result.score.agent.false_promotions, 0);
});

test('quality snapshot separates user and agent judgment distributions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-quality-'));
  const memory = new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
    clock: () => '2026-10-03T02:00:00.000Z',
  });

  try {
    memory.registerProject({
      projectId: 'project',
      repoIdentity: 'project',
      createdAt: '2026-10-03T00:00:00.000Z',
    });

    const user = seedUserCandidate(memory, {
      id: 'candidate-user',
      evidenceId: 'e-user',
      value: 'We decided to use a one-run debug port.',
    });
    memory.evaluateCandidate({
      candidateId: user.id,
      evaluatorId: 'codex:test:importance-v2',
      evaluatedAt: '2026-10-03T01:01:00.000Z',
      evaluation: {
        decision: 'ignore',
        suggested_type: 'decision',
        durability: 'short',
        future_utility: 'low',
        specificity: 'high',
        confidence: 'high',
        meaning_preserved: true,
        canonical_fact: null,
        reason: 'One-run state.',
        risk_flags: ['transient'],
      },
    });

    const agent = seedAgentCandidate(memory, {
      id: 'candidate-agent',
      evidenceId: 'e-agent',
      value: 'Decision: keep async memory processing.',
      fingerprint: 'a'.repeat(64),
    });
    memory.evaluateAgentCandidate({
      candidateId: agent.id,
      evaluatorId: 'codex:test:agent-importance-v1',
      evaluatedAt: '2026-10-03T01:01:00.000Z',
      evaluation: {
        decision: 'promote',
        suggested_type: 'decision',
        durability: 'long',
        future_utility: 'high',
        specificity: 'high',
        confidence: 'high',
        meaning_preserved: true,
        canonical_fact: 'Agent decision: keep async memory processing.',
        reason: 'Durable cross-session choice.',
        risk_flags: [],
      },
    });

    memory.recordRecallTelemetry({
      id: 'recall-run:quality',
      projectId: 'project',
      branch: 'main',
      queryHash: '1'.repeat(64),
      observedAt: '2026-10-03T01:30:00.000Z',
      retrievalMode: 'hybrid',
      contextBytes: 200,
      items: [{
        claimId: 'synthetic-claim',
        authorityClass: 'user_direct',
        finalRank: 1,
        lexicalRank: 1,
        semanticRank: null,
        semanticSimilarity: null,
        rrfScore: null,
        budgetRetained: true,
        answerSelected: true,
        advisoryIncluded: false,
        blockedReason: null,
      }],
    });

    const snapshot = memory.memoryQualitySnapshot({
      projectId: 'project',
      branch: 'main',
    });

    assert.equal(snapshot.by_authority.user_direct.candidates, 1);
    assert.equal(snapshot.by_authority.user_direct.importance.ignore, 1);
    assert.equal(snapshot.by_authority.agent_inference.candidates, 1);
    assert.equal(snapshot.by_authority.agent_inference.importance.promote, 1);
    assert.deepEqual(snapshot.recall, {
      runs: 1,
      retrieved: 1,
      retained: 1,
      selected: 1,
      advisory: 0,
      blocked: 0,
    });
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('memory quality is a strict read-only operator command', async () => {
  assert.deepEqual(parseExplicitMemoryPrompt('memory quality'), {
    mode: 'quality',
  });
  assert.equal(parseExplicitMemoryPrompt('memory quality now'), null);

  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('quality command must not reach recall');
      },
    },
    memory: {
      memoryQualitySnapshot() {
        return {
          by_authority: {
            user_direct: {
              candidates: 4,
              importance: {
                promote: 1,
                ignore: 1,
                keep_candidate: 1,
                needs_confirmation: 1,
                unevaluated: 0,
                invalid: 0,
              },
              relations: {
                same: 1,
                update: 1,
                contradict: 1,
                unrelated: 1,
              },
              promotions: {
                promoted: 1,
                superseded: 1,
                needs_confirmation: 1,
              },
            },
            agent_inference: {
              candidates: 3,
              importance: {
                promote: 1,
                ignore: 2,
                keep_candidate: 0,
                needs_confirmation: 0,
                unevaluated: 0,
                invalid: 0,
              },
              relations: {
                same: 1,
                update: 0,
                contradict: 0,
                unrelated: 0,
              },
              promotions: {
                promoted: 1,
                superseded: 0,
                needs_confirmation: 0,
              },
            },
          },
          deterministic_near_duplicates: 1,
          recall: {
            runs: 5,
            retrieved: 9,
            retained: 7,
            selected: 4,
            advisory: 2,
            blocked: 1,
          },
          stale_agent_memories: 2,
        };
      },
    },
    projectId: 'project',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  const result = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's',
    turn_id: 't',
    cwd: '/repo/project',
    prompt: 'memory quality',
  });

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /user_direct: candidates=4/);
  assert.match(result.reason, /agent_inference: candidates=3/);
  assert.match(result.reason, /Deterministic near-duplicates closed: 1/);
  assert.match(result.reason, /Recall: runs=5 retrieved=9/);
  assert.match(result.reason, /Stale advisory agent memories: 2/);
});
