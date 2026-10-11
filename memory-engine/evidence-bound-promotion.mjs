import { EvidenceBoundProposalStore } from './evidence-bound-proposal-store.mjs';

export const EVIDENCE_PROMOTION_POLICY_VERSION = 'evidence-promotion-v1';

const ELIGIBLE_AUTHORITIES = new Set([
  'user_direct',
  'repo_trusted',
  'tool_observation',
]);

const PRIMARY_AUTHORITY_RANK = new Map([
  ['tool_observation', 0],
  ['repo_trusted', 1],
  ['user_direct', 1],
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort(compareText);
  const rightSorted = [...right].sort(compareText);
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

export function evidencePromotionClaimId(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new TypeError('proposal must be an object');
  }
  if (!/^[0-9a-f]{64}$/u.test(proposal.fingerprint ?? '')) {
    throw new TypeError('proposal fingerprint must be a lowercase SHA-256 hex digest');
  }
  return 'evidence-memory:' + proposal.fingerprint;
}

function sourceSetFromArgs({ sourceEvidence, sourceEvidenceSet }) {
  if (Array.isArray(sourceEvidenceSet)) return sourceEvidenceSet;
  return sourceEvidence ? [sourceEvidence] : [];
}

function targetSetFromArgs({ targetEvidence, targetEvidenceSet }) {
  if (Array.isArray(targetEvidenceSet)) return targetEvidenceSet;
  return targetEvidence ? [targetEvidence] : [];
}

function validateSourceSet(proposal, sourceEvidenceSet) {
  if (
    !Array.isArray(proposal.evidence_ids)
    || proposal.evidence_ids.length < 1
    || proposal.evidence_ids.length > 10
  ) {
    throw new Error('evidence promotion requires between one and ten evidence sources');
  }
  if (
    !Array.isArray(sourceEvidenceSet)
    || sourceEvidenceSet.length !== proposal.evidence_ids.length
  ) {
    throw new Error('proposal source evidence set is incomplete');
  }

  const expectedIds = [...proposal.evidence_ids].sort(compareText);
  const actualIds = sourceEvidenceSet.map((item) => item?.id).sort(compareText);
  if (!sameStringSet(expectedIds, actualIds)) {
    throw new Error('proposal source evidence invariant failed');
  }

  for (const sourceEvidence of sourceEvidenceSet) {
    if (!sourceEvidence || typeof sourceEvidence !== 'object') {
      throw new Error('proposal source evidence is missing');
    }
    if (
      sourceEvidence.project_id !== proposal.project_id
      || sourceEvidence.branch !== proposal.branch
      || sourceEvidence.sensitivity === 'secret_redacted'
      || !ELIGIBLE_AUTHORITIES.has(sourceEvidence.authority_class)
    ) {
      throw new Error('proposal source evidence invariant failed');
    }
    if (
      sourceEvidence.authority_class === 'tool_observation'
      && sourceEvidence.metadata?.tool_outcome === 'failure'
    ) {
      throw new Error('failed tool observation cannot be promoted');
    }
  }

  const actualAuthorities = [...new Set(
    sourceEvidenceSet.map((item) => item.authority_class),
  )].sort(compareText);
  if (
    !Array.isArray(proposal.authorities)
    || !sameStringSet(proposal.authorities, actualAuthorities)
  ) {
    throw new Error('proposal source authority invariant failed');
  }
  if (
    proposal.kind === 'preference'
    && sourceEvidenceSet.some((item) => item.authority_class !== 'user_direct')
  ) {
    throw new Error('preference promotion requires only user_direct evidence');
  }
}

function choosePrimaryEvidence(sourceEvidenceSet) {
  return [...sourceEvidenceSet].sort((left, right) => (
    (PRIMARY_AUTHORITY_RANK.get(left.authority_class) ?? 99)
      - (PRIMARY_AUTHORITY_RANK.get(right.authority_class) ?? 99)
    || compareText(left.id, right.id)
  ))[0];
}

function validateTarget(proposal, targetClaim, targetEvidenceSet) {
  if (proposal.relation.relation === 'unrelated') {
    if (
      proposal.related_claim_id !== null
      || targetClaim !== null
      || targetEvidenceSet.length !== 0
    ) {
      throw new Error('unrelated proposal cannot have relation target');
    }
    return;
  }
  if (!nonEmptyString(proposal.related_claim_id)) {
    throw new Error('related proposal requires related claim id');
  }
  if (!targetClaim || targetEvidenceSet.length < 1) {
    throw new Error('related proposal target provenance is missing');
  }

  const normalized = targetEvidenceSet.map((row) => row.evidence ?? row);
  const primaryMatches = normalized.filter(
    (row) => row.id === targetClaim.created_from_evidence_id,
  );
  const explicitPrimaryRows = targetEvidenceSet.filter(
    (row) => row?.role === 'primary',
  );
  const explicitPrimaryValid = (
    explicitPrimaryRows.length === 0
    || (
      explicitPrimaryRows.length === 1
      && explicitPrimaryRows[0].evidence?.id === targetClaim.created_from_evidence_id
    )
  );

  if (
    targetClaim.id !== proposal.related_claim_id
    || targetClaim.project_id !== proposal.project_id
    || targetClaim.branch_scope !== proposal.branch
    || targetClaim.state !== 'active'
    || primaryMatches.length !== 1
    || !explicitPrimaryValid
    || normalized.some((row) => (
      !row
      || row.project_id !== proposal.project_id
      || !ELIGIBLE_AUTHORITIES.has(row.authority_class)
    ))
  ) {
    throw new Error('related proposal target invariant failed');
  }
}

function hasUnsafeToolOutcome(sourceEvidenceSet) {
  return sourceEvidenceSet.some((sourceEvidence) => (
    sourceEvidence.authority_class === 'tool_observation'
    && sourceEvidence.metadata?.tool_outcome !== 'success'
  ));
}

function evidenceAuthoritySet(evidenceSet) {
  return [...new Set(evidenceSet.map((item) => (
    (item.evidence ?? item).authority_class
  )))].sort(compareText);
}

function evidenceIdSet(evidenceSet) {
  return evidenceSet.map((item) => (item.evidence ?? item).id).sort(compareText);
}

function hasPathGrounding(evidenceSet) {
  return evidenceSet.some((item) => nonEmptyString((item.evidence ?? item).path));
}

export function resolveEvidenceBoundPromotion({
  proposal,
  sourceEvidence = null,
  sourceEvidenceSet = null,
  targetClaim = null,
  targetEvidence = null,
  targetEvidenceSet = null,
  finalizedAt,
}) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new TypeError('proposal must be an object');
  }
  if (!nonEmptyString(finalizedAt)) {
    throw new TypeError('finalizedAt must be a non-empty string');
  }
  if (
    proposal.status !== 'pending'
    || proposal.importance?.decision !== 'promote'
    || proposal.support?.decision !== 'supported'
    || !proposal.relation
  ) {
    throw new Error('evidence proposal is not promotion-ready');
  }

  const sources = sourceSetFromArgs({ sourceEvidence, sourceEvidenceSet });
  const targets = targetSetFromArgs({ targetEvidence, targetEvidenceSet });
  validateSourceSet(proposal, sources);
  validateTarget(proposal, targetClaim, targets);

  const relation = proposal.relation;
  const primaryEvidence = choosePrimaryEvidence(sources);
  const sourceEvidenceIds = [
    primaryEvidence.id,
    ...sources.map((item) => item.id)
      .filter((id) => id !== primaryEvidence.id)
      .sort(compareText),
  ];
  const base = {
    relation: relation.relation,
    related_claim_id: targetClaim?.id ?? null,
    claim: null,
    lifecycle: null,
    primary_evidence_id: primaryEvidence.id,
    evidence_ids: sourceEvidenceIds,
  };

  if (hasUnsafeToolOutcome(sources)) {
    return {
      ...base,
      status: 'needs_confirmation',
    };
  }

  if (relation.confidence !== 'high' || relation.meaning_preserved !== true) {
    return {
      ...base,
      status: 'needs_confirmation',
    };
  }

  if (relation.relation === 'same') {
    const targetRows = targets.map((item) => item.evidence ?? item);
    const distinctPathGroundedEvidence = (
      (hasPathGrounding(sources) || hasPathGrounding(targetRows))
      && !sameStringSet(
        sources.map((item) => item.id),
        targetRows.map((item) => item.id),
      )
    );
    if (
      !sameStringSet(
        evidenceAuthoritySet(sources),
        evidenceAuthoritySet(targetRows),
      )
      || distinctPathGroundedEvidence
    ) {
      return {
        ...base,
        status: 'needs_confirmation',
      };
    }
    return {
      ...base,
      status: 'superseded',
    };
  }

  if (relation.relation === 'update' || relation.relation === 'contradict') {
    return {
      ...base,
      status: 'needs_confirmation',
    };
  }

  const allUserDirect = sources.every(
    (item) => item.authority_class === 'user_direct',
  );
  const claim = {
    id: evidencePromotionClaimId(proposal),
    kind: allUserDirect ? 'user_direct' : proposal.kind,
    subject: allUserDirect ? 'user memory' : 'evidence memory',
    predicate: 'states',
    value: proposal.canonical_fact,
    state: 'active',
    branchScope: proposal.branch,
    createdAt: finalizedAt,
  };
  return {
    ...base,
    status: 'promoted',
    claim,
    lifecycle: {},
  };
}

function assertMemory(memory) {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  for (const method of ['getEvidence', 'getClaim', 'getClaimEvidence', 'assertClaim']) {
    if (typeof memory[method] !== 'function') {
      throw new TypeError('memory must support ' + method);
    }
  }
}

function validateExistingClaim(existing, {
  proposal,
  sourceEvidenceSet,
  primaryEvidence,
  expectedClaim,
  memory,
}) {
  if (
    !existing
    || existing.id !== expectedClaim.id
    || existing.project_id !== proposal.project_id
    || existing.branch_scope !== proposal.branch
    || existing.kind !== expectedClaim.kind
    || existing.subject !== expectedClaim.subject
    || existing.predicate !== expectedClaim.predicate
    || existing.value !== expectedClaim.value
    || existing.created_from_evidence_id !== primaryEvidence.id
  ) {
    throw new Error('pre-existing deterministic evidence claim invariant failed');
  }

  const existingProvenance = memory.getClaimEvidence(existing.id);
  const existingIds = existingProvenance.map((row) => row.evidence?.id).filter(Boolean);
  if (
    existingProvenance.filter((row) => row.role === 'primary').length !== 1
    || existingProvenance.find((row) => row.role === 'primary')?.evidence?.id !== primaryEvidence.id
    || !sameStringSet(existingIds, sourceEvidenceSet.map((item) => item.id))
  ) {
    throw new Error('pre-existing deterministic evidence claim provenance invariant failed');
  }
}

export async function runEvidenceBoundPromotionPipeline({
  dbPath,
  memory,
  projectId,
  branch,
  inspectTextSensitivity,
  clock = () => new Date().toISOString(),
  limit = 20,
}) {
  assertMemory(memory);
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }

  const store = new EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity,
    clock,
  });
  try {
    const proposals = store.listPromotionReady({ projectId, branch, limit });
    const results = [];
    let promoted = 0;
    let superseded = 0;
    let needsConfirmation = 0;
    let failed = 0;

    for (const proposal of proposals) {
      try {
        const sourceEvidenceSet = proposal.evidence_ids.map(
          (evidenceId) => memory.getEvidence(evidenceId),
        );
        let targetClaim = null;
        let targetEvidenceSet = [];
        if (proposal.related_claim_id !== null) {
          targetClaim = memory.getClaim(proposal.related_claim_id);
          if (targetClaim) {
            targetEvidenceSet = memory.getClaimEvidence(targetClaim.id);
          }
        }

        const finalizedAt = clock();
        const resolved = resolveEvidenceBoundPromotion({
          proposal,
          sourceEvidenceSet,
          targetClaim,
          targetEvidenceSet,
          finalizedAt,
        });

        let claimId = null;
        if (resolved.status === 'promoted') {
          claimId = resolved.claim.id;
          const primaryEvidence = sourceEvidenceSet.find(
            (item) => item?.id === resolved.primary_evidence_id,
          );
          const existing = memory.getClaim(claimId);
          if (existing) {
            validateExistingClaim(existing, {
              proposal,
              sourceEvidenceSet,
              primaryEvidence,
              expectedClaim: resolved.claim,
              memory,
            });
          } else {
            const asserted = memory.assertClaim({
              evidenceId: resolved.primary_evidence_id,
              evidenceIds: resolved.evidence_ids,
              claim: resolved.claim,
              lifecycle: resolved.lifecycle,
            });
            validateExistingClaim(asserted?.claim, {
              proposal,
              sourceEvidenceSet,
              primaryEvidence,
              expectedClaim: resolved.claim,
              memory,
            });
          }
        }

        const audit = {
          status: resolved.status,
          relation: resolved.relation,
          claim_id: claimId,
          related_claim_id: resolved.related_claim_id,
        };
        store.finalizePromotion({
          proposalId: proposal.id,
          status: resolved.status,
          claimId,
          relatedClaimId: resolved.related_claim_id,
          policyVersion: EVIDENCE_PROMOTION_POLICY_VERSION,
          finalizedAt,
          result: audit,
        });

        if (resolved.status === 'promoted') promoted += 1;
        else if (resolved.status === 'superseded') superseded += 1;
        else needsConfirmation += 1;

        results.push({
          proposal_id: proposal.id,
          ok: true,
          ...audit,
        });
      } catch (error) {
        failed += 1;
        results.push({
          proposal_id: proposal.id,
          ok: false,
          status: proposal.status,
          relation: proposal.relation?.relation ?? null,
          claim_id: null,
          related_claim_id: proposal.related_claim_id,
          error: errorMessage(error),
        });
      }
    }

    return {
      total: proposals.length,
      promoted,
      superseded,
      needs_confirmation: needsConfirmation,
      failed,
      results,
    };
  } finally {
    store.close();
  }
}
