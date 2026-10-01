import {
  copyFile,
  mkdir,
} from 'node:fs/promises';
import { join } from 'node:path';

export const MEMORY_BEHAVIORAL_CASES = Object.freeze([
  Object.freeze({
    id: 'compliance-exact',
    question: 'How long do we retain widget telemetry for compliance audits?',
    expected: Object.freeze({
      supported: true,
      answer: '37 days',
    }),
  }),
  Object.freeze({
    id: 'compliance-paraphrase',
    question: 'What is the retention window for widget telemetry kept to satisfy compliance reviews?',
    expected: Object.freeze({
      supported: true,
      answer: '37 days',
    }),
  }),
  Object.freeze({
    id: 'performance-debugging-hard-negative',
    question: 'How long do we retain widget telemetry for performance debugging?',
    expected: Object.freeze({
      supported: false,
      answer: null,
    }),
  }),
  Object.freeze({
    id: 'product-analytics-hard-negative',
    question: 'How long do we retain widget telemetry for product analytics?',
    expected: Object.freeze({
      supported: false,
      answer: null,
    }),
  }),
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeAnswer(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.?!]+$/u, '')
    .replace(/\s+/g, ' ');
}

export function buildMemoryBehavioralPrompt({
  additionalContext,
  question,
}) {
  if (!nonEmptyString(additionalContext)) {
    throw new TypeError('additionalContext must be a non-empty string');
  }
  if (!nonEmptyString(question)) {
    throw new TypeError('question must be a non-empty string');
  }

  return [
    'Evaluate whether the injected memory context directly supports the exact user question.',
    'Do not use tools. Do not use prior or global memory, previous conversations, repository files, or outside knowledge.',
    'Use only the injected memory context below and follow its authority, lifecycle, scope, and direct-support rules.',
    'Return JSON only with exactly these fields:',
    '{"supported":true|false,"answer":"concise value"|null,"reason":"short explanation"}',
    'Set "answer" to null when unsupported. Do not guess missing qualifiers or transfer a value to a different scope.',
    '',
    'INJECTED MEMORY CONTEXT',
    additionalContext.trim(),
    '',
    'USER QUESTION',
    question.trim(),
  ].join('\n');
}

export function parseMemoryBehavioralResponse(text) {
  if (!nonEmptyString(text)) {
    throw new TypeError('Codex behavioral response must be non-empty JSON');
  }

  let raw = text.trim();
  const fenced = raw.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  if (fenced) raw = fenced[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TypeError(
      `Codex behavioral response must be JSON: ${error.message}`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Codex behavioral JSON must be an object');
  }
  if (typeof parsed.supported !== 'boolean') {
    throw new TypeError('Codex behavioral JSON supported must be boolean');
  }
  if (!(parsed.answer === null || typeof parsed.answer === 'string')) {
    throw new TypeError('Codex behavioral JSON answer must be string or null');
  }
  if (!nonEmptyString(parsed.reason)) {
    throw new TypeError('Codex behavioral JSON reason must be a non-empty string');
  }

  return {
    supported: parsed.supported,
    answer: parsed.answer,
    reason: parsed.reason.trim(),
  };
}

export function scoreMemoryBehavioralCase(caseSpec, response) {
  if (!caseSpec?.expected || typeof caseSpec.expected.supported !== 'boolean') {
    throw new TypeError('caseSpec.expected.supported must be boolean');
  }
  if (!response || typeof response.supported !== 'boolean') {
    throw new TypeError('response.supported must be boolean');
  }

  const failures = [];
  if (response.supported !== caseSpec.expected.supported) {
    failures.push(
      `supported expected ${caseSpec.expected.supported} but received ${response.supported}`,
    );
  }

  if (caseSpec.expected.answer === null) {
    if (response.answer !== null) {
      failures.push(
        `answer must be null for unsupported scope, received ${JSON.stringify(response.answer)}`,
      );
    }
  } else if (
    typeof response.answer !== 'string'
    || normalizeAnswer(response.answer) !== normalizeAnswer(caseSpec.expected.answer)
  ) {
    failures.push(
      `answer expected ${JSON.stringify(caseSpec.expected.answer)} but received ${JSON.stringify(response.answer)}`,
    );
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

export async function prepareIsolatedCodexHome({
  sourceCodexHome,
  isolatedCodexHome,
}) {
  if (!nonEmptyString(sourceCodexHome)) {
    throw new TypeError('sourceCodexHome must be a non-empty string');
  }
  if (!nonEmptyString(isolatedCodexHome)) {
    throw new TypeError('isolatedCodexHome must be a non-empty string');
  }

  await mkdir(isolatedCodexHome, { recursive: true });

  let authCopied = false;
  try {
    await copyFile(
      join(sourceCodexHome, 'auth.json'),
      join(isolatedCodexHome, 'auth.json'),
    );
    authCopied = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return {
    isolatedCodexHome,
    authCopied,
  };
}

export function createIsolatedCodexEnv(
  baseEnv,
  isolatedCodexHome,
) {
  if (!baseEnv || typeof baseEnv !== 'object' || Array.isArray(baseEnv)) {
    throw new TypeError('baseEnv must be an environment object');
  }
  if (!nonEmptyString(isolatedCodexHome)) {
    throw new TypeError('isolatedCodexHome must be a non-empty string');
  }

  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (key.startsWith('AGENT_HUB_MEMORY_')) delete env[key];
  }
  env.CODEX_HOME = isolatedCodexHome;
  return env;
}

export async function runMemoryBehavioralCases({
  cases = MEMORY_BEHAVIORAL_CASES,
  getAdditionalContext,
  runCodex,
}) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new TypeError('cases must be a non-empty array');
  }
  if (typeof getAdditionalContext !== 'function') {
    throw new TypeError('getAdditionalContext must be a function');
  }
  if (typeof runCodex !== 'function') {
    throw new TypeError('runCodex must be a function');
  }

  const results = [];

  for (const caseSpec of cases) {
    try {
      const additionalContext = await getAdditionalContext(caseSpec);
      if (!nonEmptyString(additionalContext)) {
        throw new Error('memory hook produced no additionalContext');
      }

      const prompt = buildMemoryBehavioralPrompt({
        additionalContext,
        question: caseSpec.question,
      });
      const rawResponse = await runCodex({
        caseSpec,
        prompt,
        additionalContext,
      });
      const response = parseMemoryBehavioralResponse(rawResponse);
      const scored = scoreMemoryBehavioralCase(caseSpec, response);

      results.push({
        id: caseSpec.id,
        question: caseSpec.question,
        expected: caseSpec.expected,
        response,
        pass: scored.pass,
        failures: scored.failures,
      });
    } catch (error) {
      results.push({
        id: caseSpec.id,
        question: caseSpec.question,
        expected: caseSpec.expected,
        response: null,
        pass: false,
        failures: [
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  }

  const passedCases = results.filter((item) => item.pass).length;
  return {
    pass: passedCases === results.length,
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    cases: results,
  };
}
