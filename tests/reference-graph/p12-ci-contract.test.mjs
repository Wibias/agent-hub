import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { assertSecretFreeP12Receipt } from '../../reference-graph/p12-receipt.mjs';

const WORKFLOW = '.github/workflows/verify-reference-graph.yml';
const DOC = 'reference-graph/P12.md';
const P11_EVIDENCE = 'reference-graph/evidence/p11-quick-activation-evidence.json';
const P12_EVIDENCE = 'reference-graph/evidence/p12-activation-authority-evidence.json';
const P11_HEAD = '541e9667ea28c75de5492b79d84edf89f9cac8ac';
const P11_IMPLEMENTATION = '849a8782be4081a5821bdb354e54c33b2e2b0fb9';

function runOperator(args) {
  return spawnSync(process.execPath, ['reference-graph/cli/p12-activation-preflight.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

test('existing permanent Reference Graph workflow executes the full P12 test contract', () => {
  const source = readFileSync(WORKFLOW, 'utf8');
  assert.match(source, /node --test tests\/reference-graph\/\*\.test\.mjs/);
  assert.match(source, /scan_secrets\.py reference-graph/);
  assert.match(source, /009_reference_graph_runtime_projection\.sql/);
  assert.doesNotMatch(source, /010_[A-Za-z0-9_-]+\.sql/);
});

test('permanent P12 contract secret-scans durable evidence whenever it exists', () => {
  if (!existsSync(P12_EVIDENCE)) return;
  const value = JSON.parse(readFileSync(P12_EVIDENCE, 'utf8'));
  assert.equal(assertSecretFreeP12Receipt(value), true);
  assert.equal(value.schema_version, 'reference-graph.p12-activation-authority.v1');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
});

test('permanent governance pins final P11 readiness and the P12 repository binding', () => {
  const p11 = JSON.parse(readFileSync(P11_EVIDENCE, 'utf8'));
  assert.equal(p11.schema_version, 'reference-graph.p11-activation-readiness.v1');
  assert.equal(p11.git_sha, P11_IMPLEMENTATION);
  assert.equal(p11.quick_activation_ready, true);
  assert.equal(p11.production_source, 'legacy-control');
  assert.equal(p11.repository_default_graph_enabled, false);
  assert.equal(p11.activation_performed, false);

  const plan = runOperator(['--plan']);
  assert.equal(plan.status, 0, plan.stderr);
  const planValue = JSON.parse(plan.stdout);
  assert.equal(planValue.grant_state, 'not-issued');
  assert.equal(planValue.activation_authorized, false);
  assert.equal(planValue.activation_performed, false);
  assert.equal(planValue.repository_default_graph_enabled, false);
  assert.equal(planValue.production_source, 'legacy-control');

  const repository = runOperator(['--verify-repository']);
  assert.equal(repository.status, 0, repository.stderr);
  const repositoryValue = JSON.parse(repository.stdout);
  assert.equal(repositoryValue.activation_binding.p11_evidence_head, P11_HEAD);
  assert.equal(repositoryValue.activation_binding.p11_implementation_sha, P11_IMPLEMENTATION);
  assert.equal(repositoryValue.repository.p11_evidence_head_matches, true);
  assert.equal(repositoryValue.repository.repository_default_graph_enabled, false);
  assert.equal(repositoryValue.repository.migration_010_present, false);
  assert.equal(repositoryValue.repository.service_role_runtime_reference, false);
  assert.match(repositoryValue.binding_hash, /^[0-9a-f]{64}$/);
});

test('permanent P12 source governance forbids benchmark leakage, privileged credentials, and executable activation', () => {
  const files = [
    'reference-graph/p12-activation-authority.mjs',
    'reference-graph/p12-receipt.mjs',
    'reference-graph/cli/p12-activation-preflight.mjs',
  ];
  const benchmarkForbidden = /shadow-cases\.json|authenticated-home-mobile|auth-mobile|design-system-mobile|expected[_-]?legacy|legacy[_-]?expected|p(?:2|3|4|5|6|7).*evidence\.json/i;
  const privilegeForbidden = /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE|service[_-]?role[_-]?(?:key|token|secret|password)/i;
  const executionVerbForbidden = /--(?:activate|apply|deploy|set-env)\b|process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=|reference_graph_refresh_quick_runtime_projection/i;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, benchmarkForbidden, `${file} leaked benchmark outcomes`);
    assert.doesNotMatch(source, privilegeForbidden, `${file} added privileged runtime credentials`);
    assert.doesNotMatch(source, executionVerbForbidden, `${file} added executable activation behavior`);
  }

  const query = readFileSync('knowledge/design-references/scripts/query.mjs', 'utf8');
  assert.match(query, /REFERENCE_GRAPH_QUICK_RUNTIME\s*\|\|\s*["']legacy["']/);
  assert.match(query, /graphMode\s*===\s*["']graph["']/);
});

test('P12 adds no schema migration 010 or later', () => {
  const migrations = readdirSync('reference-graph/schema')
    .filter((name) => /^\d{3}_/.test(name))
    .sort();
  assert.equal(migrations.at(-1)?.slice(0, 3), '009');
  assert.equal(migrations.some((name) => /^01\d_/.test(name)), false);
});

test('P12 documentation separates technical preflight readiness from activation authority', () => {
  const readme = readFileSync(DOC, 'utf8');
  assert.match(readme, /P12 activation authority preflight/i);
  assert.match(readme, /preflight_ready/);
  assert.match(readme, /binding_hash/);
  assert.match(readme, /grant_state.*not-issued/i);
  assert.match(readme, /activation_authorized.*false/i);
  assert.match(readme, /activation_performed.*false/i);
  assert.match(readme, /production_source.*legacy-control/i);
  assert.match(readme, /separate explicit operator.*authority/i);
});
