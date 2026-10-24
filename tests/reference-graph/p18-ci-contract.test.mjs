import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = '.github/workflows/verify-reference-graph-p18.yml';
const RUNBOOK = 'reference-graph/P18.md';

function workflow() {
  assert.equal(existsSync(WORKFLOW), true, 'P18 governance workflow must exist');
  return readFileSync(WORKFLOW, 'utf8');
}

test('P18 governance is permanent, branch-verifiable, and runs all P18 contracts', () => {
  const source = workflow();
  assert.match(source, /name:\s*Reference graph P18 governance/i);
  assert.match(source, /pull_request:/);
  assert.match(source, /agent\/reference-graph-p18/);
  assert.match(source, /node --test tests\/reference-graph\/p18-\*\.test\.mjs/);
  assert.match(source, /scan_secrets\.py reference-graph/);
  assert.match(source, /verify-public-release\.mjs/);
});

test('P18 governance uses only disposable local state and no GitHub or production secrets', () => {
  const source = workflow();
  assert.match(source, /AGENT_HUB_REFERENCE_GRAPH_STATE/);
  assert.match(source, /RUNNER_TEMP/);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\./i);
  assert.doesNotMatch(source, /SUPABASE_SECRET_KEY\s*:/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY\s*:/);
  assert.doesNotMatch(source, /SUPABASE_PUBLISHABLE_KEY\s*:/);
  assert.doesNotMatch(source, /vrznfnxzlxaavpqbzbzd/);
});

test('P18 governance proves external OpenSSL Ed25519 signing compatibility with ephemeral CI material', () => {
  const source = workflow();
  assert.match(source, /openssl\s+version/i);
  assert.match(source, /genpkey\s+-algorithm\s+ED25519/i);
  assert.match(source, /pkey\s+.*-pubout.*-outform\s+DER/i);
  assert.match(source, /pkeyutl\s+-sign\s+-rawin/i);
  assert.match(source, /--authority-descriptor/);
  assert.match(source, /--prepare-grant/);
  assert.match(source, /--assemble-grant/);
  assert.match(source, /grant_verified/);
});

test('P18 governance can never exercise the production activation or P16 live consume path', () => {
  const source = workflow();
  assert.doesNotMatch(source, /--activate-production/);
  assert.doesNotMatch(source, /ACTIVATE-QUICK-REFERENCE-GRAPH/);
  assert.doesNotMatch(source, /executeP17Activation\s*\(/);
  assert.doesNotMatch(source, /consumeActivationGrantNonceP16\s*\(/);
  assert.doesNotMatch(source, /reference_graph_consume_activation_grant_nonce_p16/);
});

test('P18 owns no migration 011 and governance enforces that boundary', () => {
  const source = workflow();
  assert.match(source, /011/);
  const migrations = readdirSync('reference-graph/schema');
  assert.equal(migrations.some((name) => /^011_/.test(name)), false);
});

test('P18 runbook still states repository work alone does not activate production', () => {
  const source = readFileSync(RUNBOOK, 'utf8');
  assert.match(source, /Repository implementation and CI alone do not activate production/i);
  assert.match(source, /production remains `legacy-control`/i);
  assert.match(source, /no live P16 nonce is consumed/i);
  assert.match(source, /activation_performed=false/i);
});
