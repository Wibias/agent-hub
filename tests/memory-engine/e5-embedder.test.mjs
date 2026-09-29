import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeTensor(count, dimensions = 384, {
  value = 0.25,
  invalidIndex = null,
  invalidValue = Number.NaN,
} = {}) {
  const data = new Float32Array(count * dimensions).fill(value);
  if (invalidIndex !== null) data[invalidIndex] = invalidValue;
  return {
    data,
    dims: [count, dimensions],
  };
}

function createPipelineHarness({
  dimensions = 384,
  initError = null,
  invalidIndex = null,
  invalidValue = Number.NaN,
} = {}) {
  const calls = {
    factory: [],
    extractor: [],
  };

  const pipelineFactory = async (task, model, options) => {
    calls.factory.push({ task, model, options: { ...options } });
    if (initError) throw initError;

    return async (input, options) => {
      calls.extractor.push({ input, options: { ...options } });
      const count = Array.isArray(input) ? input.length : 1;
      return makeTensor(count, dimensions, { invalidIndex, invalidValue });
    };
  };

  return { calls, pipelineFactory };
}

test('e5 provider pins exact researched model identity and offline CPU fp32 options', async () => {
  const {
    E5_MODEL_ID,
    E5_MODEL_REVISION,
    E5_DIMENSIONS,
    createE5Embedder,
  } = await import('../../memory-engine/e5-embedder.mjs');

  assert.equal(E5_MODEL_ID, 'intfloat/multilingual-e5-small');
  assert.equal(
    E5_MODEL_REVISION,
    'fd1525a9fd15316a2d503bf26ab031a61d056e98',
  );
  assert.equal(E5_DIMENSIONS, 384);

  const { calls, pipelineFactory } = createPipelineHarness();
  const embedder = await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    pipelineFactory,
  });

  assert.deepEqual(calls.factory, [{
    task: 'feature-extraction',
    model: E5_MODEL_ID,
    options: {
      revision: E5_MODEL_REVISION,
      cache_dir: '/tmp/agent-hub-e5',
      local_files_only: true,
      dtype: 'fp32',
      device: 'cpu',
    },
  }]);
  assert.equal(embedder.modelId, E5_MODEL_ID);
  assert.equal(embedder.modelRevision, E5_MODEL_REVISION);
  assert.equal(embedder.dimensions, E5_DIMENSIONS);
});

test('explicit preparation mode changes only local_files_only', async () => {
  const { createE5Embedder } = await import('../../memory-engine/e5-embedder.mjs');
  const { calls, pipelineFactory } = createPipelineHarness();

  await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    allowRemoteModels: true,
    pipelineFactory,
  });

  assert.equal(calls.factory[0].options.local_files_only, false);
  assert.deepEqual(
    { ...calls.factory[0].options, local_files_only: true },
    {
      revision: 'fd1525a9fd15316a2d503bf26ab031a61d056e98',
      cache_dir: '/tmp/agent-hub-e5',
      local_files_only: true,
      dtype: 'fp32',
      device: 'cpu',
    },
  );
});

test('e5 provider applies exact query/passage prefixes and mean normalized extraction', async () => {
  const { createE5Embedder } = await import('../../memory-engine/e5-embedder.mjs');
  const { calls, pipelineFactory } = createPipelineHarness();

  const embedder = await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    pipelineFactory,
  });

  const queryVector = await embedder.embedQuery('Which storage engine?');
  const passageVectors = await embedder.embedPassages([
    'passage: database decision Postgres',
    'plain passage text',
  ]);

  assert.deepEqual(calls.extractor, [
    {
      input: 'query: Which storage engine?',
      options: { pooling: 'mean', normalize: true },
    },
    {
      input: [
        'passage: database decision Postgres',
        'passage: plain passage text',
      ],
      options: { pooling: 'mean', normalize: true },
    },
  ]);
  assert.ok(queryVector instanceof Float32Array);
  assert.equal(queryVector.length, 384);
  assert.equal(passageVectors.length, 2);
  assert.ok(passageVectors.every((vector) => vector instanceof Float32Array));
  assert.ok(passageVectors.every((vector) => vector.length === 384));
  assert.notEqual(passageVectors[0].buffer, passageVectors[1].buffer);
});

test('e5 provider rejects empty cache paths and empty embedding inputs', async () => {
  const { createE5Embedder } = await import('../../memory-engine/e5-embedder.mjs');
  const { pipelineFactory } = createPipelineHarness();

  await assert.rejects(
    () => createE5Embedder({ cacheDir: '', pipelineFactory }),
    /cacheDir/i,
  );

  const embedder = await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    pipelineFactory,
  });

  await assert.rejects(() => embedder.embedQuery(''), /query/i);
  await assert.rejects(() => embedder.embedPassages([]), /passage/i);
  await assert.rejects(() => embedder.embedPassages(['']), /passage/i);
});

test('e5 provider propagates pipeline initialization failure', async () => {
  const { createE5Embedder } = await import('../../memory-engine/e5-embedder.mjs');
  const { pipelineFactory } = createPipelineHarness({
    initError: new Error('model cache missing'),
  });

  await assert.rejects(
    () => createE5Embedder({
      cacheDir: '/tmp/agent-hub-e5',
      pipelineFactory,
    }),
    /model cache missing/,
  );
});

test('e5 provider rejects wrong tensor dimensions and non-finite values', async () => {
  const { createE5Embedder } = await import('../../memory-engine/e5-embedder.mjs');

  const wrongDimensions = await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    pipelineFactory: createPipelineHarness({ dimensions: 383 }).pipelineFactory,
  });
  await assert.rejects(
    () => wrongDimensions.embedQuery('database'),
    /384|dimension/i,
  );

  const nanOutput = await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    pipelineFactory: createPipelineHarness({
      invalidIndex: 0,
      invalidValue: Number.NaN,
    }).pipelineFactory,
  });
  await assert.rejects(
    () => nanOutput.embedQuery('database'),
    /finite/i,
  );

  const infiniteOutput = await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    pipelineFactory: createPipelineHarness({
      invalidIndex: 0,
      invalidValue: Number.POSITIVE_INFINITY,
    }).pipelineFactory,
  });
  await assert.rejects(
    () => infiniteOutput.embedPassages(['database']),
    /finite/i,
  );
});


test('model cache preparation parser requires one non-empty cache directory', async () => {
  const { parsePrepareModelArgs } = await import(
    '../../scripts/prepare-memory-embedding-model.mjs'
  );

  assert.throws(() => parsePrepareModelArgs([]), /--cache-dir/i);
  assert.throws(
    () => parsePrepareModelArgs(['--cache-dir', '']),
    /cache-dir|non-empty/i,
  );
  assert.throws(
    () => parsePrepareModelArgs([
      '--cache-dir',
      '.cache/one',
      '--cache-dir',
      '.cache/two',
    ]),
    /duplicate|once|cache-dir/i,
  );
  assert.throws(
    () => parsePrepareModelArgs(['--unknown', 'value']),
    /unknown|argument/i,
  );

  assert.deepEqual(
    parsePrepareModelArgs(['--cache-dir', '.cache/memory-engine/e5']),
    { cacheDir: '.cache/memory-engine/e5' },
  );
});

test('prepared cache can be reopened by the normal offline provider path', async () => {
  const { createE5Embedder } = await import('../../memory-engine/e5-embedder.mjs');
  const { calls, pipelineFactory } = createPipelineHarness();

  const prepared = await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    allowRemoteModels: true,
    pipelineFactory,
  });
  await prepared.embedQuery('memory cache readiness probe');

  const offline = await createE5Embedder({
    cacheDir: '/tmp/agent-hub-e5',
    pipelineFactory,
  });
  await offline.embedQuery('memory cache readiness probe');

  assert.equal(calls.factory.length, 2);
  assert.equal(calls.factory[0].options.local_files_only, false);
  assert.equal(calls.factory[1].options.local_files_only, true);
  assert.deepEqual(
    calls.factory.map((call) => ({
      model: call.model,
      revision: call.options.revision,
      cache_dir: call.options.cache_dir,
      dtype: call.options.dtype,
      device: call.options.device,
    })),
    [
      {
        model: 'intfloat/multilingual-e5-small',
        revision: 'fd1525a9fd15316a2d503bf26ab031a61d056e98',
        cache_dir: '/tmp/agent-hub-e5',
        dtype: 'fp32',
        device: 'cpu',
      },
      {
        model: 'intfloat/multilingual-e5-small',
        revision: 'fd1525a9fd15316a2d503bf26ab031a61d056e98',
        cache_dir: '/tmp/agent-hub-e5',
        dtype: 'fp32',
        device: 'cpu',
      },
    ],
  );
});


test('model cache preparation enables remote loading only for a 384d readiness probe', async () => {
  const { resolve } = await import('node:path');
  const {
    prepareMemoryEmbeddingModel,
  } = await import('../../scripts/prepare-memory-embedding-model.mjs');

  const calls = [];
  const logs = [];
  const createEmbedder = async (options) => {
    calls.push({ stage: 'create', options: { ...options } });
    return {
      modelId: 'intfloat/multilingual-e5-small',
      modelRevision: 'fd1525a9fd15316a2d503bf26ab031a61d056e98',
      dimensions: 384,
      async embedQuery(text) {
        calls.push({ stage: 'query', text });
        return new Float32Array(384).fill(0.125);
      },
    };
  };

  const result = await prepareMemoryEmbeddingModel({
    cacheDir: '.cache/memory-engine/e5',
    createEmbedder,
    log: (line) => logs.push(line),
  });

  const expectedCache = resolve('.cache/memory-engine/e5');
  assert.deepEqual(calls, [
    {
      stage: 'create',
      options: {
        cacheDir: expectedCache,
        allowRemoteModels: true,
      },
    },
    {
      stage: 'query',
      text: 'memory cache readiness probe',
    },
  ]);
  assert.deepEqual(result, {
    modelId: 'intfloat/multilingual-e5-small',
    modelRevision: 'fd1525a9fd15316a2d503bf26ab031a61d056e98',
    dimensions: 384,
    cacheDir: expectedCache,
  });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /intfloat\/multilingual-e5-small/);
  assert.match(logs[0], /fd1525a9fd15316a2d503bf26ab031a61d056e98/);
  assert.match(logs[0], /384/);
  assert.match(logs[0], /\.cache/);
});

test('model cache preparation rejects an invalid readiness vector', async () => {
  const {
    prepareMemoryEmbeddingModel,
  } = await import('../../scripts/prepare-memory-embedding-model.mjs');

  await assert.rejects(
    () => prepareMemoryEmbeddingModel({
      cacheDir: '.cache/memory-engine/e5',
      createEmbedder: async () => ({
        modelId: 'intfloat/multilingual-e5-small',
        modelRevision: 'fd1525a9fd15316a2d503bf26ab031a61d056e98',
        dimensions: 384,
        async embedQuery() {
          return new Float32Array(383);
        },
      }),
      log: () => {},
    }),
    /384|dimension/i,
  );
});


test('normal E5 provider fails offline against an empty model cache', async () => {
  const { createE5Embedder } = await import('../../memory-engine/e5-embedder.mjs');
  const cacheDir = await mkdtemp(join(tmpdir(), 'memory-engine-e5-empty-cache-'));

  await assert.rejects(
    () => createE5Embedder({ cacheDir }),
    /local|file|model|config|cache|not found|could not/i,
  );
});
