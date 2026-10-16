import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const fixturePath = path.join(repoRoot, 'tests', 'memory-engine', 'fixtures', 'recall-relevance-benchmark-v1.json');
const runtimePath = path.join(repoRoot, 'memory-engine', 'recall-fast-path-runtime.mjs');
const v1EvalPath = path.join(repoRoot, 'scripts', 'eval-recall-fast-path.mjs');
const v2EvalPath = path.join(repoRoot, 'scripts', 'eval-recall-fast-path-v2.mjs');
const targetId = 'live-health-production';
const doctorId = 'claim:codex:runtime-e2e-seed-doctor:runtime-e2e-turn-seed-doctor:prompt';

function fixtureCases() {
  const root = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const cases = Array.isArray(root) ? root : root?.cases;
  assert.ok(Array.isArray(cases), 'benchmark fixture must expose a cases array');
  return cases;
}

function targetFixture() {
  const target = fixtureCases().find((entry) => entry?.id === targetId);
  assert.ok(target, `${targetId} must exist in benchmark fixture`);
  return target;
}

function runJson(scriptPath) {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      process.env.AGENT_HUB_E5_OFFLINE_PRELOAD,
      scriptPath,
      '--cases',
      fixturePath,
      '--cache-dir',
      process.env.MEMORY_E5_MODEL_CACHE,
      '--json',
    ],
    {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, `evaluator failed (${scriptPath})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function runtimeNumber(name) {
  const source = readFileSync(runtimePath, 'utf8');
  const match = source.match(new RegExp(`\\b${name}\\s*:\\s*(0(?:\\.\\d+)?|1(?:\\.0+)?|\\d+)`));
  assert.ok(match, `runtime default ${name} must be present`);
  return Number(match[1]);
}

test('benchmark includes the exact production-shaped live health recall case', () => {
  const target = targetFixture();
  assert.equal(target.query, 'What command should we run to verify that the memory system is healthy?');
  assert.deepEqual(target.relevantClaimIds, [doctorId]);

  const doctor = target.items.find((item) => item?.claim?.id === doctorId);
  assert.ok(doctor, 'production doctor claim must be present');
  assert.equal(doctor.claim.kind, 'user_direct');
  assert.equal(doctor.claim.subject, 'user memory');
  assert.equal(doctor.claim.predicate, 'states');
  assert.equal(
    doctor.claim.value,
    'memory: After changing Agent Hub memory runtime or Codex memory hooks, run `node .\\scripts\\doctor-memory.mjs` and require a healthy result before considering host integration complete.',
  );
  assert.equal(doctor.evidence.authority_class, 'user_direct');
});

test('v1 calibration turns live health into fallback and runtime uses the safe pair', () => {
  targetFixture();
  const result = runJson(v1EvalPath);
  const recommended = result.calibration?.recommended;
  assert.ok(recommended, 'v1 recommended calibration must exist');
  assert.equal(recommended.fast_errors, 0, 'v1 must retain zero fast errors');

  const target = recommended.cases.find((entry) => entry.id === targetId);
  assert.ok(target, 'v1 result must include live health case');
  assert.equal(target.route, 'fallback', 'live health must not remain a fast negative decision');
  assert.deepEqual(target.selected_ids, []);

  assert.equal(runtimeNumber('negativeThreshold'), Number(recommended.negative_threshold));
  assert.equal(runtimeNumber('positiveThreshold'), Number(recommended.positive_threshold));
});

test('v2 remains zero-error and never makes an incorrect live health fast decision', () => {
  targetFixture();
  const result = runJson(v2EvalPath);
  const recommended = result.calibration?.recommended;
  assert.ok(recommended, 'v2 recommended calibration must exist');
  assert.equal(recommended.fast_errors, 0, 'v2 must retain zero fast errors');

  const target = recommended.cases.find((entry) => entry.id === targetId);
  assert.ok(target, 'v2 result must include live health case');

  if (target.route === 'fallback') {
    assert.deepEqual(target.selected_ids, []);
  } else {
    assert.equal(target.exact, true, 'any v2 rescue must exactly match expected ids');
    assert.deepEqual(target.selected_ids, [doctorId]);
  }

  const settings = recommended.settings;
  assert.ok(settings, 'v2 recommended settings must exist');
  assert.equal(runtimeNumber('supportThreshold'), Number(settings.support_threshold));
  assert.equal(runtimeNumber('singleMarginThreshold'), Number(settings.single_margin_threshold));
  assert.equal(runtimeNumber('lexicalK'), Number(settings.lexical_k));
  assert.equal(runtimeNumber('fusedK'), Number(settings.fused_k));
  assert.equal(runtimeNumber('minVotes'), Number(settings.min_votes));
});