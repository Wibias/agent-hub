#!/usr/bin/env node
/** Opt-in combined graph scale probe. Only disposable synthetic data. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { MemoryEngine } from '../memory-engine/index.mjs';
import { createMemoryUiServer } from './memory-ui.mjs';

const PROJECT = 'github.com/example/browser-scale';
const BRANCH = 'main';
const CLAIMS = 500;
const DIMENSIONS = 384;
const BUDGET_MS = 750;
const BUDGET_BYTES = 1_500_000;
const id = (index) => 'c' + String(index).padStart(4, '0');

function seed(memory) {
  const at = new Date(Date.now() - 60_000).toISOString();
  memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
  for (let i = 0; i < CLAIMS; i++) {
    const claimId = id(i);
    const value = 'SQLite uses Node.js for module `src/module' + (i % 20) + '.mjs` in fixture ' + i;
    memory.ingest({
      evidence: { id: 'e-' + claimId, projectId: PROJECT, harness: 'codex',
        sessionId: 'synthetic', sourceKind: 'session', sourceRef: 'session:' + claimId,
        capturedAt: at, branch: BRANCH, commitSha: null, path: null, blobOid: null,
        content: value, authorityClass: 'user_direct', metadata: { event_type: 'user_prompt' } },
      claim: { id: claimId, kind: 'decision', subject: 'module ' + i, predicate: 'uses',
        value, state: 'active', branchScope: BRANCH, createdAt: at },
    });
    const vector = new Float32Array(DIMENSIONS);
    vector[i % 20] = 1;
    vector[20 + i % 364] = 0.1;
    memory.putClaimEmbedding({ claimId, modelId: 'synthetic', modelRevision: 'v1',
      textHash: memory.embeddingDocument({ claimId }).text_hash, dimensions: DIMENSIONS, vector });
  }
  for (let i = 0; i < 10; i++) {
    memory.proposeTypedRelation({ projectId: PROJECT, branch: BRANCH, sourceClaimId: id(i),
      targetClaimId: id(i + 20), relation: 'supports', confidence: 'high',
      reason: 'Synthetic performance fixture only.' },
    { evaluatorId: 'fixture', policyVersion: 'synthetic-benchmark-v1', at });
  }
}

async function main(args) {
  const samples = args.length === 0 ? 10
    : args.length === 2 && args[0] === '--samples' ? Number(args[1]) : NaN;
  if (!Number.isInteger(samples) || samples < 1 || samples > 20) {
    throw new Error('Usage: node scripts/benchmark-memory-graph-combined.mjs [--samples 1..20]');
  }
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-graph-combined-'));
  const dbPath = join(root, 'fixture.sqlite3');
  let runtime;
  try {
    const writer = new MemoryEngine({ dbPath });
    try { seed(writer); } finally { writer.close(); }
    // The server opens its own read-only SQLite handle, as in normal browsing.
    runtime = createMemoryUiServer({ dbPath, includeRuntimeHealth: false, repositoryRoots: [] });
    runtime.server.listen(0, runtime.host);
    await once(runtime.server, 'listening');
    const base = 'http://127.0.0.1:' + runtime.server.address().port;
    const params = new URLSearchParams({ projectId: PROJECT, branch: BRANCH,
      includeSimilarity: '1', semanticThreshold: '0.82', maxSemanticNeighbors: '3' });
    const records = [];
    let counts;
    let baseline;
    for (let i = 0; i < samples; i++) {
      const started = performance.now();
      const cpuStarted = process.cpuUsage();
      const response = await fetch(base + '/api/graph?' + params, { signal: AbortSignal.timeout(30_000) });
      assert.equal(response.status, 200);
      const body = await response.text();
      const elapsed = performance.now() - started;
      const cpu = process.cpuUsage(cpuStarted);
      const graph = JSON.parse(body);
      const { stats } = graph;
      assert.equal(stats.totalClaims, CLAIMS);
      assert.equal(stats.typedRelations, 10);
      assert.equal(stats.inferredEdges, 730);
      assert.equal(stats.entityEdges, 1500);
      assert.equal(stats.entityEdgesOmitted, 500);
      assert.equal(graph.nodes.length, 523);
      assert.equal(graph.edges.length, 2230);
      assert.equal(stats.truncated, false);
      // Only the per-request projection timestamp may change.
      const { asOf, ...projection } = graph;
      assert.ok(Number.isFinite(Date.parse(asOf)));
      if (baseline) assert.deepEqual(projection, baseline);
      else baseline = projection;
      counts = { claims: stats.totalClaims, nodes: graph.nodes.length, edges: graph.edges.length,
        semanticEdges: stats.inferredEdges, typedEdges: stats.typedRelations,
        entityEdges: stats.entityEdges, entityEdgesOmitted: stats.entityEdgesOmitted };
      records.push({ sample: i + 1, wallMs: Math.round(elapsed),
        processCpuMs: Math.round((cpu.user + cpu.system) / 1000), payloadBytes: Buffer.byteLength(body),
        withinBudget: elapsed <= BUDGET_MS && Buffer.byteLength(body) <= BUDGET_BYTES });
    }
    const sorted = records.map(row => row.wallMs).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const report = { mode: 'synthetic-only-read-only-http', node: process.version,
      platform: process.platform, counts, budget: { wallMs: BUDGET_MS, bytes: BUDGET_BYTES },
      identicalGraphsExceptAsOf: true, medianMs, maxMs: sorted.at(-1),
      pass: records.every(row => row.withinBudget), records };
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
  } finally {
    if (runtime) await new Promise(resolve => runtime.server.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
