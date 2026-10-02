export const MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES = Object.freeze([
  Object.freeze({
    id: 'new-durable-fact',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([]),
    prompt: 'We decided to retain release audit logs for 45 days.',
    expected: Object.freeze({
      candidate_status: 'promoted',
      relation: 'unrelated',
      current_active_claim_delta: 1,
      other_active_claim_delta: 0,
      current_active_claims_after_second_run: 1,
      other_active_claims_after_second_run: 0,
      second_run_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      relation_judge_calls: 0,
      first_run_failed_stages: Object.freeze([]),
    }),
  }),
  Object.freeze({
    id: 'same-existing-memory',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([
      Object.freeze({
        branch: 'main',
        value: 'The production database is Postgres.',
      }),
    ]),
    prompt: 'We decided to use Postgres as the production database.',
    expected: Object.freeze({
      candidate_status: 'superseded',
      relation: 'same',
      current_active_claim_delta: 0,
      other_active_claim_delta: 0,
      current_active_claims_after_second_run: 1,
      other_active_claims_after_second_run: 0,
      second_run_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      relation_judge_calls: 1,
      first_run_failed_stages: Object.freeze([]),
    }),
  }),
  Object.freeze({
    id: 'update-existing-memory',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([
      Object.freeze({
        branch: 'main',
        value: 'The production database uses SQLite.',
      }),
    ]),
    prompt: 'Correction: the production database now uses Postgres instead of SQLite.',
    expected: Object.freeze({
      candidate_status: 'promoted',
      relation: 'update',
      current_active_claim_delta: 0,
      other_active_claim_delta: 0,
      current_active_claims_after_second_run: 1,
      other_active_claims_after_second_run: 0,
      second_run_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      relation_judge_calls: 1,
      first_run_failed_stages: Object.freeze([]),
      target_claim_state_after_first_run: 'superseded',
      promotion_claim_state_after_first_run: 'active',
      target_superseded_by_promotion_claim: true,
      open_conflicts_after_first_run: 0,
    }),
  }),
  Object.freeze({
    id: 'contradict-existing-memory',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([
      Object.freeze({
        branch: 'main',
        value: 'The production database must use SQLite.',
      }),
    ]),
    prompt: 'We must use Postgres as the production database.',
    expected: Object.freeze({
      candidate_status: 'promoted',
      relation: 'contradict',
      current_active_claim_delta: 1,
      other_active_claim_delta: 0,
      current_active_claims_after_second_run: 2,
      other_active_claims_after_second_run: 0,
      second_run_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      relation_judge_calls: 1,
      first_run_failed_stages: Object.freeze([]),
      target_claim_state_after_first_run: 'active',
      promotion_claim_state_after_first_run: 'active',
      target_superseded_by_promotion_claim: false,
      open_conflicts_after_first_run: 1,
      open_conflict_links_target_and_promotion_claim: true,
    }),
  }),
  Object.freeze({
    id: 'cross-branch-isolation',
    branch: 'main',
    other_branch: 'other',
    seed_memories: Object.freeze([
      Object.freeze({
        branch: 'other',
        value: 'The production database is Postgres.',
      }),
    ]),
    prompt: 'We decided to use Postgres as the production database.',
    expected: Object.freeze({
      candidate_status: 'promoted',
      relation: 'unrelated',
      current_active_claim_delta: 1,
      other_active_claim_delta: 0,
      current_active_claims_after_second_run: 1,
      other_active_claims_after_second_run: 1,
      second_run_ready: Object.freeze({
        importance: 0,
        relation: 0,
        promotion: 0,
      }),
      relation_judge_calls: 0,
      first_run_failed_stages: Object.freeze([]),
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

export function scoreMemoryCandidatePipelineBehavioralCase(
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

export async function runMemoryCandidatePipelineBehavioralCases({
  cases = MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES,
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
      const scored = scoreMemoryCandidatePipelineBehavioralCase(
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
