import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildMemoryBehavioralPrompt,
  createIsolatedCodexEnv,
  MEMORY_BEHAVIORAL_CASES,
  parseMemoryBehavioralResponse,
  prepareIsolatedCodexHome,
  runMemoryBehavioralCases,
  scoreMemoryBehavioralCase,
} from '../../memory-engine/codex-memory-behavioral-eval.mjs';

test('memory behavioral fixture covers exact positive, paraphrase positive, and scoped hard negatives', () => {
  assert.deepEqual(
    MEMORY_BEHAVIORAL_CASES.map((item) => ({
      id: item.id,
      supported: item.expected.supported,
      answer: item.expected.answer,
    })),
    [
      {
        id: 'compliance-exact',
        supported: true,
        answer: '37 days',
      },
      {
        id: 'compliance-paraphrase',
        supported: true,
        answer: '37 days',
      },
      {
        id: 'performance-debugging-hard-negative',
        supported: false,
        answer: null,
      },
      {
        id: 'product-analytics-hard-negative',
        supported: false,
        answer: null,
      },
    ],
  );
});

test('behavioral prompt binds exact injected context and requires machine-readable support judgment', () => {
  const prompt = buildMemoryBehavioralPrompt({
    additionalContext: [
      'Memory evidence for the current project.',
      '- widget telemetry compliance audits: 37 days',
    ].join('\n'),
    question: 'How long do we retain widget telemetry for product analytics?',
  });

  assert.match(prompt, /injected memory context/i);
  assert.match(prompt, /widget telemetry compliance audits: 37 days/);
  assert.match(prompt, /product analytics/);
  assert.match(prompt, /"supported"/);
  assert.match(prompt, /"answer"/);
  assert.match(prompt, /answer.*null.*unsupported/i);
  assert.match(prompt, /do not use.*prior.*memory/i);
  assert.match(prompt, /do not.*tools/i);
});

test('behavioral response parser accepts plain or fenced JSON and rejects prose-only output', () => {
  assert.deepEqual(
    parseMemoryBehavioralResponse(
      '{"supported":true,"answer":"37 days","reason":"direct support"}',
    ),
    {
      supported: true,
      answer: '37 days',
      reason: 'direct support',
    },
  );

  assert.deepEqual(
    parseMemoryBehavioralResponse([
      '```json',
      '{"supported":false,"answer":null,"reason":"wrong scope"}',
      '```',
    ].join('\n')),
    {
      supported: false,
      answer: null,
      reason: 'wrong scope',
    },
  );

  assert.throws(
    () => parseMemoryBehavioralResponse('The answer is 37 days.'),
    /json/i,
  );
});

test('behavioral case scorer requires supported positives and null answers for hard negatives', () => {
  const positive = MEMORY_BEHAVIORAL_CASES[0];
  const negative = MEMORY_BEHAVIORAL_CASES[2];

  assert.deepEqual(
    scoreMemoryBehavioralCase(positive, {
      supported: true,
      answer: '37 days',
      reason: 'direct user memory',
    }),
    {
      pass: true,
      failures: [],
    },
  );

  assert.deepEqual(
    scoreMemoryBehavioralCase(negative, {
      supported: false,
      answer: null,
      reason: 'memory is scoped to compliance audits',
    }),
    {
      pass: true,
      failures: [],
    },
  );

  const leaked = scoreMemoryBehavioralCase(negative, {
    supported: true,
    answer: '37 days',
    reason: 'same telemetry topic',
  });
  assert.equal(leaked.pass, false);
  assert.ok(leaked.failures.some((failure) => /supported/i.test(failure)));
  assert.ok(leaked.failures.some((failure) => /answer/i.test(failure)));
});

test('isolated Codex home copies auth and only model routing config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-isolation-'));
  const source = join(root, 'source');
  const isolated = join(root, 'isolated');

  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'auth.json'), '{"token":"fixture"}\n');
  await writeFile(join(source, 'config.toml'), [
    'model = "legacy"',
    'openai_base_url = "http://127.0.0.1:10100/v1"',
    'notify = [ "must-not-copy" ]',
    '[features]',
    'memories = true',
    '[mcp_servers.private]',
    'command = "must-not-copy"',
    '[hooks]',
    'must_not_copy = true',
    '',
  ].join('\n'));
  await writeFile(join(source, 'hooks.json'), '{"UserPromptSubmit":[]}\n');
  await writeFile(join(source, 'memories_1.sqlite'), 'legacy-memory');

  const result = await prepareIsolatedCodexHome({
    sourceCodexHome: source,
    isolatedCodexHome: isolated,
  });

  assert.deepEqual(result, {
    isolatedCodexHome: isolated,
    authCopied: true,
    modelConfigCopied: true,
  });
  assert.equal(
    await readFile(join(isolated, 'auth.json'), 'utf8'),
    '{"token":"fixture"}\n',
  );

  assert.equal(
    await readFile(join(isolated, 'config.toml'), 'utf8'),
    'model = "legacy"\nopenai_base_url = "http://127.0.0.1:10100/v1"\n',
  );

  for (const forbidden of [
    'hooks.json',
    'memories_1.sqlite',
  ]) {
    await assert.rejects(
      access(join(isolated, forbidden)),
      /ENOENT|no such file/i,
    );
  }

  const isolatedConfig = await readFile(join(isolated, 'config.toml'), 'utf8');
  for (const forbidden of [
    'notify',
    '[features]',
    '[mcp_servers]',
    '[hooks]',
    'must-not-copy',
  ]) {
    assert.equal(isolatedConfig.includes(forbidden), false);
  }
});

test('isolated Codex home omits config when no model routing exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-isolation-empty-'));
  const source = join(root, 'source');
  const isolated = join(root, 'isolated');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'auth.json'), '{"token":"fixture"}\n');

  const result = await prepareIsolatedCodexHome({
    sourceCodexHome: source,
    isolatedCodexHome: isolated,
  });

  assert.equal(result.modelConfigCopied, false);
  await assert.rejects(
    access(join(isolated, 'config.toml')),
    /ENOENT|no such file/i,
  );
});


test('isolated Codex environment points at fresh CODEX_HOME and strips Agent Hub memory overrides', () => {
  const env = createIsolatedCodexEnv({
    PATH: 'fixture-path',
    CODEX_HOME: '/legacy/codex',
    AGENT_HUB_MEMORY_DB: '/legacy/memory.sqlite3',
    AGENT_HUB_MEMORY_PROJECT_ID: 'legacy-project',
    AGENT_HUB_MEMORY_REPO_IDENTITY: 'legacy-repo',
    AGENT_HUB_MEMORY_CAPTURE_PROMPTS: 'true',
    KEEP_ME: 'yes',
  }, '/isolated/codex');

  assert.equal(env.CODEX_HOME, '/isolated/codex');
  assert.equal(env.PATH, 'fixture-path');
  assert.equal(env.KEEP_ME, 'yes');
  assert.equal('AGENT_HUB_MEMORY_DB' in env, false);
  assert.equal('AGENT_HUB_MEMORY_PROJECT_ID' in env, false);
  assert.equal('AGENT_HUB_MEMORY_REPO_IDENTITY' in env, false);
  assert.equal('AGENT_HUB_MEMORY_CAPTURE_PROMPTS' in env, false);
});

test('real behavioral runner module imports without executing provider-backed work', async () => {
  const runner = await import('../../scripts/eval-codex-memory-behavior.mjs');
  assert.ok(runner && typeof runner === 'object');
});

test('behavioral runner evaluates every case and emits one aggregate pass/fail summary', async () => {
  const seen = [];

  const result = await runMemoryBehavioralCases({
    cases: MEMORY_BEHAVIORAL_CASES,
    async getAdditionalContext(item) {
      seen.push(['context', item.id]);
      return 'Memory evidence: compliance audits = 37 days';
    },
    async runCodex({ caseSpec, prompt }) {
      seen.push(['codex', caseSpec.id, prompt.includes(caseSpec.question)]);
      if (caseSpec.expected.supported) {
        return '{"supported":true,"answer":"37 days","reason":"direct support"}';
      }
      return '{"supported":false,"answer":null,"reason":"scope not supported"}';
    },
  });

  assert.equal(result.pass, true);
  assert.equal(result.totalCases, 4);
  assert.equal(result.passedCases, 4);
  assert.equal(result.failedCases, 0);
  assert.equal(result.cases.every((item) => item.pass), true);
  assert.equal(seen.filter(([kind]) => kind === 'context').length, 4);
  assert.equal(seen.filter(([kind]) => kind === 'codex').length, 4);
});

test('isolated Codex home copies the configured relative catalog and rebases its path', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-model-catalog-'));
  const source = join(root, 'source');
  const isolated = join(root, 'isolated');
  await mkdir(source, { recursive: true });
  const catalog = JSON.stringify({ models: [{ slug: 'fixture-model' }] });
  await writeFile(join(source, 'catalog with spaces.json'), catalog);
  const original = 'model = "fixture-model"\nmodel_catalog_json = "catalog with spaces.json" # configured\n[features]\nmemories = true\n';
  await writeFile(join(source, 'config.toml'), original);
  await writeFile(join(source, 'unrelated.json'), '{}');
  await prepareIsolatedCodexHome({ sourceCodexHome: source, isolatedCodexHome: isolated });
  const config = await readFile(join(isolated, 'config.toml'), 'utf8');
  const destination = JSON.parse(config.match(/^model_catalog_json = (.+)$/m)[1]);
  assert.equal(destination, join(isolated, 'model-catalog.json'));
  assert.equal(await readFile(destination, 'utf8'), catalog);
  assert.equal(await readFile(join(source, 'config.toml'), 'utf8'), original);
  assert.doesNotMatch(config, /features|memories/);
  await assert.rejects(access(join(isolated, 'unrelated.json')), /ENOENT/);
});

test('isolated Codex home handles an explicit absolute catalog path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-absolute-catalog-'));
  const source = join(root, 'source');
  const isolated = join(root, 'isolated');
  const catalogPath = join(root, 'catalog.json');
  await mkdir(source, { recursive: true });
  await writeFile(catalogPath, '{"models":[]}');
  await writeFile(join(source, 'config.toml'), 'model_catalog_json = '+JSON.stringify(catalogPath)+'\n');
  await prepareIsolatedCodexHome({ sourceCodexHome: source, isolatedCodexHome: isolated });
  assert.equal(await readFile(join(isolated, 'model-catalog.json'), 'utf8'), '{"models":[]}');
});

test('missing or invalid configured catalog fails explicitly rather than dropping routing config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-invalid-catalog-'));
  const source = join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'config.toml'), "model_catalog_json = 'missing.json'\n");
  await assert.rejects(prepareIsolatedCodexHome({sourceCodexHome: source, isolatedCodexHome: join(root,'first')}), /CODEX_ISOLATED_MODEL_CATALOG_MISSING/);
  await writeFile(join(source, 'missing.json'), '{"not_models":true}');
  await assert.rejects(prepareIsolatedCodexHome({sourceCodexHome: source, isolatedCodexHome: join(root,'second')}), /CODEX_ISOLATED_MODEL_CATALOG_INVALID/);
});
