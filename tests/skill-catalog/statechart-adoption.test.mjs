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

test('formal verification owns the nested statechart compiler capability', async () => {
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
  assert.equal(
    await exists('skills/formal-verification/statechart/scripts/statechart.ts'),
    true,
    'current TypeScript compiler entrypoint must exist',
  );
  assert.equal(
    await exists('skills/formal-verification/statechart/scripts/statechart.mjs'),
    false,
    'retired MJS entrypoint must not survive the refresh',
  );

  const formal = await text('skills/formal-verification/SKILL.md');
  const contract = await text('skills/formal-verification/references/project-contract.md');
  const reference = await text('skills/formal-verification/references/statechart.md');

  assert.match(formal, /state machines|state-machine/i);
  assert.match(contract, /statechart\.md/i);
  assert.match(contract, /formal-verification.*(?:owns|owner)|(?:owns|owner).*formal-verification/i);
  assert.match(reference, /statechart\/scripts\/statechart(?:\.ts)?\s+SPEC\.tla/i);
  assert.match(reference, /from-chart.*removed|removed.*from-chart/i);
  assert.match(reference, /--against.*removed|removed.*--against/i);
  assert.match(reference, /--fixed.*removed|removed.*--fixed/i);
  assert.match(reference, /formal-verification.*(?:owns|owner)|(?:owns|owner).*formal-verification/i);
  assert.match(reference, /chart.*(?:not proof|not.*proof)|not.*proof.*chart/i);
  assert.match(reference, /replay.*(?:bug path|counterexample).*implementation|(?:bug path|counterexample).*replay.*implementation/i);
});

test('TLA/TLC handoffs use statechart as an interpretation layer without yielding verdict ownership', async () => {
  const contract = await text('skills/formal-verification/references/project-contract.md');
  const reference = await text('skills/formal-verification/references/statechart.md');

  assert.match(
    reference,
    /every.*(?:TLA\+|TLC).*handoff.*Statechart|Statechart.*every.*(?:TLA\+|TLC).*handoff/i,
  );
  assert.match(
    reference,
    /shortest.*(?:readable )?path|(?:counterexample|violation).*shortest.*path/i,
  );
  assert.match(reference, /500-state chart budget/i);
  assert.match(reference, /Never invent an overview/i);
  assert.match(
    reference,
    /chart.*(?:interpretation|presentation).*not proof|not proof.*chart/i,
  );
  assert.match(
    contract,
    /TLA\+\/TLC.*handoff.*Statechart|Statechart.*TLA\+\/TLC.*handoff/i,
  );
});

test('statechart vendor pin, compiler lineage, render reference, and MIT attribution stay explicit', async () => {
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
  assert.equal(
    await exists('skills/formal-verification/statechart/references/render.md'),
    true,
    'vendored upstream render guidance must exist',
  );

  const upstream = await text('skills/formal-verification/statechart/UPSTREAM.md');
  const license = await text('skills/formal-verification/statechart/LICENSE');

  assert.match(upstream, /cursor\/plugins/);
  assert.match(upstream, /c742dd61706fbacc1b95f1a20b7b988cf096ce6c/);
  assert.match(upstream, /34b1b7c96f09f81a21a6c78f65b7833f7dcb5b24/);
  assert.match(upstream, /740d2c0786246cafac41906198f656b135194d3b/);
  assert.match(upstream, /pstack\/skills\/statechart\/scripts/);
  assert.match(upstream, /pstack\/skills\/statechart\/references\/render\.md/);
  assert.match(upstream, /byte-identical|byte-for-byte/i);
  assert.match(upstream, /excludes.*scripts\/test|scripts\/test.*excludes/i);
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Lauren Tan/);
});
