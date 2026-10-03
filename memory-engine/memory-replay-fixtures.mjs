import {
  classifyAgentDecisionMessage,
} from './agent-decision-capture.mjs';
import {
  classifyMemoryCandidatePrompt,
} from './memory-capture-policy.mjs';

function freezeCase(value) {
  return Object.freeze({
    ...value,
    tags: Object.freeze([...(value.tags ?? [])]),
  });
}

export const MEMORY_REPLAY_FIXTURE_VERSION = 'replay-v1';

export const USER_MEMORY_REPLAY_CASES = Object.freeze([
  freezeCase({
    id: 'user-transient-continue',
    input: 'Continue.',
    expected_capture: false,
    expected_importance: null,
    tags: ['historical_pattern', 'status_chatter'],
  }),
  freezeCase({
    id: 'user-current-ci-status',
    input: 'The current CI run is red because one test is failing.',
    expected_capture: false,
    expected_importance: null,
    tags: ['historical_pattern', 'current_run_status'],
  }),
  freezeCase({
    id: 'user-temporary-smoke-decision',
    input: 'We decided to use JSON Lines for this one temporary smoke test.',
    expected_capture: true,
    expected_importance: 'ignore',
    tags: ['historical_pattern', 'temporary', 'false_promotion_guard'],
  }),
  freezeCase({
    id: 'user-durable-database-decision',
    input: 'We decided to use Postgres as the production database across future sessions.',
    expected_capture: true,
    expected_importance: 'promote',
    tags: ['durable', 'positive_control'],
  }),
  freezeCase({
    id: 'user-tentative-cache',
    input: 'Maybe we should use Redis for caching.',
    expected_capture: false,
    expected_importance: null,
    tags: ['tentative', 'false_positive_guard'],
  }),
  freezeCase({
    id: 'user-reconstructible-package-version',
    input: 'Known issue: package.json currently contains version 2.4.1.',
    expected_capture: true,
    expected_importance: 'ignore',
    tags: ['reconstructible_from_repo', 'false_promotion_guard'],
  }),
  freezeCase({
    id: 'user-scope-unclear-private-choice',
    input: 'We decided to keep that private for future releases.',
    expected_capture: true,
    expected_importance: 'needs_confirmation',
    tags: ['scope_unclear', 'confirmation_guard'],
  }),
]);

export const AGENT_MEMORY_REPLAY_CASES = Object.freeze([
  freezeCase({
    id: 'agent-declarative-not-commitment',
    input: 'For the current branch, the temporary smoke-test serialization format is JSON Lines.',
    expected_capture: false,
    expected_importance: null,
    tags: ['historical_pattern', 'declarative_only'],
  }),
  freezeCase({
    id: 'agent-explicit-temporary-smoke',
    input: 'Decision: use JSON Lines for this temporary smoke test only.',
    expected_capture: true,
    expected_importance: 'ignore',
    tags: ['historical_pattern', 'temporary', 'false_promotion_guard'],
  }),
  freezeCase({
    id: 'agent-durable-windows-hook',
    input: 'Decision: use PowerShell EncodedCommand for Windows commandWindows hook dispatch across future sessions.',
    expected_capture: true,
    expected_importance: 'promote',
    tags: ['durable', 'positive_control'],
  }),
  freezeCase({
    id: 'agent-tentative-hook',
    input: 'I might switch the Windows hook wrapper to cmd.exe.',
    expected_capture: false,
    expected_importance: null,
    tags: ['tentative', 'false_positive_guard'],
  }),
  freezeCase({
    id: 'agent-current-test-status',
    input: 'Decision: tests are green now.',
    expected_capture: true,
    expected_importance: 'ignore',
    tags: ['current_run_status', 'false_promotion_guard'],
  }),
  freezeCase({
    id: 'agent-reconstructible-version',
    input: 'Decision: keep using the package version currently recorded in package.json.',
    expected_capture: true,
    expected_importance: 'ignore',
    tags: ['reconstructible_from_repo', 'false_promotion_guard'],
  }),
]);

function captureCase(caseSpec, authority) {
  if (authority === 'user_direct') {
    const candidate = classifyMemoryCandidatePrompt(caseSpec.input);
    return {
      captured: candidate !== null,
      candidate,
    };
  }
  const candidates = classifyAgentDecisionMessage(caseSpec.input, {
    agentType: 'root',
  });
  return {
    captured: candidates.length > 0,
    candidate: candidates[0] ?? null,
  };
}

export function replayCaptureReachability() {
  const summarize = (cases, authority) => cases.map((caseSpec) => {
    const capture = captureCase(caseSpec, authority);
    return {
      id: caseSpec.id,
      authority,
      expected_capture: caseSpec.expected_capture,
      observed_capture: capture.captured,
      expected_importance: caseSpec.expected_importance,
      candidate_type: capture.candidate?.type ?? null,
      capture_policy: capture.candidate?.policyVersion ?? null,
      pass: capture.captured === caseSpec.expected_capture,
    };
  });

  const cases = [
    ...summarize(USER_MEMORY_REPLAY_CASES, 'user_direct'),
    ...summarize(AGENT_MEMORY_REPLAY_CASES, 'agent_inference'),
  ];
  const failed = cases.filter((item) => !item.pass);
  return {
    version: MEMORY_REPLAY_FIXTURE_VERSION,
    total: cases.length,
    passed: cases.length - failed.length,
    failed: failed.length,
    pass: failed.length === 0,
    failures: failed.map((item) => item.id),
    cases,
  };
}

export function scoreMemoryReplayImportance({
  userPredictions = [],
  agentPredictions = [],
} = {}) {
  const scoreAuthority = (cases, predictions, authority) => {
    const byId = new Map(predictions.map((item) => [item.id, item]));
    let evaluated = 0;
    let correct = 0;
    let falsePromotions = 0;
    const failures = [];

    for (const caseSpec of cases) {
      if (!caseSpec.expected_capture || caseSpec.expected_importance === null) {
        continue;
      }
      evaluated += 1;
      const prediction = byId.get(caseSpec.id);
      const observed = prediction?.decision ?? null;
      if (prediction?.ok === true && observed === caseSpec.expected_importance) {
        correct += 1;
      } else {
        failures.push({
          id: caseSpec.id,
          expected: caseSpec.expected_importance,
          observed,
        });
      }
      if (
        prediction?.ok === true
        && observed === 'promote'
        && caseSpec.expected_importance !== 'promote'
      ) {
        falsePromotions += 1;
      }
    }

    return {
      authority,
      evaluated,
      correct,
      accuracy: evaluated === 0 ? null : correct / evaluated,
      false_promotions: falsePromotions,
      failures,
    };
  };

  const user = scoreAuthority(
    USER_MEMORY_REPLAY_CASES,
    userPredictions,
    'user_direct',
  );
  const agent = scoreAuthority(
    AGENT_MEMORY_REPLAY_CASES,
    agentPredictions,
    'agent_inference',
  );
  return {
    version: MEMORY_REPLAY_FIXTURE_VERSION,
    capture: replayCaptureReachability(),
    user,
    agent,
    quality_gate: {
      pass: (
        replayCaptureReachability().pass
        && user.false_promotions === 0
        && agent.false_promotions === 0
        && user.failures.length === 0
        && agent.failures.length === 0
      ),
      failures: [
        ...replayCaptureReachability().failures.map(
          (id) => 'capture:' + id,
        ),
        ...user.failures.map((item) => 'user:' + item.id),
        ...agent.failures.map((item) => 'agent:' + item.id),
      ],
    },
  };
}
