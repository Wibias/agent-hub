import { evaluateReliance } from '../index.mjs';
import { buildMemoryGraph } from '../memory-graph.mjs';
import { evaluateGraphRecallShadow } from '../graph-recall-shadow.mjs';
import { buildGraphRecallShadowRecord } from '../graph-recall-shadow-store.mjs';
import {
  createCodexMemoryHookAdapter as createCoreCodexMemoryHookAdapter,
} from './codex-hooks-core.mjs';

export * from './codex-hooks-core.mjs';

function candidateText(item) {
  return typeof item?.claim?.value === 'string'
    ? item.claim.value
    : typeof item?.evidence?.content_redacted === 'string'
      ? item.evidence.content_redacted
      : '';
}

function candidateIds(items) {
  return (items ?? [])
    .map((item) => item?.claim?.id)
    .filter((id) => typeof id === 'string' && id.length > 0);
}

export function createCodexMemoryHookAdapter(options = {}) {
  const graphRecallShadow = options.graphRecallShadow === true;
  if (
    options.graphRecallShadow !== undefined
    && typeof options.graphRecallShadow !== 'boolean'
  ) {
    throw new TypeError('graphRecallShadow must be a boolean');
  }
  if (
    options.graphRecallShadowStore !== undefined
    && options.graphRecallShadowStore !== null
    && (
      typeof options.graphRecallShadowStore !== 'object'
      || typeof options.graphRecallShadowStore.record !== 'function'
    )
  ) {
    throw new TypeError('graphRecallShadowStore must expose record() or be null');
  }
  if (graphRecallShadow && options.graphRecallShadowStore == null) {
    throw new TypeError('graphRecallShadow requires graphRecallShadowStore');
  }

  if (!graphRecallShadow) {
    return createCoreCodexMemoryHookAdapter(options);
  }

  // Preserve all existing adapter validation at construction time. The live
  // wrapper below creates an event-local core adapter so observation state can
  // never leak across concurrent or sequential hook calls.
  createCoreCodexMemoryHookAdapter(options);

  const originalProtocol = options.protocol;
  const originalJudge = options.recallRelevanceJudge ?? null;
  const originalFastPath = options.recallFastPath ?? null;
  const graphStore = options.graphRecallShadowStore;
  const projectId = options.projectId;
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    async handle(event) {
      let recallSnapshot = null;
      let judgeCalled = false;
      let judgeAvailable = false;
      let judgeSelectedIds = null;
      let authoritativeFastSelectedIds = null;

      const protocol = {
        async handle(request) {
          const response = await originalProtocol.handle(request);
          if (request?.operation === 'recall' && response?.ok === true) {
            recallSnapshot = {
              projectId: request.payload?.project_id ?? projectId,
              branch: request.payload?.branch ?? null,
              query: request.payload?.query ?? event?.prompt ?? '',
              items: Array.isArray(response.result?.items)
                ? response.result.items
                : [],
              conflicts: Array.isArray(response.result?.conflicts)
                ? response.result.conflicts
                : [],
            };
          }
          return response;
        },
      };

      const recallRelevanceJudge = originalJudge === null
        ? null
        : async (args) => {
            judgeCalled = true;
            try {
              const result = await originalJudge(args);
              judgeAvailable = true;
              judgeSelectedIds = Array.isArray(result?.selected_ids)
                ? [...result.selected_ids]
                : [];
              return result;
            } catch (error) {
              judgeAvailable = false;
              throw error;
            }
          };

      const recallFastPath = originalFastPath === null
        ? null
        : async (args) => {
            const result = await originalFastPath(args);
            if (
              options.recallFastPathShadowMode !== true
              && options.recallFastPathShadowReplayMode !== true
              && (result?.route === 'fast_v1' || result?.route === 'fast_v2')
            ) {
              authoritativeFastSelectedIds = Array.isArray(result.selected_ids)
                ? [...result.selected_ids]
                : [];
            }
            return result;
          };

      const core = createCoreCodexMemoryHookAdapter({
        ...options,
        protocol,
        recallRelevanceJudge,
        recallFastPath,
      });
      const output = await core.handle(event);

      if (recallSnapshot !== null && typeof recallSnapshot.branch === 'string') {
        try {
          const reliance = evaluateReliance({
            items: recallSnapshot.items,
            conflicts: recallSnapshot.conflicts,
            use: 'answer',
          });
          const relianceIds = candidateIds(reliance.selected);
          const authoritativeSelectedIds = judgeCalled
            ? (judgeAvailable ? (judgeSelectedIds ?? []) : relianceIds)
            : authoritativeFastSelectedIds ?? relianceIds;
          const graph = buildMemoryGraph(options.memory, {
            projectId: recallSnapshot.projectId,
            branch: recallSnapshot.branch,
          });
          const report = evaluateGraphRecallShadow({
            graph,
            sourceCandidates: reliance.selected.map((item) => ({
              id: item.claim.id,
              text: candidateText(item),
            })),
            authoritativeSelectedIds,
            judgeCalled,
            judgeAvailable,
          });
          const record = buildGraphRecallShadowRecord({
            projectId: recallSnapshot.projectId,
            branch: recallSnapshot.branch,
            query: recallSnapshot.query,
            observedAt: clock(),
            report,
          });
          await graphStore.record(record);
        } catch {
          // Graph Recall Shadow is observational and must never affect recall.
        }
      }

      return output;
    },
  };
}
