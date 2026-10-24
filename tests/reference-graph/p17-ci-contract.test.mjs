import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = '.github/workflows/verify-reference-graph-p17.yml';
const DOC = 'reference-graph/P17.md';

function workflow() {
  assert.equal(existsSync(WORKFLOW), true, 'P17 governance workflow must exist');
  return readFileSync(WORKFLOW, 'utf8');
}

function runbook() {
  assert.equal(existsSync(DOC), true, 'P17 runbook must exist');
  return readFileSync(DOC, 'utf8');
}

test('permanent P17 governance runs only disposable local-actuator contracts', () => {
  const source = workflow();
  assert.match(source, /node --test tests\/reference-graph\/p17-\*\.test\.mjs/);
  assert.match(source, /AGENT_HUB_REFERENCE_GRAPH_STATE/);
  assert.match(source, /runner\.temp|RUNNER_TEMP/);
  assert.match(source, /scan_secrets\.py reference-graph/);
  assert.match(source, /verify-public-release\.mjs/);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\./i);
  assert.doesNotMatch(source, /vrznfnxzlxaavpqbzbzd/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('P17 governance proves repository-default legacy projection and never creates migration 011', () => {
  const source = workflow();
  assert.match(source, /REFERENCE_GRAPH_QUICK_RUNTIME/);
  assert.match(source, /legacy/i);
  assert.match(source, /query-runtime\.mjs/);
  assert.match(source, /011|migration/i);

  const migrations = readdirSync('reference-graph/schema');
  assert.equal(
    migrations.some((name) => /^011_/.test(name)),
    false,
    'P17 must not add migration 011',
  );
});

test('P17 workflow contains no production authority ceremony or activation secret surface', () => {
  const source = workflow();
  assert.doesNotMatch(source, /private[_-]?key|createPrivateKey|generateKeyPair|signature_base64/i);
  assert.doesNotMatch(source, /consume_activation_grant_nonce_p16\s*\(/i);
  assert.doesNotMatch(source, /applyP17LocalActivation\s*\(/);
  assert.doesNotMatch(source, /executeP17Activation\s*\(/);
});

test('P17 runbook binds the local AgentHub control plane without weakening P11', () => {
  const source = runbook();
  assert.match(source, /~\/\.agents|USERPROFILE.*\.agents|AGENTS_HOME/i);
  assert.match(source, /query-runtime\.mjs/);
  assert.match(source, /REFERENCE_GRAPH_QUICK_RUNTIME=graph/);
  assert.match(source, /query\.mjs/i);
  assert.match(source, /P11/i);
  assert.match(source, /Quick/i);
  assert.match(source, /Standard/i);
  assert.match(source, /Deep/i);
  assert.match(source, /legacy-control/);
});

test('P17 runbook documents atomic local state, P16-before-mutation ordering, and no restart dependency', () => {
  const source = runbook();
  assert.match(source, /LOCALAPPDATA|XDG_STATE_HOME/);
  assert.match(source, /atomic|rename/i);
  assert.match(source, /P16/i);
  assert.match(source, /consume|consumption/i);
  assert.match(source, /before.*mutation|before.*apply|consume.*before/i);
  assert.match(source, /restart|relaunch/i);
  assert.match(source, /not required|does not rely|no global|avoids/i);
});

test('P17 runbook keeps live production blocked until a real external grant exists', () => {
  const source = runbook();
  assert.match(source, /Ed25519/i);
  assert.match(source, /external/i);
  assert.match(source, /signed grant|signed activation grant/i);
  assert.match(source, /private key|signer/i);
  assert.match(source, /no.*private key|does not.*private key|never.*private key/i);
  assert.match(source, /production.*legacy-control|legacy-control.*production/i);
  assert.match(source, /activation_performed.*false|no production activation/i);
  assert.match(source, /grant_consumed.*false|grant.*not.*consumed|no live nonce/i);
  assert.match(source, /CI|workflow/i);
  assert.match(source, /disposable|temporary|synthetic/i);
});
