import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = '.github/workflows/verify-reference-graph.yml';
const README = 'reference-graph/README.md';
const P11_HEAD = '541e9667ea28c75de5492b79d84edf89f9cac8ac';

function workflow() {
  return readFileSync(WORKFLOW, 'utf8');
}

test('permanent governance secret-scans optional P12 evidence with the P12 receipt contract', () => {
  const source = workflow();
  assert.match(source, /assertSecretFreeP12Receipt/);
  assert.match(source, /reference-graph\/evidence\/p12-activation-authority-evidence\.json/);
  assert.match(source, /assertSecretFreeP12Receipt\(value\)/);
});

test('permanent governance binds final P11 readiness and executes the P12 repository preflight', () => {
  const source = workflow();
  assert.match(source, new RegExp(P11_HEAD));
  assert.match(source, /p11-quick-activation-evidence\.json/);
  assert.match(source, /quick_activation_ready/);
  assert.match(source, /activation_performed/);
  assert.match(source, /reference-graph\/cli\/p12-activation-preflight\.mjs --plan/);
  assert.match(source, /reference-graph\/cli\/p12-activation-preflight\.mjs --verify-repository/);
  assert.match(source, /P12 activation binding/i);
});

test('permanent P12 source governance forbids benchmark leakage, privileged runtime credentials, and execution verbs', () => {
  const source = workflow();
  assert.match(source, /Verify P12 activation authority remains non-executable/);
  for (const path of [
    'reference-graph/p12-activation-authority.mjs',
    'reference-graph/p12-receipt.mjs',
    'reference-graph/cli/p12-activation-preflight.mjs',
  ]) {
    assert.ok(source.includes(path), `workflow must inspect ${path}`);
  }
  assert.match(source, /benchmarkForbidden/);
  assert.match(source, /privilegeForbidden/);
  assert.match(source, /executionVerbForbidden/);
  assert.match(source, /repository default graph mode changed/i);
  assert.match(source, /migration 010/i);
});

test('P12 adds no schema migration 010 or later and permanent migration execution still ends at 009', () => {
  const migrations = readdirSync('reference-graph/schema')
    .filter((name) => /^\d{3}_/.test(name))
    .sort();
  assert.equal(migrations.at(-1)?.slice(0, 3), '009');
  assert.equal(migrations.some((name) => /^01\d_/.test(name)), false);

  const source = workflow();
  assert.match(source, /009_reference_graph_runtime_projection\.sql/);
  assert.doesNotMatch(source, /010_[A-Za-z0-9_-]+\.sql/);
});

test('README separates P12 technical preflight readiness from activation authority', () => {
  const readme = readFileSync(README, 'utf8');
  assert.match(readme, /P12 activation authority preflight/i);
  assert.match(readme, /preflight_ready/);
  assert.match(readme, /binding_hash/);
  assert.match(readme, /grant_state.*not-issued/i);
  assert.match(readme, /activation_authorized.*false/i);
  assert.match(readme, /activation_performed.*false/i);
  assert.match(readme, /production_source.*legacy-control/i);
  assert.match(readme, /separate explicit operator.*authority/i);
});
