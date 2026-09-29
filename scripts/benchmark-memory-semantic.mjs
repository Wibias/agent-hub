import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import os from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { MemoryEngine } from '../memory-engine/index.mjs';
import { HybridMemoryRetriever } from '../memory-engine/hybrid-retrieval.mjs';
import {
  createE5Embedder,
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from '../memory-engine/e5-embedder.mjs';

const SCALES = [2_000, 10_000, 25_000];
const MODEL_ID = 'benchmark-e5-shape';
const MODEL_REVISION = 'benchmark-v1';
const requireFromMemoryEngine = createRequire(new URL('../memory-engine/package.json', import.meta.url));
const QUANTIZED_MODEL_REVISION = '6a0d452a575215f80b8f66276dd4ee5d504942c6';
const QUANTIZED_MODEL_FILE = 'model_qint8_avx512_vnni';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function normalizedVector(seed) {
  const vector = new Float32Array(E5_DIMENSIONS);
  let normSquared = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const raw = (((seed + 17) * (index + 23)) % 257) - 128;
    const value = raw / 128;
    vector[index] = value;
    normSquared += value * value;
  }
  const norm = Math.sqrt(normSquared);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= norm;
  }
  return vector;
}

function measureSync(iterations, fn) {
  fn();
  fn();
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return {
    median_ms: round(median(samples)),
    p95_ms: round(percentile(samples, 0.95)),
    min_ms: round(Math.min(...samples)),
    max_ms: round(Math.max(...samples)),
  };
}

async function measureAsync(iterations, fn, { warmups = 2 } = {}) {
  for (let index = 0; index < warmups; index += 1) {
    await fn();
  }
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  return {
    median_ms: round(median(samples)),
    p95_ms: round(percentile(samples, 0.95)),
    min_ms: round(Math.min(...samples)),
    max_ms: round(Math.max(...samples)),
  };
}

async function directorySize(path) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await directorySize(child);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += (await stat(child)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rss_mib: round(usage.rss / (1024 * 1024)),
    heap_used_mib: round(usage.heapUsed / (1024 * 1024)),
    external_mib: round(usage.external / (1024 * 1024)),
  };
}

async function benchmarkBruteForce() {
  const root = await mkdtemp(join(tmpdir(), 'memory-semantic-benchmark-'));
  const engine = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  const vectors = Array.from({ length: 256 }, (_, index) => normalizedVector(index + 1));
  const queryVector = normalizedVector(7_919);
  let inserted = 0;

  try {
    engine.registerProject({
      projectId: 'benchmark-project',
      repoIdentity: 'benchmark-project',
    });

    const embedder = {
      modelId: MODEL_ID,
      modelRevision: MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      async embedQuery() {
        return queryVector;
      },
      async embedPassages(texts) {
        return texts.map((_, index) => vectors[index % vectors.length]);
      },
    };
    const hybrid = new HybridMemoryRetriever({ memory: engine, embedder });

    for (const scale of SCALES) {
      const setupStarted = performance.now();
      while (inserted < scale) {
        const index = inserted;
        const suffix = String(index).padStart(6, '0');
        const createdAt = new Date(Date.UTC(2026, 0, 1) + (index * 1_000)).toISOString();
        const evidenceId = `benchmark-e-${suffix}`;
        const claimId = `benchmark-c-${suffix}`;

        engine.ingest({
          evidence: {
            id: evidenceId,
            projectId: 'benchmark-project',
            harness: 'benchmark',
            sessionId: `session-${suffix}`,
            sourceKind: 'session',
            sourceRef: `session:benchmark-${suffix}`,
            capturedAt: createdAt,
            branch: 'main',
            commitSha: null,
            path: null,
            blobOid: null,
            content: `Unrelated durable memory item ${suffix}.`,
            authorityClass: 'user_direct',
            metadata: {},
          },
          claim: {
            id: claimId,
            kind: 'decision',
            subject: `benchmark_subject_${suffix}`,
            predicate: 'value',
            value: `choice-${suffix}`,
            branchScope: 'main',
            createdAt,
          },
        });

        const document = engine.embeddingDocument({ claimId });
        engine.putClaimEmbedding({
          claimId,
          modelId: MODEL_ID,
          modelRevision: MODEL_REVISION,
          textHash: document.text_hash,
          dimensions: E5_DIMENSIONS,
          vector: vectors[index % vectors.length],
        });
        inserted += 1;
      }

      const setupMs = performance.now() - setupStarted;

      const loadTiming = measureSync(5, () => {
        engine.semanticCandidates({
          projectId: 'benchmark-project',
          branch: 'main',
          mode: 'current',
          modelId: MODEL_ID,
          modelRevision: MODEL_REVISION,
        });
      });

      const candidates = engine.semanticCandidates({
        projectId: 'benchmark-project',
        branch: 'main',
        mode: 'current',
        modelId: MODEL_ID,
        modelRevision: MODEL_REVISION,
      });

      const scoreSortTiming = measureSync(7, () => {
        candidates
          .filter((candidate) => candidate.dimensions === queryVector.length)
          .map((candidate) => ({
            claim_id: candidate.claim_id,
            created_at: candidate.created_at,
            similarity: candidate.vector.reduce(
              (score, value, dimension) => score + (value * queryVector[dimension]),
              0,
            ),
          }))
          .sort((left, right) => (
            (right.similarity - left.similarity)
            || (right.created_at < left.created_at ? -1 : right.created_at > left.created_at ? 1 : 0)
            || (left.claim_id < right.claim_id ? -1 : left.claim_id > right.claim_id ? 1 : 0)
          ))
          .slice(0, 32);
      });

      const recallTiming = await measureAsync(7, () => hybrid.recall({
        projectId: 'benchmark-project',
        branch: 'main',
        query: 'semantic probe for concurrency storage choice',
        mode: 'current',
        maxItems: 10,
        maxSerializedBytes: 16_384,
      }));

      console.log(JSON.stringify({
        benchmark: 'brute_force_hybrid',
        vectors: scale,
        dimensions: E5_DIMENSIONS,
        incremental_setup_ms: round(setupMs),
        semantic_candidate_load: loadTiming,
        score_sort_top32: scoreSortTiming,
        end_to_end_hybrid_recall: recallTiming,
        memory: memorySnapshot(),
      }));

      if (global.gc) global.gc();
    }
  } finally {
    engine.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function benchmarkRealE5() {
  const cacheDir = process.env.MEMORY_E5_MODEL_CACHE;
  if (!cacheDir) {
    console.log(JSON.stringify({
      benchmark: 'real_e5',
      skipped: true,
      reason: 'MEMORY_E5_MODEL_CACHE is not set',
    }));
    return;
  }

  const cache = await directorySize(cacheDir);
  const before = memorySnapshot();

  const initStarted = performance.now();
  const embedder = await createE5Embedder({ cacheDir });
  const initMs = performance.now() - initStarted;

  const firstQueryStarted = performance.now();
  const firstVector = await embedder.embedQuery(
    'Which storage engine did we choose for concurrent writers?',
  );
  const firstQueryMs = performance.now() - firstQueryStarted;

  const queryTiming = await measureAsync(
    7,
    () => embedder.embedQuery(
      'Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt?',
    ),
    { warmups: 1 },
  );

  const passages = Array.from(
    { length: 32 },
    (_, index) => `passage benchmark ${index}: durable project memory for semantic retrieval`,
  );
  const passageTiming = await measureAsync(
    3,
    () => embedder.embedPassages(passages),
    { warmups: 1 },
  );

  console.log(JSON.stringify({
    benchmark: 'real_e5',
    model_id: E5_MODEL_ID,
    model_revision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
    cache_bytes: cache.bytes,
    cache_mib: round(cache.bytes / (1024 * 1024)),
    cache_files: cache.files,
    init_ms: round(initMs),
    first_query_ms: round(firstQueryMs),
    warm_query: queryTiming,
    passage_batch_32: passageTiming,
    passage_per_item_median_ms: round(passageTiming.median_ms / passages.length),
    first_vector_dimensions: firstVector.length,
    memory_before: before,
    memory_after: memorySnapshot(),
  }));
}


function prefixOnce(text, prefix) {
  const trimmed = String(text).trim();
  return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}

function vectorsFromOutput(output, expectedCount) {
  if (!(output?.data instanceof Float32Array)) {
    throw new TypeError('candidate extractor must return Float32Array data');
  }
  if (!Array.isArray(output.dims) || output.dims.at(-1) !== E5_DIMENSIONS) {
    throw new RangeError('candidate extractor must return 384-dimensional vectors');
  }
  if (output.data.length !== expectedCount * E5_DIMENSIONS) {
    throw new RangeError('candidate extractor output count mismatch');
  }

  return Array.from({ length: expectedCount }, (_, index) => {
    const start = index * E5_DIMENSIONS;
    return new Float32Array(output.data.slice(start, start + E5_DIMENSIONS));
  });
}

async function createQuantizedCandidateEmbedder({
  cacheDir,
  allowRemoteModels = false,
}) {
  const transformersEntry = requireFromMemoryEngine.resolve('@huggingface/transformers');
  const { pipeline } = await import(pathToFileURL(transformersEntry).href);
  const extractor = await pipeline(
    'feature-extraction',
    E5_MODEL_ID,
    {
      revision: QUANTIZED_MODEL_REVISION,
      cache_dir: cacheDir,
      local_files_only: !allowRemoteModels,
      dtype: 'fp32',
      device: 'cpu',
      model_file_name: QUANTIZED_MODEL_FILE,
    },
  );

  return {
    modelId: E5_MODEL_ID,
    modelRevision: QUANTIZED_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
    async embedQuery(text) {
      const output = await extractor(prefixOnce(text, 'query: '), {
        pooling: 'mean',
        normalize: true,
      });
      return vectorsFromOutput(output, 1)[0];
    },
    async embedPassages(texts) {
      const output = await extractor(
        texts.map((text) => prefixOnce(text, 'passage: ')),
        {
          pooling: 'mean',
          normalize: true,
        },
      );
      return vectorsFromOutput(output, texts.length);
    },
  };
}

function dot(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function cosine(left, right) {
  let leftNorm = 0;
  let rightNorm = 0;
  let product = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    product += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return product / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function semanticRank(passages, queryVector, targetIndex) {
  const ranked = passages
    .map((vector, index) => ({ index, similarity: dot(vector, queryVector) }))
    .sort((left, right) => (
      (right.similarity - left.similarity)
      || (left.index - right.index)
    ));
  return ranked.findIndex((entry) => entry.index === targetIndex) + 1;
}

async function prepareQuantizedCandidate() {
  const cacheDir = process.env.MEMORY_E5_QUANTIZED_CACHE;
  if (!cacheDir) throw new Error('MEMORY_E5_QUANTIZED_CACHE is required');
  const embedder = await createQuantizedCandidateEmbedder({
    cacheDir,
    allowRemoteModels: true,
  });
  const vector = await embedder.embedQuery('quantized candidate readiness probe');
  if (vector.length !== E5_DIMENSIONS) {
    throw new Error('quantized candidate readiness vector has wrong dimensions');
  }
  const cache = await directorySize(cacheDir);
  console.log(JSON.stringify({
    benchmark: 'quantized_candidate_prepare',
    model_id: E5_MODEL_ID,
    model_revision: QUANTIZED_MODEL_REVISION,
    model_file_name: QUANTIZED_MODEL_FILE,
    cache_bytes: cache.bytes,
    cache_mib: round(cache.bytes / (1024 * 1024)),
    cache_files: cache.files,
  }));
}

async function benchmarkQuantizedCandidate() {
  const baselineCacheDir = process.env.MEMORY_E5_MODEL_CACHE;
  const quantizedCacheDir = process.env.MEMORY_E5_QUANTIZED_CACHE;
  if (!baselineCacheDir || !quantizedCacheDir) {
    console.log(JSON.stringify({
      benchmark: 'quantized_candidate',
      skipped: true,
      reason: 'baseline or quantized cache is not configured',
    }));
    return;
  }

  const quantizedCache = await directorySize(quantizedCacheDir);

  const quantizedInitStarted = performance.now();
  const quantized = await createQuantizedCandidateEmbedder({
    cacheDir: quantizedCacheDir,
  });
  const quantizedInitMs = performance.now() - quantizedInitStarted;

  const firstStarted = performance.now();
  await quantized.embedQuery(
    'Which storage engine did we choose for concurrent writers?',
  );
  const firstQueryMs = performance.now() - firstStarted;

  const warmQuery = await measureAsync(
    7,
    () => quantized.embedQuery(
      'Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt?',
    ),
    { warmups: 1 },
  );

  const timingPassages = Array.from(
    { length: 32 },
    (_, index) => `passage benchmark ${index}: durable project memory for semantic retrieval`,
  );
  const passageBatch = await measureAsync(
    3,
    () => quantized.embedPassages(timingPassages),
    { warmups: 1 },
  );

  const baseline = await createE5Embedder({ cacheDir: baselineCacheDir });

  const documents = [
    'passage: decision database uses SQLite Accept SQLite for the initial local storage implementation.',
    'passage: decision database uses Postgres Supersede SQLite. Use Postgres because concurrent writers are required.',
    'passage: decision audit_logs retention 30 days Keep audit logs for 30 days.',
    'passage: decision request_retry max_attempts 3 Retry failed requests 3 times before surfacing the error.',
    ...Array.from(
      { length: 32 },
      (_, index) => `passage: decision build_preference_${index} value choice-${index} Unrelated build preference number ${index} for fixture noise.`,
    ),
  ];

  const cases = [
    {
      query: 'Which database was selected because concurrent writers are required?',
      targetIndex: 1,
    },
    {
      query: 'Which storage engine did we choose to handle multiple processes writing at once?',
      targetIndex: 1,
    },
    {
      query: 'Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt?',
      targetIndex: 1,
    },
    {
      query: 'For how long do we preserve security event records?',
      targetIndex: 2,
    },
  ];

  const baselinePassages = await baseline.embedPassages(documents);
  const quantizedPassages = await quantized.embedPassages(documents);

  const passageCosines = baselinePassages.map(
    (vector, index) => cosine(vector, quantizedPassages[index]),
  );
  const queryCosines = [];
  const ranks = [];

  for (const entry of cases) {
    const baselineQuery = await baseline.embedQuery(entry.query);
    const quantizedQuery = await quantized.embedQuery(entry.query);
    queryCosines.push(cosine(baselineQuery, quantizedQuery));

    const baselineRank = semanticRank(
      baselinePassages,
      baselineQuery,
      entry.targetIndex,
    );
    const quantizedRank = semanticRank(
      quantizedPassages,
      quantizedQuery,
      entry.targetIndex,
    );

    ranks.push({
      query: entry.query,
      baseline_rank: baselineRank,
      quantized_rank: quantizedRank,
      rank_delta: quantizedRank - baselineRank,
    });

    if (quantizedRank > 5) {
      throw new Error(
        `quantized candidate failed top-five parity for: ${entry.query}`,
      );
    }
  }

  console.log(JSON.stringify({
    benchmark: 'quantized_candidate',
    model_id: E5_MODEL_ID,
    model_revision: QUANTIZED_MODEL_REVISION,
    model_file_name: QUANTIZED_MODEL_FILE,
    cache_bytes: quantizedCache.bytes,
    cache_mib: round(quantizedCache.bytes / (1024 * 1024)),
    cache_files: quantizedCache.files,
    init_ms: round(quantizedInitMs),
    first_query_ms: round(firstQueryMs),
    warm_query: warmQuery,
    passage_batch_32: passageBatch,
    passage_per_item_median_ms: round(passageBatch.median_ms / timingPassages.length),
    passage_vector_cosine: {
      min: round(Math.min(...passageCosines)),
      median: round(median(passageCosines)),
      max: round(Math.max(...passageCosines)),
    },
    query_vector_cosine: {
      min: round(Math.min(...queryCosines)),
      median: round(median(queryCosines)),
      max: round(Math.max(...queryCosines)),
    },
    ranks,
  }));
}

console.log(JSON.stringify({
  benchmark: 'environment',
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu_count: os.cpus().length,
  cpu_model: os.cpus()[0]?.model ?? null,
  total_memory_mib: round(os.totalmem() / (1024 * 1024)),
}));

if (process.argv.includes('--prepare-quantized-cache')) {
  await prepareQuantizedCandidate();
} else {
  await benchmarkBruteForce();
  await benchmarkRealE5();
  await benchmarkQuantizedCandidate();
}
