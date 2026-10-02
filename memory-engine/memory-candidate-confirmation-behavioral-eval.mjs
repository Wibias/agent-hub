export const MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES = Object.freeze([
  Object.freeze({
    id: 'confirm-unrelated',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([]),
    prompt: 'We decided to retain release audit logs for 45 days.',
    pipeline: Object.freeze({
      importance: 'needs_confirmation',
      relation: null,
    }),
    confirmation: Object.freeze({
      relation: 'unrelated',
      target_branch: null,
    }),
    expected: Object.freeze({
      confirmation_applied: true,
      candidate_status: 'promoted',
      current_active_claims: 1,
      current_superseded_claims: 0,
      other_active_claims: 0,
      open_conflicts: 0,
      supersede_events: 0,
      confirmation_evidence_count_delta: 1,
      confirmation_audit_count: 1,
      same_retry_changed_state: false,
      final_pipeline_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      confirmation_model_calls: 0,
    }),
  }),
  Object.freeze({
    id: 'confirm-same',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([
      Object.freeze({
        branch: 'main',
        value: 'The production database is Postgres.',
      }),
    ]),
    prompt: 'We decided to use Postgres as the production database.',
    pipeline: Object.freeze({
      importance: 'promote',
      relation: 'same',
    }),
    confirmation: Object.freeze({
      relation: 'same',
      target_branch: 'main',
    }),
    expected: Object.freeze({
      confirmation_applied: true,
      candidate_status: 'superseded',
      current_active_claims: 1,
      current_superseded_claims: 0,
      other_active_claims: 0,
      open_conflicts: 0,
      supersede_events: 0,
      confirmation_evidence_count_delta: 1,
      confirmation_audit_count: 1,
      same_retry_changed_state: false,
      final_pipeline_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      confirmation_model_calls: 0,
    }),
  }),
  Object.freeze({
    id: 'confirm-update',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([
      Object.freeze({
        branch: 'main',
        value: 'Production deployments require two approvals.',
      }),
    ]),
    prompt: 'We decided to require three approvals for production deployments instead of two.',
    pipeline: Object.freeze({
      importance: 'promote',
      relation: 'update',
    }),
    confirmation: Object.freeze({
      relation: 'update',
      target_branch: 'main',
    }),
    expected: Object.freeze({
      confirmation_applied: true,
      candidate_status: 'promoted',
      current_active_claims: 1,
      current_superseded_claims: 1,
      other_active_claims: 0,
      open_conflicts: 0,
      supersede_events: 1,
      confirmation_evidence_count_delta: 1,
      confirmation_audit_count: 1,
      same_retry_changed_state: false,
      final_pipeline_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      confirmation_model_calls: 0,
    }),
  }),
  Object.freeze({
    id: 'confirm-contradict',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([
      Object.freeze({
        branch: 'main',
        value: 'Production deployments require two approvals.',
      }),
    ]),
    prompt: 'We must require one approval for production deployments.',
    pipeline: Object.freeze({
      importance: 'promote',
      relation: 'contradict',
    }),
    confirmation: Object.freeze({
      relation: 'contradict',
      target_branch: 'main',
    }),
    expected: Object.freeze({
      confirmation_applied: true,
      candidate_status: 'promoted',
      current_active_claims: 2,
      current_superseded_claims: 0,
      other_active_claims: 0,
      open_conflicts: 1,
      supersede_events: 0,
      confirmation_evidence_count_delta: 1,
      confirmation_audit_count: 1,
      same_retry_changed_state: false,
      final_pipeline_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      confirmation_model_calls: 0,
    }),
  }),
  Object.freeze({
    id: 'unknown-candidate-ref',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([]),
    prompt: 'We decided to retain release audit logs for 45 days.',
    pipeline: Object.freeze({
      importance: 'needs_confirmation',
      relation: null,
    }),
    confirmation: Object.freeze({
      relation: 'unrelated',
      target_branch: null,
      candidate_ref_override: '~0000000000',
    }),
    expected: Object.freeze({
      confirmation_applied: false,
      confirmation_reason: 'Memory candidate not changed: candidate or target memory was not found or was not unique in the current project and branch.',
      candidate_status: 'needs_confirmation',
      current_active_claims: 0,
      current_superseded_claims: 0,
      other_active_claims: 0,
      open_conflicts: 0,
      supersede_events: 0,
      confirmation_evidence_count_delta: 1,
      confirmation_audit_count: 0,
      final_pipeline_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      confirmation_model_calls: 0,
    }),
  }),
  Object.freeze({
    id: 'cross-branch-target',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([
      Object.freeze({
        branch: 'other',
        value: 'Production deployments require two approvals.',
      }),
    ]),
    prompt: 'We decided to require three approvals for production deployments instead of two.',
    pipeline: Object.freeze({
      importance: 'needs_confirmation',
      relation: null,
    }),
    confirmation: Object.freeze({
      relation: 'update',
      target_branch: 'other',
    }),
    expected: Object.freeze({
      confirmation_applied: false,
      confirmation_reason: 'Memory candidate not changed: candidate or target memory was not found or was not unique in the current project and branch.',
      candidate_status: 'needs_confirmation',
      current_active_claims: 0,
      current_superseded_claims: 0,
      other_active_claims: 1,
      open_conflicts: 0,
      supersede_events: 0,
      confirmation_evidence_count_delta: 1,
      confirmation_audit_count: 0,
      final_pipeline_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      confirmation_model_calls: 0,
    }),
  }),
]);

function stableJson(value) {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableJson(item)).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableJson(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

export function scoreMemoryCandidateConfirmationBehavioralCase(
  caseSpec,
  observed,
) {
  if (!caseSpec?.expected || typeof caseSpec.expected !== 'object') {
    throw new TypeError('caseSpec.expected must be an object');
  }
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) {
    throw new TypeError('observed must be an object');
  }

  const failures = [];
  for (const [field, expected] of Object.entries(caseSpec.expected)) {
    const actual = observed[field];
    if (stableJson(actual) !== stableJson(expected)) {
      failures.push(
        field
        + ' expected '
        + stableJson(expected)
        + ' but received '
        + stableJson(actual),
      );
    }
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

export async function runMemoryCandidateConfirmationBehavioralCases({
  cases = MEMORY_CANDIDATE_CONFIRMATION_BEHAVIORAL_CASES,
  runCase,
} = {}) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new TypeError('cases must be a non-empty array');
  }
  if (typeof runCase !== 'function') {
    throw new TypeError('runCase must be a function');
  }

  const results = [];
  for (const caseSpec of cases) {
    try {
      const observed = await runCase(caseSpec);
      const scored = scoreMemoryCandidateConfirmationBehavioralCase(
        caseSpec,
        observed,
      );
      results.push({
        id: caseSpec.id,
        expected: caseSpec.expected,
        observed,
        pass: scored.pass,
        failures: scored.failures,
      });
    } catch (error) {
      results.push({
        id: caseSpec.id,
        expected: caseSpec.expected,
        observed: null,
        pass: false,
        failures: [
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  }

  const passedCases = results.filter((item) => item.pass).length;
  return {
    pass: passedCases === results.length,
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    cases: results,
  };
}
