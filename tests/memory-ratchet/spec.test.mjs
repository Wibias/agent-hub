import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const here = new URL('./', import.meta.url);

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, here), 'utf8'));
}

test('memory ratchet case registry is frozen and complete', async () => {
  const registry = await readJson('cases.json');
  assert.equal(registry.spec_version, '0.1.0');
  assert.equal(registry.cases.length, 15);

  const expectedIds = Array.from({ length: 15 }, (_, index) => `M${String(index + 1).padStart(2, '0')}`);
  assert.deepEqual(registry.cases.map(({ id }) => id), expectedIds);
  assert.equal(new Set(registry.cases.map(({ id }) => id)).size, 15);
  assert.equal(registry.cases.reduce((sum, entry) => sum + entry.weight, 0), 100);

  for (const [index, entry] of registry.cases.entries()) {
    assert.equal(entry.hard_gate, index < 12, `${entry.id} hard-gate status drifted`);
    assert.ok(entry.title.length > 0, `${entry.id} is missing a title`);
    assert.ok(entry.gate.length > 0, `${entry.id} is missing a gate`);
    assert.ok(entry.setup.length > 0, `${entry.id} is missing setup`);
    assert.ok(entry.stimulus.length > 0, `${entry.id} is missing stimulus`);
    assert.ok(entry.pass.length > 0, `${entry.id} is missing pass assertions`);
    assert.ok(entry.forbidden.length > 0, `${entry.id} is missing forbidden behavior`);
  }
});

test('receipt schema is pinned to the same spec and verdict contract', async () => {
  const registry = await readJson('cases.json');
  const schema = await readJson('receipt.schema.json');

  assert.equal(schema.properties.spec_version.const, registry.spec_version);
  assert.deepEqual(schema.properties.verdict.enum, ['pass', 'fail', 'blocked']);
  assert.deepEqual(schema.properties.mode.enum, ['core', 'native']);
  assert.equal(schema.properties.case_id.pattern, '^M(0[1-9]|1[0-5])$');

  for (const required of [
    'candidate',
    'adapter',
    'fixture_revision',
    'mode',
    'case_id',
    'verdict',
    'assertions',
    'configuration',
    'metrics',
  ]) {
    assert.ok(schema.required.includes(required), `receipt schema must require ${required}`);
  }
});

test('spec declares every case and the frozen version', async () => {
  const spec = await readFile(new URL('SPEC.md', here), 'utf8');
  assert.match(spec, /Version: `0\.1\.0`/);
  for (let index = 1; index <= 15; index += 1) {
    const id = `M${String(index).padStart(2, '0')}`;
    assert.match(spec, new RegExp(`### ${id}\\b`), `${id} is missing from SPEC.md`);
  }
});
