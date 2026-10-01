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

test('isolated Codex home copies auth only and excludes config, hooks, and legacy memory state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-isolation-'));
  const source = join(root, 'source');
  const isolated = join(root, 'isolated');

  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'auth.json'), '{"token":"fixture"}\n');
  await writeFile(join(source, 'config.toml'), 'model = "legacy"\n');
  await writeFile(join(source, 'hooks.json'), '{"UserPromptSubmit":[]}\n');
  await writeFile(join(source, 'memories_1.sqlite'), 'legacy-memory');

  const result = await prepareIsolatedCodexHome({
    sourceCodexHome: source,
    isolatedCodexHome: isolated,
  });

  assert.deepEqual(result, {
    isolatedCodexHome: isolated,
    authCopied: true,
  });
  assert.equal(
    await readFile(join(isolated, 'auth.json'), 'utf8'),
    '{"token":"fixture"}\n',
  );

  for (const forbidden of [
    'config.toml',
    'hooks.json',
    'memories_1.sqlite',
  ]) {
    await assert.rejects(
      access(join(isolated, forbidden)),
      /ENOENT|no such file/i,
    );
  }
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
