import { createHash } from 'node:crypto';

import { evaluateReliance } from '../index.mjs';
import { classifyMemoryCandidatePrompt } from '../memory-capture-policy.mjs';
import { confirmMemoryCandidate } from '../memory-candidate-confirmation.mjs';
import {
  validateMemoryCandidateJudgment,
} from '../memory-candidate-judge.mjs';
import {
  refreshRepositoryFreshness,
  resolveGitContext,
} from '../git-freshness.mjs';
import {
  formatMemoryRecallContext,
} from './recall-context.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function compactText(value, maxChars = 500) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

export function memoryClaimRef(claimId) {
  if (!nonEmptyString(claimId)) {
    throw new TypeError('claimId must be a non-empty string');
  }
  const digest = createHash('sha256')
    .update(claimId, 'utf8')
    .digest('hex');
  return `@${digest.slice(0, 10)}`;
}

export function memoryCandidateRef(candidateId) {
  if (!nonEmptyString(candidateId)) {
    throw new TypeError('candidateId must be a non-empty string');
  }
  const digest = createHash('sha256')
    .update(candidateId, 'utf8')
    .digest('hex');
  return `~${digest.slice(0, 10)}`;
}

function normalizeMemoryRef(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^@[0-9a-f]{10}$/.test(normalized) ? normalized : null;
}

function normalizeCandidateRef(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^~[0-9a-f]{10}$/.test(normalized) ? normalized : null;
}

export function formatCodexMemoryContext(result, options = {}) {
  return formatMemoryRecallContext(result, options);
}

export function parseExplicitMemoryPrompt(prompt) {
  if (typeof prompt !== 'string') return null;

  if (/^\s*memory\s+list\s*$/i.test(prompt)) {
    return { mode: 'list' };
  }

  if (/^\s*memory\s+candidates\s*$/i.test(prompt)) {
    return { mode: 'candidates' };
  }

  if (/^\s*memory\s+pipeline\s*$/i.test(prompt)) {
    return { mode: 'pipeline' };
  }

  const confirmPrefix = prompt.match(
    /^\s*memory\s+candidate\s+confirm:\s*/i,
  );
  if (confirmPrefix) {
    const body = prompt.slice(confirmPrefix[0].length).trim();
    const delimiterIndex = body.indexOf('=>');
    if (delimiterIndex < 0) return null;

    const candidateRef = normalizeCandidateRef(
      body.slice(0, delimiterIndex).trim(),
    );
    if (candidateRef === null) return null;

    const action = body.slice(delimiterIndex + 2).trim();
    if (/^unrelated$/i.test(action)) {
      return {
        mode: 'candidate_confirm',
        candidateRef,
        relation: 'unrelated',
        targetRef: null,
      };
    }

    const related = action.match(
      /^(same|update|contradict)\s+(@[0-9a-f]{10})$/i,
    );
    if (!related) return null;

    return {
      mode: 'candidate_confirm',
      candidateRef,
      relation: related[1].toLowerCase(),
      targetRef: normalizeMemoryRef(related[2]),
    };
  }

  const explainPrefix = prompt.match(/^\s*memory\s+explain:\s*/i);
  if (explainPrefix) {
    const query = prompt.slice(explainPrefix[0].length).trim();
    if (!nonEmptyString(query)) return null;
    return {
      mode: 'explain',
      query,
    };
  }

  const forgetPrefix = prompt.match(/^\s*memory\s+forget:\s*/i);
  if (forgetPrefix) {
    const value = prompt.slice(forgetPrefix[0].length).trim();
    const ref = normalizeMemoryRef(value);
    if (ref !== null) {
      return {
        mode: 'forget',
        ref,
      };
    }
    if (!/^memory:\s*\S/i.test(value)) return null;
    return {
      mode: 'forget',
      value,
    };
  }

  if (/^\s*memory:\s*\S/i.test(prompt)) {
    return {
      mode: 'remember',
      value: prompt,
    };
  }

  const prefix = prompt.match(/^\s*memory\s+replace:\s*/i);
  if (!prefix) return null;

  const body = prompt.slice(prefix[0].length);
  const delimiterIndex = body.indexOf('=>');
  if (delimiterIndex < 0) return null;

  const oldValue = body.slice(0, delimiterIndex).trim();
  const oldRef = normalizeMemoryRef(oldValue);
  const newValue = body.slice(delimiterIndex + 2).trim();
  if (!/^memory:\s*\S/i.test(newValue)) return null;

  if (oldRef !== null) {
    return {
      mode: 'replace',
      oldRef,
      newValue,
    };
  }

  if (!/^memory:\s*\S/i.test(oldValue)) return null;
  return {
    mode: 'replace',
    oldValue,
    newValue,
  };
}

function activeDirectUserMemories(memory, {
  projectId,
  branch,
}) {
  if (typeof memory?.exportCanonical !== 'function') return [];
  const exported = memory.exportCanonical();
  if (
    !exported
    || !Array.isArray(exported.claims)
    || !Array.isArray(exported.evidence)
  ) {
    return [];
  }

  const evidenceById = new Map(
    exported.evidence.map((evidence) => [evidence.id, evidence]),
  );

  return exported.claims
    .filter((claim) => {
      const evidence = evidenceById.get(claim.created_from_evidence_id);
      return (
        claim?.project_id === projectId
        && claim?.branch_scope === branch
        && claim?.state === 'active'
        && claim?.kind === 'user_direct'
        && claim?.subject === 'user memory'
        && claim?.predicate === 'states'
        && evidence?.project_id === projectId
        && evidence?.authority_class === 'user_direct'
      );
    })
    .sort((a, b) => (
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
      || String(a.id ?? '').localeCompare(String(b.id ?? ''))
    ));
}

function formatActiveDirectUserMemories(memory, {
  projectId,
  branch,
  maxBytes,
}) {
  const memories = activeDirectUserMemories(memory, { projectId, branch });
  if (memories.length === 0) {
    return 'No active durable user memories for the current project and branch.';
  }

  const lines = [
    'Active durable user memories for the current project and branch:',
  ];

  for (const claim of memories) {
    const line = `- ${memoryClaimRef(claim.id)} ${compactText(
      claim.value_text ?? '',
      500,
    )}`;
    const candidate = [...lines, line].join('\n');
    if (byteLength(candidate) > maxBytes) break;
    lines.push(line);
  }

  return lines.join('\n');
}

function isEvaluatedKeptCandidate(candidate) {
  if (
    !candidate
    || typeof candidate !== 'object'
    || candidate.status !== 'pending'
    || candidate.evaluated_at === null
    || typeof candidate.evaluation_json !== 'string'
    || candidate.relation !== null
  ) {
    return false;
  }

  try {
    return validateMemoryCandidateJudgment(
      JSON.parse(candidate.evaluation_json),
    ).decision === 'keep_candidate';
  } catch {
    return false;
  }
}

function isExplicitlyConfirmableCandidate(candidate) {
  return (
    candidate?.status === 'needs_confirmation'
    || isEvaluatedKeptCandidate(candidate)
  );
}

function formatPendingMemoryCandidates(memory, {
  projectId,
  branch,
  maxBytes,
}) {
  if (typeof memory?.listCandidates !== 'function') {
    return 'Memory candidate ledger is unavailable.';
  }

  const pending = memory.listCandidates({
    projectId,
    branch,
    status: 'pending',
    limit: 50,
  });
  const needsConfirmation = memory.listCandidates({
    projectId,
    branch,
    status: 'needs_confirmation',
    limit: 50,
  });
  const candidates = [...needsConfirmation, ...pending]
    .sort((left, right) => (
      String(right.created_at ?? '').localeCompare(String(left.created_at ?? ''))
      || String(left.id ?? '').localeCompare(String(right.id ?? ''))
    ))
    .slice(0, 50);

  if (candidates.length === 0) {
    return 'No actionable memory candidates for the current project and branch.';
  }

  const lines = [
    'Actionable memory candidates for the current project and branch:',
  ];

  for (const candidate of candidates) {
    let judgeSummary = null;
    if (typeof candidate.evaluation_json === 'string') {
      try {
        const evaluation = JSON.parse(candidate.evaluation_json);
        if (evaluation && typeof evaluation === 'object') {
          judgeSummary = [
            'judge=' + compactText(evaluation.decision ?? 'unknown', 40),
            'durability=' + compactText(evaluation.durability ?? 'unknown', 40),
            'utility=' + compactText(evaluation.future_utility ?? 'unknown', 40),
            'confidence=' + compactText(evaluation.confidence ?? 'unknown', 40),
          ].join(' ');
        }
      } catch {
        judgeSummary = 'judge=invalid';
      }
    }

    const relationSummary = candidate.relation
      ? [
          'relation=' + compactText(candidate.relation, 40),
          candidate.related_claim_id
            ? 'target=' + memoryClaimRef(candidate.related_claim_id)
            : null,
        ].filter(Boolean).join(' ')
      : null;

    const line = [
      `- ${memoryCandidateRef(candidate.id)}`,
      `[status=${compactText(candidate.status, 40)}]`,
      `[${compactText(candidate.proposed_type, 80)}]`,
      compactText(candidate.proposed_value, 500),
      judgeSummary ? '| ' + judgeSummary : null,
      relationSummary ? '| ' + relationSummary : null,
    ].filter(Boolean).join(' ');

    const next = [...lines, line].join('\n');
    if (byteLength(next) > maxBytes) break;
    lines.push(line);
  }

  return lines.join('\n');
}

function formatMemoryCandidatePipelineStatus(memory, {
  projectId,
  branch,
}) {
  const unavailable =
    'Memory candidate pipeline status is unavailable for the current configuration.';

  if (
    typeof memory?.listUnevaluatedCandidates !== 'function'
    || typeof memory?.listRelationPendingCandidates !== 'function'
    || typeof memory?.listPromotionReadyCandidates !== 'function'
    || typeof memory?.listScopedCandidates !== 'function'
  ) {
    return unavailable;
  }

  try {
    const limit = 20;
    const importanceReady = memory.listUnevaluatedCandidates({
      projectId,
      branch,
      limit,
    }).length;
    const relationReady = memory.listRelationPendingCandidates({
      projectId,
      branch,
      limit,
    }).length;
    const promotionReady = memory.listPromotionReadyCandidates({
      projectId,
      branch,
      limit,
    }).length;
    const scoped = memory.listScopedCandidates({
      projectId,
      branch,
    });
    const needsConfirmation = scoped.filter(
      (candidate) => candidate?.status === 'needs_confirmation',
    ).length;
    const keptForReview = scoped.filter(isEvaluatedKeptCandidate).length;

    return [
      'Memory candidate pipeline status for the current project and branch:',
      `importance-ready: ${importanceReady} (next batch, max ${limit})`,
      `relation-ready: ${relationReady} (next batch, max ${limit})`,
      `promotion-ready: ${promotionReady} (next batch, max ${limit})`,
      `needs-confirmation: ${needsConfirmation}`,
      `kept-for-review: ${keptForReview}`,
      'Read-only: no judges or promotion were run.',
      'Run: node .\\scripts\\process-memory-candidates.mjs --apply',
    ].join('\n');
  } catch {
    return unavailable;
  }
}

function formatRecallDiagnostics(result, {
  maxBytes,
}) {
  const candidates = Array.isArray(result?.candidates)
    ? result.candidates.filter((candidate) => candidate?.item?.claim?.id)
    : [];
  const conflicts = Array.isArray(result?.conflicts) ? result.conflicts : [];
  const reliance = evaluateReliance({
    items: candidates.map((candidate) => candidate.item),
    conflicts,
    use: 'answer',
  });

  const selectedIds = new Set(
    reliance.selected.map((item) => item.claim.id),
  );
  const blockedReasons = new Map();
  for (const blocked of reliance.blocked) {
    const claimId = blocked?.item?.claim?.id;
    if (!claimId) continue;
    const reasons = blockedReasons.get(claimId) ?? [];
    if (!reasons.includes(blocked.reason)) reasons.push(blocked.reason);
    blockedReasons.set(claimId, reasons);
  }

  const lines = [
    'Recall diagnostics for the current project and branch:',
    `Mode: ${result?.retrievalMode ?? 'unknown'}`,
    `Fallback: ${result?.fallbackReason ?? 'none'}`,
  ];

  if (candidates.length === 0) {
    lines.push('No recall candidates.');
    return lines.join('\n');
  }

  for (const candidate of candidates) {
    const claim = candidate.item.claim;
    const evidence = candidate.item.evidence ?? {};
    const rankParts = [`final #${candidate.finalRank}`];

    if (candidate.lexicalRank !== null) {
      rankParts.push(`lexical #${candidate.lexicalRank}`);
    }
    if (candidate.semanticRank !== null) {
      const similarity = Number.isFinite(candidate.semanticSimilarity)
        ? ` (${candidate.semanticSimilarity.toFixed(4)})`
        : '';
      rankParts.push(`semantic #${candidate.semanticRank}${similarity}`);
    }
    if (Number.isFinite(candidate.rrfScore)) {
      rankParts.push(`RRF ${candidate.rrfScore.toFixed(6)}`);
    }

    const answerDecision = selectedIds.has(claim.id)
      ? 'answer: selected'
      : `answer: blocked (${
          (blockedReasons.get(claim.id) ?? ['not_selected_for_answer']).join(',')
        })`;

    const value = compactText(
      claim.value ?? evidence.content_redacted ?? '',
      300,
    );
    const line = [
      `- ${memoryClaimRef(claim.id)}`,
      ...rankParts,
      answerDecision,
      `authority: ${evidence.authority_class ?? 'unclassified'}`,
      value,
    ].join(' | ');

    const next = [...lines, line].join('\n');
    if (byteLength(next) > maxBytes) break;
    lines.push(line);
  }

  return lines.join('\n');
}

export function resolveActiveDirectUserMemoryTarget(memory, {
  projectId,
  branch,
  value = null,
  ref = null,
}) {
  if ((value === null) === (ref === null)) return null;

  if (value !== null) {
    if (typeof memory?.exportCanonical !== 'function') return null;
    const exported = memory.exportCanonical();
    if (!exported || !Array.isArray(exported.claims)) return null;
    const matches = exported.claims.filter((claim) => (
      claim?.project_id === projectId
      && claim?.branch_scope === branch
      && claim?.state === 'active'
      && claim?.value_text === value
    ));
    return matches.length === 1 ? matches[0] : null;
  }

  const memories = activeDirectUserMemories(memory, {
    projectId,
    branch,
  });
  const matches = memories.filter(
    (claim) => memoryClaimRef(claim.id) === ref,
  );
  return matches.length === 1 ? matches[0] : null;
}

function resolveScopedCandidateTarget(memory, {
  projectId,
  branch,
  ref,
}) {
  if (typeof memory?.listScopedCandidates !== 'function') return null;
  const candidates = memory.listScopedCandidates({
    projectId,
    branch,
  });
  const matches = candidates.filter(
    (candidate) => memoryCandidateRef(candidate.id) === ref,
  );
  return matches.length === 1 ? matches[0] : null;
}

function validUserPromptEvent(event) {
  return (
    event
    && typeof event === 'object'
    && event.hook_event_name === 'UserPromptSubmit'
    && nonEmptyString(event.session_id)
    && nonEmptyString(event.cwd)
    && nonEmptyString(event.turn_id)
    && nonEmptyString(event.prompt)
  );
}

function defaultGit(memory) {
  return {
    resolveContext: resolveGitContext,
    refreshFreshness(args) {
      return refreshRepositoryFreshness({
        memory,
        ...args,
      });
    },
  };
}

export function createCodexMemoryHookAdapter({
  protocol,
  memory,
  projectId,
  capturePrompts = false,
  explicitMemoryRequests = false,
  candidateCapture = false,
  diagnoseRecall = null,
  clock = () => new Date().toISOString(),
  git = null,
  maxContextBytes = 8_192,
}) {
  if (!protocol || typeof protocol.handle !== 'function') {
    throw new TypeError('protocol must expose handle()');
  }
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  if (!nonEmptyString(projectId)) {
    throw new TypeError('projectId must be a non-empty string');
  }
  if (typeof capturePrompts !== 'boolean') {
    throw new TypeError('capturePrompts must be a boolean');
  }
  if (typeof explicitMemoryRequests !== 'boolean') {
    throw new TypeError('explicitMemoryRequests must be a boolean');
  }
  if (typeof candidateCapture !== 'boolean') {
    throw new TypeError('candidateCapture must be a boolean');
  }
  if (diagnoseRecall !== null && typeof diagnoseRecall !== 'function') {
    throw new TypeError('diagnoseRecall must be a function or null');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }
  if (!Number.isInteger(maxContextBytes) || maxContextBytes < 1) {
    throw new RangeError('maxContextBytes must be a positive integer');
  }

  const gitRuntime = git ?? defaultGit(memory);
  if (
    !gitRuntime
    || typeof gitRuntime.resolveContext !== 'function'
    || typeof gitRuntime.refreshFreshness !== 'function'
  ) {
    throw new TypeError(
      'git must expose resolveContext() and refreshFreshness()',
    );
  }

  return {
    async handle(event) {
      if (!validUserPromptEvent(event)) return null;

      try {
        const context = await gitRuntime.resolveContext({ cwd: event.cwd });
        const explicitMemory = (
          explicitMemoryRequests
            ? parseExplicitMemoryPrompt(event.prompt)
            : null
        );

        if (explicitMemory?.mode === 'pipeline') {
          return {
            decision: 'block',
            reason: formatMemoryCandidatePipelineStatus(memory, {
              projectId,
              branch: context.branch,
            }),
          };
        }

        await gitRuntime.refreshFreshness({
          memory,
          projectId,
          branch: context.branch,
          revisionSha: context.revisionSha,
          repoPath: context.repoPath,
        });

        const requestPrefix = `codex:${event.session_id}:${event.turn_id}`;
        const evidenceId = `evidence:${requestPrefix}:prompt`;

        if (explicitMemory?.mode === 'list') {
          return {
            decision: 'block',
            reason: formatActiveDirectUserMemories(memory, {
              projectId,
              branch: context.branch,
              maxBytes: maxContextBytes,
            }),
          };
        }

        if (explicitMemory?.mode === 'candidates') {
          return {
            decision: 'block',
            reason: formatPendingMemoryCandidates(memory, {
              projectId,
              branch: context.branch,
              maxBytes: maxContextBytes,
            }),
          };
        }

        if (explicitMemory?.mode === 'explain') {
          if (diagnoseRecall === null) {
            return {
              decision: 'block',
              reason: 'Recall diagnostics unavailable for the current configuration.',
            };
          }

          try {
            const diagnostic = await diagnoseRecall({
              projectId,
              branch: context.branch,
              revisionSha: context.revisionSha,
              query: explicitMemory.query,
              mode: 'current',
              maxItems: 10,
            });
            return {
              decision: 'block',
              reason: formatRecallDiagnostics(diagnostic, {
                maxBytes: maxContextBytes,
              }),
            };
          } catch {
            return {
              decision: 'block',
              reason: 'Recall diagnostics unavailable: retrieval failed.',
            };
          }
        }

        const explicitCommandResult = explicitMemory === null
          ? null
          : {
              applied: false,
              targetMissing: false,
              alreadyFinalized: false,
            };

        const candidateProposal = (
          candidateCapture && explicitMemory === null
            ? classifyMemoryCandidatePrompt(event.prompt)
            : null
        );
        const duplicateCandidate = (
          candidateProposal !== null
          && typeof memory.findCandidateByFingerprint === 'function'
            ? memory.findCandidateByFingerprint({
                projectId,
                branch: context.branch,
                fingerprint: candidateProposal.fingerprint,
              })
            : null
        );
        const shouldCaptureCandidate = (
          candidateProposal !== null
          && duplicateCandidate === null
        );
        const shouldCapture = (
          capturePrompts
          || explicitMemory !== null
          || shouldCaptureCandidate
        );

        if (shouldCapture) {
          try {
            const capturedAt = clock();
            let capturedEvidence = null;

            if (
              explicitMemory
              && typeof memory.getEvidence === 'function'
            ) {
              capturedEvidence = memory.getEvidence(evidenceId);
            }

            if (capturedEvidence === null) {
              const metadata = {
                event_type: 'user_prompt',
                hook_event_name: 'UserPromptSubmit',
                turn_id: event.turn_id,
              };
              if (explicitMemory) {
                metadata.explicit_memory = true;
                if (
                  explicitMemory.mode === 'replace'
                  || explicitMemory.mode === 'forget'
                  || explicitMemory.mode === 'candidate_confirm'
                ) {
                  metadata.explicit_memory_mode = explicitMemory.mode;
                }
              }
              if (shouldCaptureCandidate) {
                metadata.candidate_capture = true;
                metadata.candidate_type = candidateProposal.type;
                metadata.candidate_policy = candidateProposal.policyVersion;
                metadata.candidate_rule = candidateProposal.decisionReason;
              }

              const captured = await protocol.handle({
                protocol: 'memory.protocol.v1',
                operation: 'capture_evidence',
                request_id: `${requestPrefix}:capture`,
                payload: {
                  id: evidenceId,
                  project_id: projectId,
                  harness: 'codex',
                  session_id: event.session_id,
                  source_kind: 'session',
                  source_ref: `session:${event.session_id}`,
                  captured_at: capturedAt,
                  branch: context.branch,
                  commit_sha: context.revisionSha,
                  path: null,
                  blob_oid: null,
                  content: event.prompt,
                  metadata,
                },
              });

              if (captured?.ok) {
                capturedEvidence = captured.result?.evidence ?? null;
              } else if (
                explicitMemory
                && typeof memory.getEvidence === 'function'
              ) {
                capturedEvidence = memory.getEvidence(evidenceId);
              }
            }

            if (
              shouldCaptureCandidate
              && capturedEvidence
              && typeof memory.recordCandidate === 'function'
            ) {
              memory.recordCandidate({
                id: `candidate:${requestPrefix}:prompt`,
                evidenceId: capturedEvidence.id,
                type: candidateProposal.type,
                proposedValue: capturedEvidence.content_redacted,
                decisionReason: candidateProposal.decisionReason,
                policyVersion: candidateProposal.policyVersion,
                fingerprint: candidateProposal.fingerprint,
                createdAt: capturedEvidence.captured_at ?? capturedAt,
              });
            }

            if (
              explicitMemory
              && capturedEvidence
              && nonEmptyString(capturedEvidence.content_redacted)
            ) {
              const parsedMemory = parseExplicitMemoryPrompt(
                capturedEvidence.content_redacted,
              );
              const claimId = `claim:${requestPrefix}:prompt`;
              const existingClaim = (
                typeof memory.getClaim === 'function'
                  ? memory.getClaim(claimId)
                  : null
              );

              if (existingClaim !== null && parsedMemory !== null) {
                explicitCommandResult.applied = true;
              }

              if (
                parsedMemory?.mode === 'candidate_confirm'
                && typeof memory.confirmCandidate === 'function'
              ) {
                const candidate = resolveScopedCandidateTarget(memory, {
                  projectId,
                  branch: context.branch,
                  ref: parsedMemory.candidateRef,
                });

                if (candidate === null) {
                  explicitCommandResult.targetMissing = true;
                } else {
                  const prior = (
                    typeof memory.getCandidateConfirmation === 'function'
                      ? memory.getCandidateConfirmation(candidate.id)
                      : null
                  );

                  if (prior !== null) {
                    const priorTargetRef = prior.related_claim_id
                      ? memoryClaimRef(prior.related_claim_id)
                      : null;
                    if (
                      prior.relation === parsedMemory.relation
                      && priorTargetRef === parsedMemory.targetRef
                    ) {
                      explicitCommandResult.applied = true;
                    } else {
                      explicitCommandResult.alreadyFinalized = true;
                    }
                  } else if (!isExplicitlyConfirmableCandidate(candidate)) {
                    explicitCommandResult.targetMissing = true;
                  } else {
                    const target = parsedMemory.targetRef === null
                      ? null
                      : resolveActiveDirectUserMemoryTarget(memory, {
                          projectId,
                          branch: context.branch,
                          ref: parsedMemory.targetRef,
                        });

                    if (
                      parsedMemory.targetRef !== null
                      && target === null
                    ) {
                      explicitCommandResult.targetMissing = true;
                    } else {
                      confirmMemoryCandidate({
                        memory,
                        projectId,
                        branch: context.branch,
                        candidateId: candidate.id,
                        relation: parsedMemory.relation,
                        targetClaimId: target?.id ?? null,
                        confirmationEvidenceId: capturedEvidence.id,
                        now: () => capturedEvidence.captured_at ?? capturedAt,
                      });
                      explicitCommandResult.applied = true;
                    }
                  }
                }
              }

              if (
                existingClaim === null
                && parsedMemory !== null
                && parsedMemory.mode !== 'candidate_confirm'
              ) {
                let value = capturedEvidence.content_redacted;
                let kind = 'user_direct';
                let predicate = 'states';
                let state = null;
                let supersedes = [];
                let rejects = [];

                if (parsedMemory.mode === 'replace') {
                  const target = resolveActiveDirectUserMemoryTarget(memory, {
                    projectId,
                    branch: context.branch,
                    value: parsedMemory.oldValue ?? null,
                    ref: parsedMemory.oldRef ?? null,
                  });
                  if (target === null) {
                    value = null;
                    explicitCommandResult.targetMissing = true;
                  } else {
                    value = parsedMemory.newValue;
                    supersedes = [target.id];
                  }
                } else if (parsedMemory.mode === 'forget') {
                  const target = resolveActiveDirectUserMemoryTarget(memory, {
                    projectId,
                    branch: context.branch,
                    value: parsedMemory.value ?? null,
                    ref: parsedMemory.ref ?? null,
                  });
                  if (target === null) {
                    value = null;
                    explicitCommandResult.targetMissing = true;
                  } else {
                    value = target.value_text;
                    kind = 'memory_control';
                    predicate = 'forgets';
                    state = 'expired';
                    rejects = [target.id];
                  }
                }

                if (nonEmptyString(value)) {
                  const claim = {
                    id: claimId,
                    kind,
                    subject: 'user memory',
                    predicate,
                    value,
                    branch_scope: context.branch,
                    created_at: (
                      capturedEvidence.captured_at ?? capturedAt
                    ),
                  };
                  if (state !== null) claim.state = state;

                  const asserted = await protocol.handle({
                    protocol: 'memory.protocol.v1',
                    operation: 'assert_claim',
                    request_id: `${requestPrefix}:claim`,
                    payload: {
                      evidence_id: evidenceId,
                      claim,
                      lifecycle: {
                        supersedes,
                        rejects,
                        conflicts_with: [],
                      },
                    },
                  });
                  if (asserted?.ok === true) {
                    explicitCommandResult.applied = true;
                  }
                }
              }
            }
          } catch {
            // Evidence/Claim persistence is optional and must never block recall.
          }
        }

        if (explicitMemory !== null) {
          let reason = 'Memory not changed: operation failed.';
          if (explicitCommandResult?.applied === true) {
            if (explicitMemory.mode === 'remember') {
              reason = 'Memory stored for the current project and branch.';
            } else if (explicitMemory.mode === 'replace') {
              reason = 'Memory replaced for the current project and branch.';
            } else if (explicitMemory.mode === 'forget') {
              reason = 'Memory forgotten for the current project and branch.';
            } else if (explicitMemory.mode === 'candidate_confirm') {
              reason = 'Memory candidate confirmed for the current project and branch.';
            }
          } else if (explicitCommandResult?.alreadyFinalized === true) {
            reason = 'Memory candidate not changed: it was already confirmed with a different action.';
          } else if (explicitCommandResult?.targetMissing === true) {
            reason = explicitMemory.mode === 'candidate_confirm'
              ? 'Memory candidate not changed: candidate or target memory was not found or was not unique in the current project and branch.'
              : 'Memory not changed: target was not found or was not unique in the current project and branch.';
          }

          return {
            decision: 'block',
            reason,
          };
        }

        const recalled = await protocol.handle({
          protocol: 'memory.protocol.v1',
          operation: 'recall',
          request_id: `${requestPrefix}:recall`,
          payload: {
            project_id: projectId,
            branch: context.branch,
            revision_sha: context.revisionSha,
            query: event.prompt,
            max_items: 10,
            max_serialized_bytes: 16_384,
          },
        });
        if (!recalled?.ok) return null;

        const reliance = evaluateReliance({
          items: recalled.result?.items ?? [],
          conflicts: recalled.result?.conflicts ?? [],
          use: 'answer',
        });
        const additionalContext = formatCodexMemoryContext(
          {
            items: reliance.selected,
            conflicts: reliance.conflict_resolutions.filter(
              (conflict) => String(conflict.status).startsWith('unresolved'),
            ),
          },
          { maxBytes: maxContextBytes },
        );
        if (!additionalContext) return null;

        return {
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext,
          },
        };
      } catch {
        return null;
      }
    },
  };
}
