function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function tokenField(usage, key) {
  const value = usage?.[key];
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(key + ' must be a non-negative integer or null');
  }
  return value;
}

function buildTelemetry({ stage, evaluatorId, status, durationMs, usage }) {
  return {
    stage,
    evaluator_id: evaluatorId,
    status,
    duration_ms: durationMs,
    input_tokens: tokenField(usage, 'input_tokens'),
    cached_input_tokens: tokenField(usage, 'cached_input_tokens'),
    cache_write_input_tokens: tokenField(usage, 'cache_write_input_tokens'),
    output_tokens: tokenField(usage, 'output_tokens'),
    reasoning_output_tokens: tokenField(usage, 'reasoning_output_tokens'),
  };
}

export async function runInstrumentedMemoryJudge({
  stage,
  evaluatorId,
  prompt,
  judge,
  getUsage = () => null,
  onUsage = null,
  clockMs = Date.now,
} = {}) {
  if (!nonEmpty(stage)) throw new TypeError('stage must be a non-empty string');
  if (!nonEmpty(evaluatorId)) throw new TypeError('evaluatorId must be a non-empty string');
  if (!nonEmpty(prompt)) throw new TypeError('prompt must be a non-empty string');
  if (typeof judge !== 'function') throw new TypeError('judge must be a function');
  if (typeof getUsage !== 'function') throw new TypeError('getUsage must be a function');
  if (onUsage !== null && typeof onUsage !== 'function') {
    throw new TypeError('onUsage must be a function or null');
  }
  if (typeof clockMs !== 'function') throw new TypeError('clockMs must be a function');

  const startedAt = Number(clockMs());
  let status = 'success';
  try {
    return await judge(prompt);
  } catch (error) {
    status = 'failed';
    throw error;
  } finally {
    const finishedAt = Number(clockMs());
    const duration = Math.max(0, finishedAt - startedAt);
    let usage = null;
    try {
      usage = getUsage();
    } catch {
      usage = null;
    }
    let telemetry;
    try {
      telemetry = buildTelemetry({
        stage,
        evaluatorId,
        status,
        durationMs: Number.isFinite(duration) ? duration : 0,
        usage,
      });
    } catch {
      telemetry = buildTelemetry({
        stage,
        evaluatorId,
        status,
        durationMs: Number.isFinite(duration) ? duration : 0,
        usage: null,
      });
    }
    if (onUsage !== null) {
      try {
        await onUsage(telemetry);
      } catch {
        // Usage telemetry is operational state and must never affect judging.
      }
    }
  }
}
