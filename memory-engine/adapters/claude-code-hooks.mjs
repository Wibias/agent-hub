import { createHash } from 'node:crypto';

import { evaluateReliance } from '../index.mjs';
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

function validUserPromptEvent(event) {
  return (
    event
    && typeof event === 'object'
    && event.hook_event_name === 'UserPromptSubmit'
    && nonEmptyString(event.session_id)
    && nonEmptyString(event.cwd)
    && nonEmptyString(event.prompt)
  );
}

function requestId(event) {
  const digest = createHash('sha256')
    .update(String(event.session_id), 'utf8')
    .update('\0', 'utf8')
    .update(String(event.prompt_id ?? ''), 'utf8')
    .update('\0', 'utf8')
    .update(String(event.prompt), 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `claude-code:${digest}`;
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

export function createClaudeCodeMemoryHookAdapter({
  protocol,
  memory,
  projectId,
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

        await gitRuntime.refreshFreshness({
          memory,
          projectId,
          branch: context.branch,
          revisionSha: context.revisionSha,
          repoPath: context.repoPath,
        });

        const recalled = await protocol.handle({
          protocol: 'memory.protocol.v1',
          operation: 'recall',
          request_id: requestId(event),
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
        const additionalContext = formatMemoryRecallContext(
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
        // Claude Code command hooks must fail soft for ordinary prompt recall.
        return null;
      }
    },
  };
}
