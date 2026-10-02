#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createCodexMemoryHookAdapter,
  memoryCandidateRef,
  memoryClaimRef,
} from '../memory-engine/adapters/codex-hooks.mjs';
import {
  MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES,
  runMemoryCandidateConfirmationBehavioralCases,
} from '../memory-engine/memory-candidate-confirmation-behavioral-eval.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import { createMemoryProtocol } from '../memory-engine/protocol.mjs';
import { runMemoryCandidateJudgeCli } from './judge-memory-candidates.mjs';
import { runMemoryCandidateRelationCli } from './judge-memory-relations.mjs';
import { runMemoryCandidatePipelineCli } from './process-memory-candidates.mjs';

function createProject(memory, projectId) {
  memory.registerProject({
    projectId,
    repoIdentity: projectId,
    createdAt: '2026-10-02T00:00:00.000Z',
  });
}

function createProtocol(memory) {
  return createMemoryProtocol({
    memory,
    classifyAuthority(channel) {
      if (
        channel.sourceKind === 'session'
        && channel.metadata?.event_type === 'user_prompt'
      ) {
        return 'user_direct';
      }
      return 'unclassified';
    },
  });
}

function fakeGit(branch) {
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

function seedDurableMemory(memory, {
  projectId,
  branch,
  id,
  value,
}) {
  const result = memory.ingest({
    evidence: {
      id: 'confirmation-eval-seed-evidence-' + id,
      projectId,
      sourceKind: 'session',
      sourceRef: 'confirmation-eval-seed:' + id,
      capturedAt: '2026-10-02T00:00:00.000Z',
      branch,
      content: value,
      authorityClass: 'user_direct',
      metadata: {
        behavioral_eval_seed: true,
      },
    },
    claim: {
      id: 'confirmation-eval-seed-claim-' + id,
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value,
      branchScope: branch,
      createdAt: '2026-10-02T00:00:00.000Z',
    },
  });
  return result.claim;
}

async function submitHookPrompt({
  memory,
  projectId,
  branch,
  turnId,
  prompt,
  candidateCapture = true,
}) {
  const adapter = createCodexMemoryHookAdapter({
    protocol: createProtocol(memory),
    memory,
    projectId,
    candidateCapture,
    explicitMemoryRequests: true,
    clock: () => '2026-10-02T00:10:00.000Z',
    git: fakeGit(branch),
  });

  return adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'confirmation-behavioral-eval',
    turn_id: turnId,
    cwd: '/repo',
    prompt,
  });
}

function scopedClaims(memory, {
  projectId,
  branch,
}) {
  return memory.exportCanonical().claims.filter((claim) => (
    claim.project_id === projectId
    && claim.branch_scope === branch
    && claim.kind === 'user_direct'
    && claim.subject === 'user memory'
    && claim.predicate === 'states'
  ));
}

function lifecycleStats(memory, {
  projectId,
  branch,
}) {
  const exported = memory.exportCanonical();
  const currentClaims = scopedClaims(memory, {
    projectId,
    branch,
  });
  const currentIds = new Set(currentClaims.map((claim) => claim.id));

  return {
    current_active_claims: currentClaims.filter(
      (claim) => claim.state === 'active',
    ).length,
    current_superseded_claims: currentClaims.filter(
      (claim) => claim.state === 'superseded',
    ).length,
    open_conflicts: exported.conflicts.filter((conflict) => (
      conflict.project_id === projectId
      && conflict.state === 'open'
      && currentIds.has(conflict.claim_a)
      && currentIds.has(conflict.claim_b)
    )).length,
    supersede_events: exported.lifecycle_events.filter((event) => (
      event.project_id === projectId
      && event.action === 'supersede'
      && currentIds.has(event.source_claim_id)
      && currentIds.has(event.target_claim_id)
    )).length,
  };
}

function deterministicStageRunners(caseSpec) {
  let importanceJudgeCalls = 0;
  let relationJudgeCalls = 0;

  return {
    get modelCalls() {
      return importanceJudgeCalls + relationJudgeCalls;
    },

    async runImportance(args) {
      return runMemoryCandidateJudgeCli({
        ...args,
        dependencies: {
          ...args.dependencies,
          createJudge: async () => ({
            evaluatorId: 'confirmation-eval:importance-v1',
            isolation: { deterministicFixture: true },
            async judge(candidate) {
              importanceJudgeCalls += 1;

              if (caseSpec.pipeline.importance === 'needs_confirmation') {
                return {
                  decision: 'needs_confirmation',
                  suggested_type: candidate.proposed_type,
                  durability: 'long',
                  future_utility: 'high',
                  specificity: 'high',
                  confidence: 'medium',
                  meaning_preserved: true,
                  canonical_fact: candidate.proposed_value,
                  reason: 'Deterministic confirmation fixture.',
                  risk_flags: ['scope_unclear'],
                };
              }

              if (caseSpec.pipeline.importance === 'keep_candidate') {
                return {
                  decision: 'keep_candidate',
                  suggested_type: candidate.proposed_type,
                  durability: 'medium',
                  future_utility: 'medium',
                  specificity: 'high',
                  confidence: 'high',
                  meaning_preserved: true,
                  canonical_fact: candidate.proposed_value,
                  reason: 'Deterministic kept-candidate fixture.',
                  risk_flags: ['transient'],
                };
              }

              return {
                decision: 'promote',
                suggested_type: candidate.proposed_type,
                durability: 'long',
                future_utility: 'high',
                specificity: 'high',
                confidence: 'high',
                meaning_preserved: true,
                canonical_fact: candidate.proposed_value,
                reason: 'Deterministic confirmation fixture.',
                risk_flags: [],
              };
            },
            async close() {},
          }),
        },
      });
    },

    async runRelation(args) {
      return runMemoryCandidateRelationCli({
        ...args,
        dependencies: {
          ...args.dependencies,
          createJudge: async () => ({
            evaluatorId: 'confirmation-eval:relation-v1',
            isolation: { deterministicFixture: true },
            async judge({ memories }) {
              relationJudgeCalls += 1;
              if (memories.length !== 1) {
                throw new Error(
                  caseSpec.id + ' expected exactly one relation target',
                );
              }
              return {
                relation: caseSpec.pipeline.relation,
                target_ref: memories[0].ref,
                confidence: 'medium',
                meaning_preserved: true,
                reason: 'Deterministic confirmation relation fixture.',
              };
            },
            async close() {},
          }),
        },
      });
    },
  };
}

function confirmationPrompt(caseSpec, {
  candidateRef,
  targetRef,
}) {
  const target = targetRef === null ? '' : ' ' + targetRef;
  return (
    'memory candidate confirm: '
    + candidateRef
    + ' => '
    + caseSpec.confirmation.relation
    + target
  );
}

function canonicalStateFingerprint(memory) {
  const exported = memory.exportCanonical();
  return JSON.stringify({
    claims: exported.claims,
    lifecycle_events: exported.lifecycle_events,
    conflicts: exported.conflicts,
  });
}

export async function runDeterministicMemoryCandidateConfirmationCase(
  caseSpec,
) {
  if (!caseSpec || typeof caseSpec !== 'object') {
    throw new TypeError('caseSpec must be an object');
  }

  const root = await mkdtemp(
    join(tmpdir(), 'agent-hub-confirmation-behavioral-eval-'),
  );
  const dbPath = join(root, 'memory.sqlite3');
  const projectId = 'project';
  const memory = new MemoryEngine({ dbPath });

  try {
    createProject(memory, projectId);

    const seededClaims = [];
    for (const [index, seed] of caseSpec.seed_memories.entries()) {
      seededClaims.push(seedDurableMemory(memory, {
        projectId,
        branch: seed.branch,
        id: caseSpec.id + '-' + index,
        value: seed.value,
      }));
    }

    await submitHookPrompt({
      memory,
      projectId,
      branch: caseSpec.branch,
      turnId: caseSpec.id + '-candidate',
      prompt: caseSpec.prompt,
    });

    const candidate = memory.listScopedCandidates({
      projectId,
      branch: caseSpec.branch,
    }).find((item) => item.proposed_value === caseSpec.prompt);
    if (!candidate) {
      throw new Error(caseSpec.id + ' candidate must be captured');
    }

    const runtime = {
      cwd: '/repo',
      dbPath,
      projectId,
      branch: caseSpec.branch,
      revisionSha: 'a'.repeat(40),
    };
    const stageRunners = deterministicStageRunners(caseSpec);
    const createMemory = ({ dbPath: candidateDbPath }) => (
      new MemoryEngine({ dbPath: candidateDbPath })
    );
    const pipelineDependencies = {
      resolveRuntime: () => runtime,
      createMemory,
      runImportance: stageRunners.runImportance,
      runRelation: stageRunners.runRelation,
    };

    await runMemoryCandidatePipelineCli({
      argv: ['--apply', '--limit', '10'],
      cwd: '/repo',
      log() {},
      dependencies: pipelineDependencies,
    });

    const readyCandidate = memory.getCandidate(candidate.id);
    const expectedReadyStatus = (
      caseSpec.pipeline.importance === 'keep_candidate'
        ? 'pending'
        : 'needs_confirmation'
    );
    if (readyCandidate?.status !== expectedReadyStatus) {
      throw new Error(
        caseSpec.id
        + ' expected '
        + expectedReadyStatus
        + ' before explicit confirmation but got '
        + String(readyCandidate?.status),
      );
    }

    const candidateRef = (
      caseSpec.confirmation.candidate_ref_override
      ?? memoryCandidateRef(candidate.id)
    );
    let targetRef = null;
    if (caseSpec.confirmation.target_branch !== null) {
      const matches = seededClaims.filter(
        (claim) => claim.branch_scope === caseSpec.confirmation.target_branch,
      );
      if (matches.length !== 1) {
        throw new Error(caseSpec.id + ' expected exactly one confirmation target');
      }
      targetRef = memoryClaimRef(matches[0].id);
    }

    const evidenceBeforeListing = memory.exportCanonical().evidence.length;
    const listing = await submitHookPrompt({
      memory,
      projectId,
      branch: caseSpec.branch,
      turnId: caseSpec.id + '-list',
      prompt: 'memory candidates',
      candidateCapture: false,
    });
    const evidenceAfterListing = memory.exportCanonical().evidence.length;
    if (
      listing?.decision !== 'block'
      || typeof listing?.reason !== 'string'
      || !listing.reason.includes(memoryCandidateRef(candidate.id))
    ) {
      throw new Error(caseSpec.id + ' candidate listing did not expose the candidate');
    }
    if (evidenceAfterListing !== evidenceBeforeListing) {
      throw new Error(caseSpec.id + ' candidate listing mutated evidence');
    }

    const modelCallsBeforeConfirmation = stageRunners.modelCalls;
    const evidenceBeforeConfirmation = memory.exportCanonical().evidence.length;
    const prompt = confirmationPrompt(caseSpec, {
      candidateRef,
      targetRef,
    });
    const confirmation = await submitHookPrompt({
      memory,
      projectId,
      branch: caseSpec.branch,
      turnId: caseSpec.id + '-confirm',
      prompt,
      candidateCapture: false,
    });
    const evidenceAfterConfirmation = memory.exportCanonical().evidence.length;
    const modelCallsAfterConfirmation = stageRunners.modelCalls;

    if (confirmation?.decision !== 'block') {
      throw new Error(caseSpec.id + ' confirmation command was not terminal');
    }

    const candidateAfterConfirmation = memory.getCandidate(candidate.id);
    const confirmationAudit = memory.getCandidateConfirmation(candidate.id);
    const confirmationApplied = confirmationAudit !== null;

    let sameRetryChangedState;
    if (caseSpec.expected.confirmation_applied) {
      const beforeRetry = canonicalStateFingerprint(memory);
      const auditBeforeRetry = JSON.stringify(confirmationAudit);
      const evidenceBeforeRetry = memory.exportCanonical().evidence.length;

      const retry = await submitHookPrompt({
        memory,
        projectId,
        branch: caseSpec.branch,
        turnId: caseSpec.id + '-confirm',
        prompt,
        candidateCapture: false,
      });
      if (
        retry?.decision !== 'block'
        || typeof retry?.reason !== 'string'
        || !/confirmed/i.test(retry.reason)
      ) {
        throw new Error(caseSpec.id + ' idempotent retry was not accepted');
      }

      sameRetryChangedState = (
        canonicalStateFingerprint(memory) !== beforeRetry
        || JSON.stringify(memory.getCandidateConfirmation(candidate.id))
          !== auditBeforeRetry
        || memory.exportCanonical().evidence.length !== evidenceBeforeRetry
      );
    }

    const finalPipeline = await runMemoryCandidatePipelineCli({
      argv: ['--apply', '--limit', '10'],
      cwd: '/repo',
      log() {},
      dependencies: pipelineDependencies,
    });

    const lifecycle = lifecycleStats(memory, {
      projectId,
      branch: caseSpec.branch,
    });
    const otherActiveClaims = scopedClaims(memory, {
      projectId,
      branch: caseSpec.other_branch,
    }).filter((claim) => claim.state === 'active').length;

    const observed = {
      confirmation_applied: confirmationApplied,
      confirmation_reason: confirmation.reason,
      candidate_status: candidateAfterConfirmation.status,
      ...lifecycle,
      other_active_claims: otherActiveClaims,
      confirmation_evidence_count_delta:
        evidenceAfterConfirmation - evidenceBeforeConfirmation,
      confirmation_audit_count: confirmationAudit === null ? 0 : 1,
      ...(caseSpec.expected.confirmation_applied
        ? { same_retry_changed_state: sameRetryChangedState }
        : {}),
      final_pipeline_ready: {
        importance: finalPipeline.final.importance_ready,
        relation: finalPipeline.final.relation_ready,
        promotion: finalPipeline.final.promotion_ready,
      },
      confirmation_model_calls:
        modelCallsAfterConfirmation - modelCallsBeforeConfirmation,
    };

    return observed;
  } finally {
    memory.close();
    await rm(root, {
      recursive: true,
      force: true,
    }).catch(() => {});
  }
}

export function summarizeMemoryCandidateConfirmationBehavioralResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('result must be an object');
  }
  const cases = Array.isArray(result.cases) ? result.cases : [];
  const modelCalls = cases.reduce((sum, item) => (
    sum + (
      Number.isInteger(item?.observed?.confirmation_model_calls)
        ? item.observed.confirmation_model_calls
        : 0
    )
  ), 0);

  return {
    pass: result.pass === true,
    total_cases: result.totalCases,
    passed_cases: result.passedCases,
    failed_cases: result.failedCases,
    model_calls_during_confirmation: modelCalls,
  };
}

async function main() {
  const result = await runMemoryCandidateConfirmationBehavioralCases({
    cases: MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES,
    runCase: runDeterministicMemoryCandidateConfirmationCase,
  });

  for (const item of result.cases) {
    console.log(JSON.stringify({
      type: 'memory_candidate_confirmation_behavioral_case',
      ...item,
    }));
  }

  console.log(JSON.stringify({
    type: 'memory_candidate_confirmation_behavioral_summary',
    ...summarizeMemoryCandidateConfirmationBehavioralResult(result),
  }));

  if (!result.pass) process.exitCode = 1;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
