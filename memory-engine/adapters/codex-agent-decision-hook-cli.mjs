#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyAgentDecisionMessage,
} from '../agent-decision-capture.mjs';
import { launchMemoryCandidatePipeline } from '../candidate-pipeline-launcher.mjs';
import { resolveGitContext } from '../git-freshness.mjs';
import { MemoryEngine } from '../index.mjs';
import { memoryRestoreLocked } from '../memory-maintenance-lock.mjs';
import {
  automaticMemoryCandidatePipelineReady,
  defaultCodexMemoryDbPath,
  parseCodexMemoryConfig,
  resolveCodexProjectScope,
} from './codex-hook-cli.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hashId(prefix, ...parts) {
  const digest = createHash('sha256');
  for (const part of parts) {
    digest.update(String(part ?? ''), 'utf8');
    digest.update('\0', 'utf8');
  }
  return prefix + digest.digest('hex').slice(0, 24);
}

function validEvent(event) {
  if (
    !event
    || typeof event !== 'object'
    || !['Stop', 'SubagentStop'].includes(event.hook_event_name)
    || !nonEmpty(event.session_id)
    || !nonEmpty(event.cwd)
    || !nonEmpty(event.turn_id)
    || !nonEmpty(event.last_assistant_message)
  ) {
    return false;
  }
  if (event.hook_event_name === 'SubagentStop') {
    return nonEmpty(event.agent_id) && nonEmpty(event.agent_type);
  }
  return true;
}

export function parseAgentDecisionHookOptions(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  for (const arg of argv) {
    if (!['--ignore-memory-env', '--auto-pipeline'].includes(arg)) {
      throw new Error('unknown argument: ' + arg);
    }
  }
  return {
    ignoreMemoryEnv: argv.includes('--ignore-memory-env'),
    autoPipeline: argv.includes('--auto-pipeline'),
  };
}

export async function runCodexAgentDecisionHook({
  event,
  env = process.env,
  configOptions = {},
  clock = () => new Date().toISOString(),
  createMemory = ({ dbPath }) => new MemoryEngine({ dbPath }),
  resolveProjectScope = resolveCodexProjectScope,
  resolveGit = resolveGitContext,
  ensureDbDirectory = (dbPath) => {
    mkdirSync(dirname(dbPath), { recursive: true });
  },
  restoreLocked = ({ dbPath }) => memoryRestoreLocked({ dbPath }),
  pipelineReady = automaticMemoryCandidatePipelineReady,
  launchPipeline = launchMemoryCandidatePipeline,
} = {}) {
  const response = { continue: true };
  if (!validEvent(event)) return response;
  if (event.stop_hook_active === true) return response;

  const config = parseCodexMemoryConfig(env, {
    ignoreMemoryEnv: configOptions.ignoreMemoryEnv === true,
  });
  if (!nonEmpty(config.dbPath)) {
    config.dbPath = defaultCodexMemoryDbPath({ env });
  }
  if (restoreLocked({ dbPath: config.dbPath })) return response;

  let memory = null;
  let pipelineLaunch = null;

  try {
    const scope = resolveProjectScope({ event, config });
    const git = resolveGit({ cwd: event.cwd });

    if (
      configOptions.ignoreMemoryEnv === true
      || !nonEmpty(env.AGENT_HUB_MEMORY_DB)
    ) {
      ensureDbDirectory(config.dbPath);
    }

    memory = createMemory({ dbPath: config.dbPath });
    if (!memory.getProject(scope.projectId)) {
      const registration = {
        projectId: scope.projectId,
        repoIdentity: scope.repoIdentity,
      };
      if (scope.canonicalRemote !== null) {
        registration.canonicalRemote = scope.canonicalRemote;
      }
      memory.registerProject(registration);
    }

    const agentType = event.hook_event_name === 'SubagentStop'
      ? event.agent_type
      : 'root';
    const proposals = classifyAgentDecisionMessage(
      event.last_assistant_message,
      { agentType },
    );

    for (const proposal of proposals) {
      const duplicate = memory.findCandidateByFingerprint({
        projectId: scope.projectId,
        branch: git.branch,
        fingerprint: proposal.fingerprint,
      });
      if (duplicate) continue;

      const capturedAt = clock();
      const evidenceId = hashId(
        'evidence:agent-decision:',
        scope.projectId,
        git.branch,
        event.session_id,
        event.turn_id,
        event.agent_id ?? 'root',
        proposal.fingerprint,
      );
      const candidateId = hashId(
        'candidate:agent-decision:',
        scope.projectId,
        git.branch,
        proposal.fingerprint,
      );

      let evidence = memory.getEvidence(evidenceId);
      if (evidence === null) {
        evidence = memory.recordEvidence({
          id: evidenceId,
          projectId: scope.projectId,
          harness: 'codex',
          sessionId: event.session_id,
          sourceKind: event.hook_event_name === 'SubagentStop'
            ? 'subagent'
            : 'assistant',
          sourceRef: event.hook_event_name === 'SubagentStop'
            ? 'codex:subagent:' + event.agent_id
            : 'codex:assistant:' + event.turn_id,
          capturedAt,
          branch: git.branch,
          commitSha: git.revisionSha,
          path: null,
          blobOid: null,
          content: proposal.value,
          authorityClass: 'agent_inference',
          metadata: {
            event_type: event.hook_event_name === 'SubagentStop'
              ? 'subagent_stop'
              : 'assistant_stop',
            hook_event_name: event.hook_event_name,
            turn_id: event.turn_id,
            agent_id: event.agent_id ?? null,
            agent_type: agentType,
            decision_capture: true,
            candidate_policy: proposal.policyVersion,
            candidate_rule: proposal.decisionReason,
            assistant_message_hash: createHash('sha256')
              .update(event.last_assistant_message, 'utf8')
              .digest('hex'),
          },
        });
      }

      memory.recordAgentCandidate({
        id: candidateId,
        evidenceId: evidence.id,
        proposedValue: evidence.content_redacted,
        decisionReason: proposal.decisionReason,
        policyVersion: proposal.policyVersion,
        fingerprint: proposal.fingerprint,
        createdAt: evidence.captured_at ?? capturedAt,
      });
    }

    if (
      configOptions.autoPipeline === true
      && pipelineReady(memory, {
        projectId: scope.projectId,
        branch: git.branch,
      })
    ) {
      pipelineLaunch = {
        cwd: git.repoPath,
        dbPath: config.dbPath,
        projectId: scope.projectId,
        branch: git.branch,
        revisionSha: git.revisionSha,
      };
    }
  } catch {
    pipelineLaunch = null;
  } finally {
    if (memory && typeof memory.close === 'function') {
      try {
        memory.close();
      } catch {}
    }
  }

  if (pipelineLaunch !== null) {
    try {
      launchPipeline(pipelineLaunch);
    } catch {}
  }

  return response;
}

async function readStdin(stream = process.stdin) {
  stream.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stream) raw += chunk;
  return raw;
}

async function main() {
  let output = { continue: true };
  try {
    const raw = await readStdin();
    const event = JSON.parse(raw);
    output = await runCodexAgentDecisionHook({
      event,
      configOptions: parseAgentDecisionHookOptions(process.argv.slice(2)),
    });
  } catch {
    output = { continue: true };
  }
  process.stdout.write(JSON.stringify(output) + '\n');
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
