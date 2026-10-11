import { createHash } from 'node:crypto';

import { RunObservationBuffer } from './run-observation-buffer.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(value, name) {
  if (!nonEmptyString(value)) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value.trim();
}

function normalizeRevision(value) {
  if (value === null || value === undefined) return null;
  return requireString(value, 'revisionSha');
}

function assertCaptureDeps(buffer, inspectTextSensitivity) {
  if (!buffer || typeof buffer.record !== 'function') {
    throw new TypeError('buffer must support record()');
  }
  if (typeof inspectTextSensitivity !== 'function') {
    throw new TypeError('inspectTextSensitivity must be a function');
  }
}

function boundedText(value, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 128 || maxBytes > 65_536) {
    throw new RangeError('maxContentBytes must be an integer between 128 and 65536');
  }
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false };
  }

  const suffix = '\n[TRUNCATED]';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const budget = Math.max(0, maxBytes - suffixBytes);
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= budget) low = mid;
    else high = mid - 1;
  }
  return { text: text.slice(0, low) + suffix, truncated: true };
}

function serializeResponse(value) {
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
  } catch {}
  return String(value ?? '');
}

function safeContent({ raw, inspectTextSensitivity, maxContentBytes }) {
  const original = String(raw ?? '');
  if (!nonEmptyString(original)) return null;
  const sensitivity = inspectTextSensitivity(original);
  if (!sensitivity || sensitivity.containsSecret === true) return null;
  const safeText = typeof sensitivity.redacted === 'string'
    ? sensitivity.redacted
    : original;
  if (!nonEmptyString(safeText)) return null;
  const bounded = boundedText(safeText, maxContentBytes);
  return {
    content: bounded.text,
    truncated: bounded.truncated,
  };
}


export function inferCodexToolOutcome(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object' || Array.isArray(toolResponse)) {
    return 'unknown';
  }

  let success = false;
  let failure = false;
  if (toolResponse.success === true) success = true;
  if (toolResponse.success === false) failure = true;
  if (toolResponse.ok === true) success = true;
  if (toolResponse.ok === false) failure = true;
  if (toolResponse.isError === false) success = true;
  if (toolResponse.isError === true) failure = true;

  for (const key of ['exit_code', 'exitCode']) {
    if (Number.isInteger(toolResponse[key])) {
      if (toolResponse[key] === 0) success = true;
      else failure = true;
    }
  }

  if (typeof toolResponse.status === 'string') {
    const status = toolResponse.status.trim().toLowerCase();
    if (['success', 'ok', 'completed'].includes(status)) success = true;
    if (['error', 'failed', 'failure'].includes(status)) failure = true;
  }

  if (failure) return 'failure';
  if (success) return 'success';
  return 'unknown';
}

export function codexRunObservationId({
  kind,
  sessionId,
  turnId,
  sourceId,
}) {
  for (const [value, name] of [
    [kind, 'kind'],
    [sessionId, 'sessionId'],
    [turnId, 'turnId'],
    [sourceId, 'sourceId'],
  ]) requireString(value, name);

  return 'run-observation:' + createHash('sha256')
    .update(kind, 'utf8')
    .update('\0')
    .update(sessionId, 'utf8')
    .update('\0')
    .update(turnId, 'utf8')
    .update('\0')
    .update(sourceId, 'utf8')
    .digest('hex');
}

export function captureCodexUserPromptObservation({
  buffer,
  projectId,
  branch,
  revisionSha = null,
  event,
  inspectTextSensitivity,
  observedAt = new Date().toISOString(),
  maxContentBytes = 8_192,
}) {
  assertCaptureDeps(buffer, inspectTextSensitivity);
  requireString(projectId, 'projectId');
  requireString(branch, 'branch');
  const revision = normalizeRevision(revisionSha);
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('event must be an object');
  }
  if (event.hook_event_name !== 'UserPromptSubmit') {
    throw new Error('expected UserPromptSubmit event');
  }
  const sessionId = requireString(event.session_id, 'event.session_id');
  const turnId = requireString(event.turn_id, 'event.turn_id');
  const prompt = requireString(event.prompt, 'event.prompt');
  const safe = safeContent({
    raw: prompt,
    inspectTextSensitivity,
    maxContentBytes,
  });
  if (safe === null) return null;

  return buffer.record({
    id: codexRunObservationId({
      kind: 'prompt',
      sessionId,
      turnId,
      sourceId: 'user-prompt',
    }),
    projectId,
    branch,
    sessionId,
    turnId,
    sourceKind: 'session',
    sourceRef: 'session:' + sessionId,
    observedAt,
    authorityClass: 'user_direct',
    sensitivity: 'normal',
    contentRedacted: safe.content,
    metadata: {
      event_type: 'user_prompt',
      hook_event_name: 'UserPromptSubmit',
      revision_sha: revision,
      response_truncated: safe.truncated,
    },
  });
}

export function captureCodexPostToolUseObservation({
  buffer,
  projectId,
  branch,
  revisionSha = null,
  event,
  inspectTextSensitivity,
  observedAt = new Date().toISOString(),
  maxContentBytes = 8_192,
}) {
  assertCaptureDeps(buffer, inspectTextSensitivity);
  requireString(projectId, 'projectId');
  requireString(branch, 'branch');
  const revision = normalizeRevision(revisionSha);
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('event must be an object');
  }
  if (event.hook_event_name !== 'PostToolUse') {
    throw new Error('expected PostToolUse event');
  }

  const sessionId = requireString(event.session_id, 'event.session_id');
  const turnId = requireString(event.turn_id, 'event.turn_id');
  const toolName = requireString(event.tool_name, 'event.tool_name');
  const toolUseId = requireString(event.tool_use_id, 'event.tool_use_id');
  if (!Object.hasOwn(event, 'tool_response')) {
    throw new TypeError('event.tool_response is required');
  }

  const safe = safeContent({
    raw: serializeResponse(event.tool_response),
    inspectTextSensitivity,
    maxContentBytes,
  });
  if (safe === null) return null;

  return buffer.record({
    id: codexRunObservationId({
      kind: 'tool',
      sessionId,
      turnId,
      sourceId: toolUseId,
    }),
    projectId,
    branch,
    sessionId,
    turnId,
    sourceKind: 'tool',
    sourceRef: 'tool:' + toolName + ':' + toolUseId,
    observedAt,
    authorityClass: 'tool_observation',
    sensitivity: 'normal',
    contentRedacted: safe.content,
    metadata: {
      event_type: 'post_tool_use',
      hook_event_name: 'PostToolUse',
      tool_name: toolName,
      tool_use_id: toolUseId,
      revision_sha: revision,
      response_truncated: safe.truncated,
      tool_outcome: inferCodexToolOutcome(event.tool_response),
    },
  });
}

export function createCodexPassiveMemoryEventAdapter({
  dbPath,
  projectId,
  inspectTextSensitivity,
  resolveContext,
  isMemoryControlPrompt = () => false,
  runStopPipeline,
  stopPipelineOptions = {},
  clock = () => new Date().toISOString(),
  maxContentBytes = 8_192,
  observationRetentionDays = 7,
}) {
  requireString(dbPath, 'dbPath');
  requireString(projectId, 'projectId');
  if (typeof inspectTextSensitivity !== 'function') {
    throw new TypeError('inspectTextSensitivity must be a function');
  }
  if (typeof resolveContext !== 'function') {
    throw new TypeError('resolveContext must be a function');
  }
  if (typeof isMemoryControlPrompt !== 'function') {
    throw new TypeError('isMemoryControlPrompt must be a function');
  }
  if (typeof runStopPipeline !== 'function') {
    throw new TypeError('runStopPipeline must be a function');
  }
  if (!stopPipelineOptions || typeof stopPipelineOptions !== 'object' || Array.isArray(stopPipelineOptions)) {
    throw new TypeError('stopPipelineOptions must be an object');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }
  if (
    !Number.isInteger(observationRetentionDays)
    || observationRetentionDays < 1
    || observationRetentionDays > 3650
  ) {
    throw new RangeError('observationRetentionDays must be an integer between 1 and 3650');
  }

  return {
    async handle(event) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        return null;
      }
      const eventName = event.hook_event_name;
      if (!['UserPromptSubmit', 'PostToolUse', 'Stop'].includes(eventName)) {
        return null;
      }

      try {
        const cwd = requireString(event.cwd, 'event.cwd');
        const context = await resolveContext({ cwd });
        if (!context || typeof context !== 'object' || Array.isArray(context)) {
          throw new TypeError('resolveContext must return an object');
        }
        const branch = requireString(context.branch, 'context.branch');
        const revisionSha = context.revisionSha ?? null;

        if (eventName === 'Stop') {
          const sessionId = requireString(event.session_id, 'event.session_id');
          const turnId = requireString(event.turn_id, 'event.turn_id');
          const pipeline = await runStopPipeline({
            ...stopPipelineOptions,
            dbPath,
            projectId,
            branch,
            sessionId,
            turnId,
            inspectTextSensitivity,
            clock,
          });
          return { event: 'Stop', pipeline };
        }

        if (eventName === 'UserPromptSubmit' && isMemoryControlPrompt(event.prompt)) {
          return {
            event: 'UserPromptSubmit',
            captured: false,
            reason: 'memory_control_prompt',
          };
        }

        const buffer = new RunObservationBuffer({ dbPath });
        try {
          const observedAt = clock();
          const observation = eventName === 'UserPromptSubmit'
            ? captureCodexUserPromptObservation({
                buffer,
                projectId,
                branch,
                revisionSha,
                event,
                inspectTextSensitivity,
                observedAt,
                maxContentBytes,
              })
            : captureCodexPostToolUseObservation({
                buffer,
                projectId,
                branch,
                revisionSha,
                event,
                inspectTextSensitivity,
                observedAt,
                maxContentBytes,
              });
          const observedAtMs = Date.parse(observedAt);
          if (Number.isFinite(observedAtMs)) {
            buffer.prune({
              before: new Date(
                observedAtMs - observationRetentionDays * 24 * 60 * 60 * 1000,
              ).toISOString(),
            });
          }
          return {
            event: eventName,
            captured: observation !== null,
            observation_id: observation?.id ?? null,
            reason: observation === null ? 'sensitive_or_empty_content' : null,
          };
        } finally {
          buffer.close();
        }
      } catch {
        // Passive memory capture is optional operational state. It must never
        // block or fail the Codex turn when Git, SQLite, or a judge is down.
        return null;
      }
    },
  };
}
