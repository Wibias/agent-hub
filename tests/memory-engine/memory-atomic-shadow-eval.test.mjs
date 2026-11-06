import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseAtomicShadowArgs,
  inspectAtomicShadowFile,
} from '../../scripts/inspect-memory-atomic-shadow.mjs';
import {
  evaluateAtomicShadowFixtures,
} from '../../scripts/eval-memory-atomic-shadow.mjs';
import { ATOMIC_SHADOW_FIXTURES } from '../../memory-engine/memory-atomic-shadow-fixtures.mjs';

test('shadow CLI rejects missing inputs and unsupported flags', () => {
  assert.throws(() => parseAtomicShadowArgs([]), /required/);
  assert.throws(() => parseAtomicShadowArgs(['--apply']), /unsupported/);
  assert.throws(() => parseAtomicShadowArgs(['--input-file']), /missing/);
  assert.throws(() => parseAtomicShadowArgs(['--input-file','source.txt','--input-file','other.txt']), /duplicate/);
  assert.equal(parseAtomicShadowArgs(['--input-file','source.txt']).showLocalContent, false);
  assert.equal(parseAtomicShadowArgs(['--input-file','source.txt','--show-local-content']).showLocalContent, true);
});

test('file inspector does not print private source text by default or mutate input', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'atomic-shadow-cli-'));
  try {
    const file = join(tmp, 'input.txt');
    const original = 'Fix an overlay today. In future reviews, always check seeded fixture data.';
    await writeFile(file, original);
    const report = await inspectAtomicShadowFile({ inputFile: file });
    assert.equal(report.mode, 'shadow_only');
    assert.equal(report.modelInvocations, 0);
    assert.equal(report.memoryDatabaseAccessed, false);
    assert.equal(report.writesToRepository, false);
    assert.equal(report.suggestions.length, 1);
    assert.equal(JSON.stringify(report).includes('seeded fixture data'), false);
    assert.equal(JSON.stringify(report).includes(original), false);
    const local = await inspectAtomicShadowFile({ inputFile: file, showLocalContent: true });
    assert.equal(local.suggestions[0].localSourceFragment,
      'In future reviews, always check seeded fixture data.');
    assert.equal(local.suggestions[0].localSourceFragment.includes('Fix an overlay'), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('synthetic evaluation reports fixture-level coverage and error counts without text', () => {
  const result = evaluateAtomicShadowFixtures();
  assert.equal(result.mode, 'synthetic_only');
  assert.equal(result.modelInvocations, 0);
  assert.equal(result.productionMemoriesRead, false);
  assert.equal(result.productionMemoriesWritten, false);
  assert.equal(result.measured.fixtures, ATOMIC_SHADOW_FIXTURES.length);
  assert.equal(result.measured.expectedReviewSuggestions, 8);
  assert.equal(result.measured.matched, 8);
  assert.equal(result.measured.missed, 0);
  assert.equal(result.measured.falsePositives, 0);
  assert.equal(result.measured.actualReviewSuggestions, 8);
  assert.equal(result.measured.precisionOnFixtures, 1);
  assert.equal(result.measured.recallOnFixtures, 1);
  assert.equal(JSON.stringify(result).includes('compatibility shim'), false);
  assert.equal(JSON.stringify(result).includes('supersecretpassword'), false);
});
