import { createHash, randomUUID } from 'node:crypto';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createPipelineRunId() {
  return 'pipeline-run:' + randomUUID();
}

export function pipelineRunRef(runId) {
  if (!nonEmpty(runId)) {
    throw new TypeError('runId must be a non-empty string');
  }
  const digest = createHash('sha256')
    .update(runId, 'utf8')
    .digest('hex');
  return '@p' + digest.slice(0, 10);
}

function numericSummary(summary) {
  if (!summary || typeof summary !== 'object') return {};
  const result = {};
  for (const key of [
    'total',
    'evaluated',
    'applied',
    'promoted',
    'superseded',
    'needs_confirmation',
    'failed',
  ]) {
    const value = Number(summary[key]);
    if (Number.isFinite(value)) result[key] = value;
  }
  return result;
}

export function summarizePipelineStages(stages = []) {
  const stageCounts = {};
  const candidateRefs = [];
  const failures = [];

  for (const stage of Array.isArray(stages) ? stages : []) {
    if (!stage || typeof stage !== 'object' || !nonEmpty(stage.name)) continue;
    const summary = stage?.result?.summary;
    stageCounts[stage.name] = {
      skipped: stage.skipped === true,
      ...(stage.reason ? { reason: String(stage.reason) } : {}),
      ...numericSummary(summary),
    };

    for (const result of Array.isArray(summary?.results) ? summary.results : []) {
      const candidateRef = (
        nonEmpty(result?.candidate_ref)
          ? result.candidate_ref
          : null
      );
      if (candidateRef !== null) candidateRefs.push(candidateRef);

      if (result?.ok === false || nonEmpty(result?.error)) {
        failures.push({
          stage: stage.name,
          candidate_id: nonEmpty(result?.candidate_id)
            ? result.candidate_id
            : null,
          candidate_ref: candidateRef,
          error_class: 'candidate_stage_failure',
          error: nonEmpty(result?.error)
            ? result.error
            : nonEmpty(result?.reason)
              ? result.reason
              : 'candidate stage reported failure',
        });
      }
    }
  }

  return {
    stageCounts,
    candidateRefs: [...new Set(candidateRefs)],
    failures,
  };
}

export function mergePipelineStageSummaries(current = {}, next = {}) {
  const merged = structuredClone(current);
  for (const [stage, stats] of Object.entries(next)) {
    const existing = merged[stage] ?? {};
    const combined = {
      skipped: Boolean(existing.skipped) && Boolean(stats.skipped),
    };
    if (stats.reason) combined.reason = stats.reason;

    for (const key of [
      'total',
      'evaluated',
      'applied',
      'promoted',
      'superseded',
      'needs_confirmation',
      'failed',
    ]) {
      const value = Number(existing[key] ?? 0) + Number(stats[key] ?? 0);
      if (value > 0) combined[key] = value;
    }
    merged[stage] = combined;
  }
  return merged;
}

export function structuredPipelineLog(value, {
  runId,
  trigger,
} = {}) {
  const base = {
    run_id: runId,
    run_ref: pipelineRunRef(runId),
    trigger,
  };

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify({ ...parsed, ...base });
      }
    } catch {}
    return JSON.stringify({
      type: 'agent_hub_memory_candidate_pipeline_log',
      ...base,
      message: value,
    });
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify({ ...value, ...base });
  }

  return JSON.stringify({
    type: 'agent_hub_memory_candidate_pipeline_log',
    ...base,
    message: String(value),
  });
}
