import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '../..');
const text = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');
const exists = async (relativePath) => {
  try {
    await access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
};

test('formal verification owns the nested statechart capability', async () => {
  assert.equal(
    await exists('skills/formal-verification/references/statechart.md'),
    true,
    'statechart integration reference must exist',
  );
  assert.equal(
    await exists('skills/statechart/SKILL.md'),
    false,
    'statechart must not become a competing top-level skill owner',
  );

  const formal = await text('skills/formal-verification/SKILL.md');
  const contract = await text('skills/formal-verification/references/project-contract.md');
  const reference = await text('skills/formal-verification/references/statechart.md');

  assert.match(formal, /state machines|state-machine/i);
  assert.match(contract, /statechart\.md/i);
  assert.match(contract, /formal-verification.*(?:owns|owner)|(?:owns|owner).*formal-verification/i);
  assert.match(reference, /from-spec/);
  assert.match(reference, /from-chart/);
  assert.match(reference, /\brender\b/);
  assert.match(reference, /formal-verification.*(?:owns|owner)|(?:owns|owner).*formal-verification/i);
  assert.match(reference, /chart.*not.*proof|not.*proof.*chart/i);
  assert.match(reference, /replay.*counterexample.*code|counterexample.*replay.*code/i);
});

test('statechart vendor pin and MIT attribution stay explicit', async () => {
  assert.equal(
    await exists('skills/formal-verification/statechart/UPSTREAM.md'),
    true,
    'statechart upstream pin must exist',
  );
  assert.equal(
    await exists('skills/formal-verification/statechart/LICENSE'),
    true,
    'statechart MIT license must be retained',
  );

  const upstream = await text('skills/formal-verification/statechart/UPSTREAM.md');
  const license = await text('skills/formal-verification/statechart/LICENSE');

  assert.match(upstream, /cursor\/plugins/);
  assert.match(upstream, /076f4b2f57844ff9eb4ada914d4763884d40146e/);
  assert.match(upstream, /pstack\/skills\/statechart\/scripts/);
  assert.match(upstream, /byte-identical|byte-for-byte/i);
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Lauren Tan/);
});
