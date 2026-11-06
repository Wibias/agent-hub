#!/usr/bin/env node
/**
 * D12.3 offline comparison against hand-labeled, synthetic fixtures only.
 * This measures deterministic review proposal coverage, not model judgment
 * accuracy or production memory quality. No real user data or provider calls.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyMemoryCandidatePrompt } from '../memory-engine/memory-capture-policy.mjs';
import { proposeAtomicCandidateShadows } from '../memory-engine/memory-atomic-candidate-shadow.mjs';
import { ATOMIC_SHADOW_FIXTURES } from '../memory-engine/memory-atomic-shadow-fixtures.mjs';

const key = ({ fragment, disposition }) => JSON.stringify([fragment, disposition]);

export function evaluateAtomicShadowFixtures(fixtures = ATOMIC_SHADOW_FIXTURES) {
  let matched = 0;
  let missed = 0;
  let falsePositives = 0;
  let baselineWholePromptCaptured = 0;
  let actualSuggestions = 0;
  const cases = [];

  for (const fixture of fixtures) {
    if (!fixture || typeof fixture.source !== 'string' || !Array.isArray(fixture.expected)) {
      throw new TypeError('invalid fixture');
    }
    const baseline = classifyMemoryCandidatePrompt(fixture.source);
    if (baseline !== null) baselineWholePromptCaptured += 1;
    const result = proposeAtomicCandidateShadows(fixture.source);
    const expected = new Set(fixture.expected.map(key));
    const found = new Set(result.suggestions.map(suggestion => {
      if (fixture.source.slice(suggestion.start, suggestion.end) !== suggestion.fragment) {
        throw new Error('shadow excerpt source attribution invariant failed');
      }
      return key(suggestion);
    }));
    let caseMatched = 0;
    for (const value of found) {
      if (expected.has(value)) caseMatched += 1;
      else falsePositives += 1;
    }
    matched += caseMatched;
    missed += [...expected].filter(value => !found.has(value)).length;
    actualSuggestions += found.size;
    cases.push({
      fixture: fixture.id,
      expectedSuggestions: expected.size,
      observedSuggestions: found.size,
      matched: caseMatched,
      falsePositives: [...found].filter(value => !expected.has(value)).length,
      missed: [...expected].filter(value => !found.has(value)).length,
      baselineWholePromptCaptured: baseline !== null,
    });
  }

  return {
    type: 'agent_hub_memory_atomic_shadow_eval_v1',
    mode: 'synthetic_only',
    modelInvocations: 0,
    productionMemoriesRead: false,
    productionMemoriesWritten: false,
    measured: {
      fixtures: fixtures.length,
      baselineWholePromptCaptured,
      expectedReviewSuggestions: matched + missed,
      actualReviewSuggestions: actualSuggestions,
      matched,
      missed,
      falsePositives,
      precisionOnFixtures: actualSuggestions ? matched / actualSuggestions : null,
      recallOnFixtures: matched + missed ? matched / (matched + missed) : null,
    },
    cases,
    limits: [
      'Hand-labeled synthetic fixtures are not representative of production messages.',
      'Precision and recall here describe deterministic review proposals, not correctness of the model or promotions.',
      'The existing baseline creates whole-prompt candidates; its judgment precision is not measured here.',
    ],
  };
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw new Error('unsupported args');
    console.log(JSON.stringify(evaluateAtomicShadowFixtures(), null, 2));
  } catch {
    console.error('Atomic shadow evaluation failed.');
    process.exitCode = 1;
  }
}
