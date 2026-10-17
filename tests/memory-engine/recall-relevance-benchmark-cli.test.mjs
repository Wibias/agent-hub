import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  parseRecallRelevanceBenchmarkArgs,
  runRecallRelevanceBenchmarkCli,
} from '../../scripts/eval-recall-relevance-selector.mjs';

test('benchmark CLI parser requires cases and defaults to low-cost judge settings', () => {
  assert.deepEqual(
    parseRecallRelevanceBenchmarkArgs(['--cases', 'cases.json'], '/repo'),
    {
      casesPath: resolve('/repo/cases.json'), model: null, reasoningEffort: 'low',
      timeoutMs: 8000, maxSelected: 8, json: false,
    },
  );
  assert.throws(() => parseRecallRelevanceBenchmarkArgs([], '/repo'), /--cases is required/u);
});

test('benchmark CLI reports quality, enablement gate, and aggregate model usage', async () => {
  const logs = [];
  let usageSink = null;
  const result = await runRecallRelevanceBenchmarkCli({
    argv: ['--cases', 'cases.json', '--json'],
    cwd: '/repo',
    log(value) { logs.push(value); },
    dependencies: {
      async readCases() {
        return [{
          id: 'db', query: 'db?',
          items: [{ claim: { id: 'c-db', state: 'active', value: 'Postgres' }, evidence: { authority_class: 'user_direct' } }],
          relevantClaimIds: ['c-db'],
        }];
      },
      async createRuntime({ onUsage }) {
        usageSink = onUsage;
        return {
          evaluatorId: 'codex:test:recall-relevance-v1',
          async judge() {
            await usageSink({
              stage: 'recall_relevance', evaluator_id: 'codex:test:recall-relevance-v1',
              status: 'success', duration_ms: 50,
              input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 0,
              output_tokens: 10, reasoning_output_tokens: 4,
            });
            return { selected_ids: ['c-db'], reason: 'direct' };
          },
          async close() {},
        };
      },
    },
  });

  assert.equal(result.evaluation.quality.precision, 1);
  assert.equal(result.enablement_gate.passed, true);
  assert.deepEqual(result.enablement_gate.failed_checks, []);
  assert.equal(result.model_usage.calls, 1);
  assert.equal(result.model_usage.input_tokens, 100);
  const logged = JSON.parse(logs[0]);
  assert.equal(logged.enablement_gate.policy_version, 'recall-relevance-enablement-v1');
  assert.equal(logged.model_usage.reasoning_output_tokens, 4);
});
