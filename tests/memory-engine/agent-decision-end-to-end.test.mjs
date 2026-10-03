import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  runCodexAgentDecisionHook,
} from '../../memory-engine/adapters/codex-agent-decision-hook-cli.mjs';
import {
  createCodexMemoryHookAdapter,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import {
  evaluatePendingAgentDecisionCandidates,
} from '../../memory-engine/agent-decision-judge.mjs';
import {
  evaluateAgentDecisionRelations,
} from '../../memory-engine/agent-decision-relation.mjs';
import {
  finalizeAgentDecisionCandidates,
} from '../../memory-engine/agent-decision-promotion.mjs';

test('Stop -> agent decision pipeline -> later advisory recall works end to end', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-e2e-'));
  const dbPath = join(root, 'memory.sqlite3');
  const projectId = 'github.com/example/project';

  await runCodexAgentDecisionHook({
    event: {
      hook_event_name: 'Stop',
      session_id: 'session-agent',
      cwd: '/fixture/repo',
      turn_id: 'turn-agent',
      stop_hook_active: false,
      last_assistant_message:
        'Decision: keep the memory candidate worker detached from the prompt hotpath.',
    },
    env: {},
    configOptions: {
      ignoreMemoryEnv: true,
      autoPipeline: false,
    },
    clock: () => '2026-10-03T03:00:00.000Z',
    createMemory: () => new MemoryEngine({ dbPath }),
    resolveProjectScope() {
      return {
        projectId,
        repoIdentity: projectId,
        canonicalRemote: projectId,
      };
    },
    resolveGit() {
      return {
        repoPath: '/fixture/repo',
        branch: 'main',
        revisionSha: 'a'.repeat(40),
      };
    },
    ensureDbDirectory() {},
    restoreLocked() {
      return false;
    },
  });

  const memory = new MemoryEngine({ dbPath });
  const candidate = memory.listUnevaluatedAgentCandidates({
    projectId,
    branch: 'main',
    limit: 10,
  })[0];
  assert.ok(candidate);

  const importance = await evaluatePendingAgentDecisionCandidates({
    memory,
    projectId,
    branch: 'main',
    evaluatorId: 'fixture:agent-importance-v1',
    apply: true,
    now: () => '2026-10-03T03:01:00.000Z',
    judge: async () => ({
      decision: 'promote',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact:
        'Agent decision: keep the memory candidate worker detached from the prompt hotpath.',
      reason: 'Durable cross-session architecture choice.',
      risk_flags: [],
    }),
  });
  assert.equal(importance.applied, 1);

  let relationJudgeCalls = 0;
  const relation = await evaluateAgentDecisionRelations({
    memory,
    projectId,
    branch: 'main',
    evaluatorId: 'fixture:agent-relation-v1',
    apply: true,
    now: () => '2026-10-03T03:02:00.000Z',
    judge: async () => {
      relationJudgeCalls += 1;
      throw new Error('no existing memories means model should not run');
    },
  });
  assert.equal(relationJudgeCalls, 0);
  assert.equal(relation.results[0].relation, 'unrelated');

  const promotion = finalizeAgentDecisionCandidates({
    memory,
    projectId,
    branch: 'main',
    apply: true,
    now: () => '2026-10-03T03:03:00.000Z',
  });
  assert.equal(promotion.summary.promoted, 1);

  const claims = memory.exportCanonical().claims.filter(
    (claim) => claim.state === 'active',
  );
  assert.equal(claims.length, 1);
  assert.equal(claims[0].kind, 'agent_inference');
  assert.equal(claims[0].subject, 'agent decision');

  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle(request) {
        assert.equal(request.operation, 'recall');
        return {
          protocol: 'memory.protocol.v1',
          request_id: request.request_id,
          ok: true,
          result: memory.recall({
            projectId,
            branch: 'main',
            query: request.payload.query,
            mode: 'current',
            limit: 10,
          }),
        };
      },
    },
    memory,
    projectId,
    git: {
      async resolveContext() {
        return {
          repoPath: '/fixture/repo',
          branch: 'main',
          revisionSha: 'b'.repeat(40),
        };
      },
      async refreshFreshness() {},
    },
  });

  const recalled = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-later',
    cwd: '/fixture/repo',
    turn_id: 'turn-later',
    prompt: 'How should the memory candidate worker relate to the prompt hotpath?',
  });

  const context = recalled?.hookSpecificOutput?.additionalContext ?? '';
  assert.match(context, /Advisory prior agent decisions:/);
  assert.match(context, /lower-authority agent_inference/);
  assert.match(context, /keep the memory candidate worker detached/);

  memory.close();
});
