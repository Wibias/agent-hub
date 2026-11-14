import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMemoryCandidateJudgment } from '../../memory-engine/memory-candidate-judge.mjs';
import { codexCandidateFailureCode } from '../../memory-engine/codex-candidate-process-error.mjs';

const valid = {
  decision: 'promote',
  suggested_type: 'decision',
  durability: 'long',
  future_utility: 'high',
  specificity: 'high',
  confidence: 'high',
  meaning_preserved: true,
  canonical_fact: 'This project uses SQLite for durable memory.',
  reason: 'Explicit durable architecture decision.',
  risk_flags: [],
};

test('judge parses optional JSON fences with LF and CRLF, without loosening schema', () => {
  const raw = JSON.stringify(valid);
  assert.equal(parseMemoryCandidateJudgment(raw).canonical_fact, valid.canonical_fact);
  for (const fence of ['json', '']) {
    for (const sep of ['\n', '\r\n']) {
      const wrapped = '```' + fence + sep + raw + sep + '```';
      assert.equal(parseMemoryCandidateJudgment(wrapped).canonical_fact, valid.canonical_fact);
    }
  }
  assert.throws(() => parseMemoryCandidateJudgment('```json\n{}\n```'));
});

test('both judge call sites use sanitized process error codes, never raw output', () => {
  for (const script of ['judge-memory-candidates.mjs', 'judge-memory-relations.mjs']) {
    const source = readFileSync(new URL('../../scripts/' + script, import.meta.url), 'utf8');
    assert.match(source, /codexCandidateFailureCode\(executed\)/);
    assert.match(source, /codexCandidateLaunchFailureCode\(error\)/);
    assert.doesNotMatch(source, /executed\.(?:stderr|stdout)\.trim\(\)/);
  }
  assert.equal(codexCandidateFailureCode({
    stderr: 'HTTP 429 private-token=VERYPRIVATE',
    stdout: 'user claim PRIVATE',
  }), 'rate_limit');
});
