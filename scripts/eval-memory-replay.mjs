#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGENT_DECISION_IMPORTANCE_POLICY_VERSION,
  buildAgentDecisionImportancePrompt,
} from '../memory-engine/agent-decision-judge.mjs';
import {
  classifyAgentDecisionMessage,
} from '../memory-engine/agent-decision-capture.mjs';
import {
  classifyMemoryCandidatePrompt,
} from '../memory-engine/memory-capture-policy.mjs';
import {
  parseMemoryCandidateJudgment,
} from '../memory-engine/memory-candidate-judge.mjs';
import {
  AGENT_MEMORY_REPLAY_CASES,
  MEMORY_REPLAY_FIXTURE_VERSION,
  replayCaptureReachability,
  scoreMemoryReplayImportance,
  USER_MEMORY_REPLAY_CASES,
} from '../memory-engine/memory-replay-fixtures.mjs';
import {
  createIsolatedCodexJsonJudge,
} from './codex-isolated-memory-judge.mjs';
import {
  createCodexMemoryCandidateJudge,
} from './judge-memory-candidates.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function closeResource(resource) {
  if (resource && typeof resource.close === 'function') {
    await resource.close().catch(() => {});
  }
}

function userCandidate(caseSpec) {
  const captured = classifyMemoryCandidatePrompt(caseSpec.input);
  if (captured === null) return null;
  return {
    id: 'replay:user:' + caseSpec.id,
    project_id: 'replay-project',
    branch: 'main',
    proposed_type: captured.type,
    proposed_value: captured.value,
    source_authority: 'user_direct',
    policy_version: captured.policyVersion,
  };
}

function agentCandidate(caseSpec) {
  const captured = classifyAgentDecisionMessage(caseSpec.input, {
    agentType: 'root',
  })[0] ?? null;
  if (captured === null) return null;
  return {
    id: 'replay:agent:' + caseSpec.id,
    project_id: 'replay-project',
    branch: 'main',
    proposed_type: 'decision',
    proposed_value: captured.value,
    source_authority: 'agent_inference',
    policy_version: captured.policyVersion,
  };
}

export async function runMemoryReplay({
  providerBacked = false,
  model = null,
  reasoningEffort = 'medium',
  cwd = process.cwd(),
  sourceCodexHome = (
    process.env.MEMORY_REPLAY_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  ),
  env = process.env,
  createUserJudge = createCodexMemoryCandidateJudge,
  createAgentJudge = createIsolatedCodexJsonJudge,
} = {}) {
  if (typeof providerBacked !== 'boolean') {
    throw new TypeError('providerBacked must be a boolean');
  }
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (!nonEmpty(cwd)) throw new TypeError('cwd must be non-empty');

  const capture = replayCaptureReachability();
  if (!providerBacked) {
    return {
      version: MEMORY_REPLAY_FIXTURE_VERSION,
      provider_backed: false,
      capture,
      score: null,
    };
  }

  if (!nonEmpty(sourceCodexHome)) {
    throw new TypeError('sourceCodexHome must be non-empty');
  }

  let userResource = null;
  let agentResource = null;
  try {
    userResource = await createUserJudge({
      cwd,
      model,
      reasoningEffort,
      sourceCodexHome,
      env,
    });
    agentResource = await createAgentJudge({
      workspaceLabel: 'memory-replay-agent-importance',
      policyVersion: AGENT_DECISION_IMPORTANCE_POLICY_VERSION,
      model,
      reasoningEffort,
      sourceCodexHome,
      env,
    });

    const userJudge = typeof userResource === 'function'
      ? userResource
      : userResource?.judge;
    const rawAgentJudge = typeof agentResource === 'function'
      ? agentResource
      : agentResource?.judge;
    if (typeof userJudge !== 'function' || typeof rawAgentJudge !== 'function') {
      throw new TypeError('replay judge resources must expose judge()');
    }

    const userPredictions = [];
    for (const caseSpec of USER_MEMORY_REPLAY_CASES) {
      if (!caseSpec.expected_capture || caseSpec.expected_importance === null) {
        continue;
      }
      try {
        const candidate = userCandidate(caseSpec);
        if (candidate === null) {
          throw new Error('expected user replay candidate was not captured');
        }
        const judgment = parseMemoryCandidateJudgment(
          await userJudge(candidate),
        );
        userPredictions.push({
          id: caseSpec.id,
          ok: true,
          decision: judgment.decision,
          confidence: judgment.confidence,
          judgment,
        });
      } catch (error) {
        userPredictions.push({
          id: caseSpec.id,
          ok: false,
          decision: null,
          confidence: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const agentPredictions = [];
    for (const caseSpec of AGENT_MEMORY_REPLAY_CASES) {
      if (!caseSpec.expected_capture || caseSpec.expected_importance === null) {
        continue;
      }
      try {
        const candidate = agentCandidate(caseSpec);
        if (candidate === null) {
          throw new Error('expected agent replay candidate was not captured');
        }
        const judgment = parseMemoryCandidateJudgment(
          await rawAgentJudge(
            buildAgentDecisionImportancePrompt(candidate),
          ),
        );
        if (
          judgment.decision === 'promote'
          && !/^Agent decision:/u.test(judgment.canonical_fact ?? '')
        ) {
          throw new Error(
            'agent replay promote canonical_fact must start with "Agent decision:"',
          );
        }
        agentPredictions.push({
          id: caseSpec.id,
          ok: true,
          decision: judgment.decision,
          confidence: judgment.confidence,
          judgment,
        });
      } catch (error) {
        agentPredictions.push({
          id: caseSpec.id,
          ok: false,
          decision: null,
          confidence: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      version: MEMORY_REPLAY_FIXTURE_VERSION,
      provider_backed: true,
      model: model ?? 'codex-default',
      reasoning_effort: reasoningEffort,
      capture,
      user_predictions: userPredictions,
      agent_predictions: agentPredictions,
      score: scoreMemoryReplayImportance({
        userPredictions,
        agentPredictions,
      }),
      isolation: {
        user: typeof userResource === 'object'
          ? userResource.isolation ?? null
          : null,
        agent: typeof agentResource === 'object'
          ? agentResource.isolation ?? null
          : null,
      },
    };
  } finally {
    await closeResource(agentResource);
    await closeResource(userResource);
  }
}

function parseArgs(argv) {
  const options = {
    providerBacked: false,
    model: null,
    reasoningEffort: 'medium',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--provider') {
      options.providerBacked = true;
      continue;
    }
    if (['--model', '--reasoning-effort'].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
      index += 1;
      if (arg === '--model') options.model = value.trim();
      else {
        const effort = value.trim().toLowerCase();
        if (!['low', 'medium', 'high'].includes(effort)) {
          throw new Error('--reasoning-effort must be low, medium, or high');
        }
        options.reasoningEffort = effort;
      }
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runMemoryReplay({
    ...options,
    cwd: process.cwd(),
  });

  console.log(JSON.stringify({
    type: 'memory_replay_summary',
    ...result,
  }));

  if (!result.capture.pass) process.exitCode = 1;
  if (result.provider_backed && !result.score.quality_gate.pass) {
    process.exitCode = 1;
  }
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
