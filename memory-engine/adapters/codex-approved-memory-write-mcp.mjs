import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
import { commitApprovedMemoryWrite } from './codex-approved-memory-write.mjs';

const TOOL = Object.freeze({
  name: 'memory_commit_approved',
  description: 'Commit exactly one human-prepared, project-bound Memory Evidence item with an unexpired single-use approval. Does not accept free-form memory text, paths, project IDs, or SQL. User must prepare the evidence in a separate terminal first.',
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object', properties: {
      evidence_id: { type: 'string', minLength: 1, maxLength: 100 },
    }, required: ['evidence_id'], additionalProperties: false,
  },
});
const respond = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const toolResult = (result, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(result) }], isError,
});
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function createApprovedMemoryWriteDispatcher({
  cwd, scopePath, commit = commitApprovedMemoryWrite,
} = {}) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('pinned_absolute_cwd_required');
  return async (message) => {
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return fail(null, -32600, 'Invalid JSON-RPC request');
    }
    if (!Object.hasOwn(message, 'id')) return null;
    const id = message.id;
    if (message.method === 'initialize') return respond(id, {
      protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'agenthub-memory-write-preview', version: '0.1.0' },
      instructions: 'This is a local approval-gated preview, not production broker authorization. A model cannot mint approvals through this tool.',
    });
    if (message.method === 'ping') return respond(id, {});
    if (message.method === 'tools/list') return respond(id, { tools: [TOOL] });
    if (message.method !== 'tools/call') return fail(id, -32601, 'Method not found');
    if (!isRecord(message.params) || message.params.name !== TOOL.name
      || !isRecord(message.params.arguments)) return respond(id, toolResult({ status: 'invalid_tool_call' }, true));
    const args = message.params.arguments;
    if (Object.keys(args).length !== 1 || !Object.hasOwn(args, 'evidence_id')
      || typeof args.evidence_id !== 'string') {
      return respond(id, toolResult({ status: 'forbidden_argument' }, true));
    }
    let outcome;
    try { outcome = await commit({ cwd, scopePath, evidenceId: args.evidence_id }); }
    catch { outcome = { status: 'memory_write_denied', committed: false }; }
    return respond(id, toolResult(outcome, outcome.committed !== true));
  };
}

export async function serveApprovedMemoryWriteMcp({
  cwd, scopePath, input = process.stdin, output = process.stdout,
  commit = commitApprovedMemoryWrite,
} = {}) {
  const dispatch = createApprovedMemoryWriteDispatcher({ cwd, scopePath, commit });
  for await (const line of createInterface({ input, crlfDelay: Infinity, terminal: false })) {
    if (line.length > 32_768) {
      output.write(JSON.stringify(fail(null, -32600, 'Request too large')) + '\n');
      continue;
    }
    let request;
    try { request = JSON.parse(line); }
    catch {
      output.write(JSON.stringify(fail(null, -32700, 'Parse error')) + '\n');
      continue;
    }
    const result = await dispatch(request);
    if (result !== null) output.write(JSON.stringify(result) + '\n');
  }
}
