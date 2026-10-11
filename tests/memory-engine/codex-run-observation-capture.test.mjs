import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RunObservationBuffer } from '../../memory-engine/run-observation-buffer.mjs';
import {
  captureCodexPostToolUseObservation,
  captureCodexUserPromptObservation,
  codexRunObservationId,
} from '../../memory-engine/codex-run-observation-capture.mjs';
import * as passiveEvents from '../../memory-engine/codex-run-observation-capture.mjs';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'codex-run-observation-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;');
  db.prepare('INSERT INTO project_registry VALUES (?)').run('project-a');
  db.close();
  return { dbPath, buffer: new RunObservationBuffer({ dbPath }) };
}

function sensitivity(text) {
  if (String(text).includes('SECRET_TOKEN')) {
    return { containsSecret: true, redacted: String(text).replaceAll('SECRET_TOKEN', '[REDACTED_SECRET]') };
  }
  return { containsSecret: false, redacted: String(text) };
}

test('UserPromptSubmit is buffered as user_direct operational evidence', async (t) => {
  const { buffer } = await setup();
  t.after(() => buffer.close());

  const stored = captureCodexUserPromptObservation({
    buffer,
    projectId: 'project-a',
    branch: 'main',
    revisionSha: 'a'.repeat(40),
    event: {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'S1', turn_id: 'T1', prompt: 'We use Postgres for concurrent writes.',
    },
    inspectTextSensitivity: sensitivity,
    observedAt: '2026-10-11T12:00:00.000Z',
  });

  assert.equal(stored.authority_class, 'user_direct');
  assert.equal(stored.source_kind, 'session');
  assert.equal(stored.content_redacted, 'We use Postgres for concurrent writes.');
  assert.equal(stored.metadata.revision_sha, 'a'.repeat(40));
});

test('PostToolUse buffers only the bounded tool response as tool_observation', async (t) => {
  const { buffer } = await setup();
  t.after(() => buffer.close());

  const stored = captureCodexPostToolUseObservation({
    buffer,
    projectId: 'project-a',
    branch: 'main',
    revisionSha: 'b'.repeat(40),
    event: {
      hook_event_name: 'PostToolUse',
      session_id: 'S1', turn_id: 'T1',
      tool_name: 'Bash', tool_use_id: 'tool-1',
      tool_input: { command: 'echo DO_NOT_PERSIST_THIS_INPUT' },
      tool_response: { stdout: 'Postgres handled 8 concurrent writers.', exit_code: 0 },
    },
    inspectTextSensitivity: sensitivity,
    observedAt: '2026-10-11T12:01:00.000Z',
  });

  assert.equal(stored.authority_class, 'tool_observation');
  assert.equal(stored.source_kind, 'tool');
  assert.match(stored.content_redacted, /Postgres handled 8 concurrent writers/u);
  assert.doesNotMatch(stored.content_redacted, /DO_NOT_PERSIST_THIS_INPUT/u);
  assert.equal(stored.metadata.tool_name, 'Bash');
  assert.equal(stored.metadata.tool_use_id, 'tool-1');
});

test('secret-bearing prompt or tool response is not retained in operational buffer', async (t) => {
  const { buffer } = await setup();
  t.after(() => buffer.close());

  const prompt = captureCodexUserPromptObservation({
    buffer, projectId: 'project-a', branch: 'main', revisionSha: null,
    event: { hook_event_name: 'UserPromptSubmit', session_id: 'S1', turn_id: 'T1', prompt: 'token SECRET_TOKEN' },
    inspectTextSensitivity: sensitivity,
    observedAt: '2026-10-11T12:00:00.000Z',
  });
  const tool = captureCodexPostToolUseObservation({
    buffer, projectId: 'project-a', branch: 'main', revisionSha: null,
    event: {
      hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'T1',
      tool_name: 'Bash', tool_use_id: 'tool-1', tool_response: 'SECRET_TOKEN',
    },
    inspectTextSensitivity: sensitivity,
    observedAt: '2026-10-11T12:01:00.000Z',
  });

  assert.equal(prompt, null);
  assert.equal(tool, null);
  assert.deepEqual(buffer.listTurn({ projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1' }), []);
});

test('large PostToolUse response is bounded and marked truncated', async (t) => {
  const { buffer } = await setup();
  t.after(() => buffer.close());

  const stored = captureCodexPostToolUseObservation({
    buffer, projectId: 'project-a', branch: 'main', revisionSha: null,
    event: {
      hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'T1',
      tool_name: 'Bash', tool_use_id: 'tool-large', tool_response: 'x'.repeat(20_000),
    },
    inspectTextSensitivity: sensitivity,
    observedAt: '2026-10-11T12:01:00.000Z',
    maxContentBytes: 1_024,
  });

  assert.ok(Buffer.byteLength(stored.content_redacted, 'utf8') <= 1_024);
  assert.equal(stored.metadata.response_truncated, true);
  assert.match(stored.content_redacted, /TRUNCATED/u);
});

test('observation ids are deterministic per event identity', () => {
  assert.equal(
    codexRunObservationId({ kind: 'tool', sessionId: 'S1', turnId: 'T1', sourceId: 'tool-1' }),
    codexRunObservationId({ kind: 'tool', sessionId: 'S1', turnId: 'T1', sourceId: 'tool-1' }),
  );
  assert.notEqual(
    codexRunObservationId({ kind: 'tool', sessionId: 'S1', turnId: 'T1', sourceId: 'tool-1' }),
    codexRunObservationId({ kind: 'tool', sessionId: 'S1', turnId: 'T1', sourceId: 'tool-2' }),
  );
});


test('passive event adapter is exposed separately from low-level capture helpers', () => {
  assert.equal(typeof passiveEvents.createCodexPassiveMemoryEventAdapter, 'function');
});

test('passive event adapter buffers normal prompt and tool response, skips memory control, and runs root Stop', async () => {
  const { dbPath } = await setup();
  const stopCalls = [];
  const adapter = passiveEvents.createCodexPassiveMemoryEventAdapter({
    dbPath,
    projectId: 'project-a',
    inspectTextSensitivity: sensitivity,
    resolveContext: async ({ cwd }) => ({
      repoPath: cwd,
      branch: 'main',
      revisionSha: 'c'.repeat(40),
    }),
    isMemoryControlPrompt: (prompt) => /^\s*memory\b/iu.test(prompt),
    runStopPipeline: async (args) => {
      stopCalls.push(args);
      return { promotion: { promoted: 1 } };
    },
    stopPipelineOptions: { marker: 'pipeline-options' },
    clock: () => '2026-10-11T13:00:00.000Z',
  });

  const promptResult = await adapter.handle({
    hook_event_name: 'UserPromptSubmit', session_id: 'S1', turn_id: 'T1',
    cwd: 'C:/repo', prompt: 'We use Postgres for concurrent writes.',
  });
  const toolResult = await adapter.handle({
    hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'T1', cwd: 'C:/repo',
    tool_name: 'Bash', tool_use_id: 'tool-1', tool_input: { command: 'secret-ish input' },
    tool_response: { stdout: 'Postgres accepted concurrent writes.', exit_code: 0 },
  });
  const controlResult = await adapter.handle({
    hook_event_name: 'UserPromptSubmit', session_id: 'S1', turn_id: 'T2',
    cwd: 'C:/repo', prompt: 'memory list',
  });
  const stopResult = await adapter.handle({
    hook_event_name: 'Stop', session_id: 'S1', turn_id: 'T1', cwd: 'C:/repo',
    last_assistant_message: 'Done.',
  });
  const subagentResult = await adapter.handle({
    hook_event_name: 'SubagentStop', session_id: 'S1', turn_id: 'T1', cwd: 'C:/repo',
    last_assistant_message: 'Subagent done.',
  });

  assert.equal(promptResult.captured, true);
  assert.equal(toolResult.captured, true);
  assert.equal(controlResult.captured, false);
  assert.equal(controlResult.reason, 'memory_control_prompt');
  assert.equal(stopResult.pipeline.promotion.promoted, 1);
  assert.equal(subagentResult, null);
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0].dbPath, dbPath);
  assert.equal(stopCalls[0].projectId, 'project-a');
  assert.equal(stopCalls[0].branch, 'main');
  assert.equal(stopCalls[0].sessionId, 'S1');
  assert.equal(stopCalls[0].turnId, 'T1');
  assert.equal(stopCalls[0].marker, 'pipeline-options');

  const buffer = new RunObservationBuffer({ dbPath, readOnly: true });
  try {
    const t1 = buffer.listTurn({ projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1' });
    const t2 = buffer.listTurn({ projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T2' });
    assert.equal(t1.length, 2);
    assert.equal(t2.length, 0);
    assert.doesNotMatch(t1.map((item) => item.content_redacted).join('\n'), /secret-ish input/u);
  } finally { buffer.close(); }
});

test('passive event adapter fails soft when runtime scope or pipeline work fails', async () => {
  const { dbPath } = await setup();
  const scopeFailure = passiveEvents.createCodexPassiveMemoryEventAdapter({
    dbPath,
    projectId: 'project-a',
    inspectTextSensitivity: sensitivity,
    resolveContext: async () => { throw new Error('git unavailable'); },
    runStopPipeline: async () => ({}),
  });
  const stopFailure = passiveEvents.createCodexPassiveMemoryEventAdapter({
    dbPath,
    projectId: 'project-a',
    inspectTextSensitivity: sensitivity,
    resolveContext: async () => ({ branch: 'main', revisionSha: null }),
    runStopPipeline: async () => { throw new Error('judge unavailable'); },
  });

  assert.equal(await scopeFailure.handle({
    hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'T1', cwd: 'C:/repo',
    tool_name: 'Bash', tool_use_id: 'tool-1', tool_response: 'ok',
  }), null);
  assert.equal(await stopFailure.handle({
    hook_event_name: 'Stop', session_id: 'S1', turn_id: 'T1', cwd: 'C:/repo',
  }), null);
});

test('passive event adapter prunes operational observations older than retention window after capture', async () => {
  const { dbPath, buffer } = await setup();
  buffer.record({
    id: 'old-observation', projectId: 'project-a', branch: 'main', sessionId: 'OLD', turnId: 'OLD',
    sourceKind: 'tool', sourceRef: 'tool:Bash:old', observedAt: '2026-10-01T00:00:00.000Z',
    authorityClass: 'tool_observation', sensitivity: 'normal', contentRedacted: 'old transient output',
    metadata: { event_type: 'post_tool_use' },
  });
  buffer.close();

  const adapter = passiveEvents.createCodexPassiveMemoryEventAdapter({
    dbPath,
    projectId: 'project-a',
    inspectTextSensitivity: sensitivity,
    resolveContext: async () => ({ branch: 'main', revisionSha: null }),
    runStopPipeline: async () => ({}),
    observationRetentionDays: 7,
    clock: () => '2026-10-11T00:00:00.000Z',
  });
  await adapter.handle({
    hook_event_name: 'UserPromptSubmit', session_id: 'S1', turn_id: 'T1',
    cwd: 'C:/repo', prompt: 'Normal prompt.',
  });

  const read = new RunObservationBuffer({ dbPath, readOnly: true });
  try {
    assert.equal(read.get('old-observation'), null);
    assert.equal(
      read.listTurn({ projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1' }).length,
      1,
    );
  } finally { read.close(); }
});

test('secret detection runs before truncation so boundary fragments are never retained', async (t) => {
  const { buffer } = await setup();
  t.after(() => buffer.close());
  const stored = captureCodexPostToolUseObservation({
    buffer,
    projectId: 'project-a',
    branch: 'main',
    revisionSha: null,
    event: {
      hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'T1',
      tool_name: 'Bash', tool_use_id: 'tool-boundary',
      tool_response: 'x'.repeat(1008) + 'SECRET_TOKEN' + 'y'.repeat(100),
    },
    inspectTextSensitivity: sensitivity,
    observedAt: '2026-10-11T12:01:00.000Z',
    maxContentBytes: 1_024,
  });
  assert.equal(stored, null);
  assert.deepEqual(
    buffer.listTurn({ projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1' }),
    [],
  );
});

test('tool outcome inference is conservative and failure wins contradictory signals', async () => {
  const { inferCodexToolOutcome } = passiveEvents;
  assert.equal(inferCodexToolOutcome({ exit_code: 0 }), 'success');
  assert.equal(inferCodexToolOutcome({ exitCode: 7 }), 'failure');
  assert.equal(inferCodexToolOutcome({ success: false }), 'failure');
  assert.equal(inferCodexToolOutcome({ ok: true }), 'success');
  assert.equal(inferCodexToolOutcome({ isError: true }), 'failure');
  assert.equal(inferCodexToolOutcome({ status: 'completed' }), 'success');
  assert.equal(inferCodexToolOutcome({ status: 'failed' }), 'failure');
  assert.equal(inferCodexToolOutcome({ success: true, exit_code: 1 }), 'failure');
  assert.equal(inferCodexToolOutcome('plain tool output'), 'unknown');
  assert.equal(inferCodexToolOutcome({ stdout: 'no standardized outcome' }), 'unknown');
});

test('PostToolUse stores inferred tool outcome metadata', async (t) => {
  const { buffer } = await setup();
  t.after(() => buffer.close());
  const success = captureCodexPostToolUseObservation({
    buffer, projectId: 'project-a', branch: 'main', revisionSha: null,
    event: {
      hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'T1',
      tool_name: 'Bash', tool_use_id: 'tool-ok',
      tool_response: { stdout: 'ok', exit_code: 0 },
    },
    inspectTextSensitivity: sensitivity,
    observedAt: '2026-10-11T12:01:00.000Z',
  });
  const failure = captureCodexPostToolUseObservation({
    buffer, projectId: 'project-a', branch: 'main', revisionSha: null,
    event: {
      hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'T1',
      tool_name: 'Bash', tool_use_id: 'tool-fail',
      tool_response: { stderr: 'failed', exit_code: 2 },
    },
    inspectTextSensitivity: sensitivity,
    observedAt: '2026-10-11T12:02:00.000Z',
  });
  assert.equal(success.metadata.tool_outcome, 'success');
  assert.equal(failure.metadata.tool_outcome, 'failure');
});
