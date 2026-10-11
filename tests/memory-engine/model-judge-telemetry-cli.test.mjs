import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  parseModelJudgeUsageArgs,
  runModelJudgeUsageCli,
} from '../../scripts/memory-model-usage.mjs';

test('model usage CLI parser is read-only and supports cwd/db/json', () => {
  assert.deepEqual(parseModelJudgeUsageArgs([], '/repo'), {
    cwd: resolve('/repo'), dbPath: null, json: false,
  });
  assert.equal(parseModelJudgeUsageArgs(['--json'], '/repo').json, true);
  assert.throws(() => parseModelJudgeUsageArgs(['--apply'], '/repo'), /unknown argument/u);
});

test('model usage CLI resolves current scope and returns telemetry summary', async () => {
  const output = [];
  const result = await runModelJudgeUsageCli({
    argv: ['--db-path', '/state/memory.sqlite3', '--json'],
    cwd: '/repo',
    log(value) { output.push(value); },
    runtime: {
      resolveGitContext() {
        return { repoPath: '/repo', branch: 'main', revisionSha: 'abc' };
      },
      resolveCodexProjectScope() {
        return { projectId: 'project-a', repoIdentity: 'project-a', canonicalRemote: null };
      },
      defaultCodexMemoryDbPath() { return '/default.sqlite3'; },
      createStore() {
        return {
          summary({ projectId, branch }) {
            assert.equal(projectId, 'project-a');
            assert.equal(branch, 'main');
            return {
              calls: 3, failures: 1, duration_ms: 1200,
              input_tokens: 100, cached_input_tokens: 40,
              cache_write_input_tokens: 0, output_tokens: 20,
              reasoning_output_tokens: 8,
              by_stage: { evidence_importance: { calls: 3, failures: 1, duration_ms: 1200 } },
            };
          },
          close() {},
        };
      },
    },
  });

  assert.equal(result.projectId, 'project-a');
  assert.equal(result.branch, 'main');
  assert.equal(result.usage.calls, 3);
  assert.equal(output.length, 1);
  assert.equal(JSON.parse(output[0]).usage.input_tokens, 100);
});
