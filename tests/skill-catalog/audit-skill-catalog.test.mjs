import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '../..');
const cli = path.join(repoRoot, 'scripts', 'audit-skill-catalog.mjs');

async function writeSkill(root, folder, name, description, extra = '') {
  const skillDir = path.join(root, 'skills', folder);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: >-\n  ${description}\n${extra}---\n\n# ${name}\n`, 'utf8');
}

async function runAudit(root, cases = []) {
  const casesPath = path.join(root, 'cases.jsonl');
  await writeFile(casesPath, cases.map((row) => JSON.stringify(row)).join('\n') + (cases.length ? '\n' : ''), 'utf8');
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    '--skills-root', path.join(root, 'skills'),
    '--cases', casesPath,
    '--json',
  ], { cwd: repoRoot });
  return JSON.parse(stdout);
}

test('catalog audit reads live SKILL.md frontmatter and ignores stale generated index data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-live-'));
  await writeSkill(root, 'narrow', 'narrow', 'Owns narrow widget diagnostics. Use when a user asks to diagnose a widget protocol.');
  await mkdir(path.join(root, 'knowledge'), { recursive: true });
  await writeFile(path.join(root, 'knowledge', 'index.json'), JSON.stringify({ entries: [{ name: 'stale-skill', description: 'stale generated data' }] }), 'utf8');

  const result = await runAudit(root);

  assert.deepEqual(result.catalog.map((entry) => entry.name), ['narrow']);
  assert.equal(result.catalog[0].description.includes('widget protocol'), true);
  assert.equal(result.catalog.some((entry) => entry.name === 'stale-skill'), false);
});

test('catalog audit classifies redirect and vendored discovery surfaces without treating them as canonical active owners', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-kind-'));
  await writeSkill(root, 'watch-redirect', 'watch', 'Redirect for the explicit watch alias. Always load delivery and run watch-pr.');
  await writeSkill(root, path.join('superpowers', 'planning'), 'planning', 'Vendored planning workflow. Use when writing a multi-step implementation plan.');
  await writeSkill(root, 'delivery', 'delivery', 'Owns delivery of pull requests. Use when shipping or monitoring a pull request.');

  const result = await runAudit(root);
  const byName = new Map(result.catalog.map((entry) => [entry.name, entry]));

  assert.equal(byName.get('watch').classification, 'redirect');
  assert.equal(byName.get('planning').classification, 'vendored');
  assert.equal(byName.get('delivery').classification, 'active');
});

test('redirect-like folder names do not override standalone discovery semantics', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-semantic-kind-'));
  await writeSkill(
    root,
    'security-review-redirect',
    'security-review',
    'Standalone security audit checklist for non-ship codebase and pre-launch reviews. Not for GitHub PR security reviews.',
  );

  const result = await runAudit(root);
  const entry = result.catalog.find((candidate) => candidate.name === 'security-review');

  assert.equal(entry.classification, 'active');
});

test('catalog audit reports workflow leakage and over-broad discovery language', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-findings-'));
  await writeSkill(root, 'vite', 'vite', 'Use when working with Vite projects. MUST run scripts/check-vite.mjs before answering.');

  const result = await runAudit(root);
  const codes = new Set(result.findings.map((finding) => finding.code));

  assert.equal(codes.has('WORKFLOW_LEAK'), true);
  assert.equal(codes.has('BROAD_TRIGGER'), true);
});

test('catalog audit treats negative execution instructions as workflow leakage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-negative-leak-'));
  await writeSkill(
    root,
    'simplify',
    'simplify',
    'Canonical cleanup owner for ordinary simplification. Do not load ponytail-review unless the user explicitly names it.',
  );

  const result = await runAudit(root);
  const leaks = result.findings.filter((finding) => finding.code === 'WORKFLOW_LEAK');

  assert.equal(leaks.some((finding) => finding.skill === 'simplify'), true);
});

test('catalog audit flags generic lifecycle triggers such as finishing any feature or fixing any bug', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-lifecycle-'));
  await writeSkill(root, 'react-doctor', 'react-doctor', 'Use when finishing a feature, fixing a bug, before committing React code, or when the user asks for a React diagnostic scan.');

  const result = await runAudit(root);
  const broad = result.findings.filter((finding) => finding.code === 'BROAD_TRIGGER');

  assert.equal(broad.some((finding) => finding.skill === 'react-doctor'), true);
});

test('routing cases permit an explicit null owner and keep generic requests unrouted', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-null-'));
  await writeSkill(root, 'vitest', 'vitest', 'Owns Vitest configuration and Vitest-specific test failures. Use when the request names Vitest or vitest.config. Not for generic testing in other stacks.');

  const result = await runAudit(root, [
    { id: 'N1', prompt: 'What is the capital of France?', expected_skill: null },
  ]);

  assert.equal(result.cases[0].actual_skill, null);
  assert.equal(result.cases[0].pass, true);
});

test('routing cases prefer a canonical active owner over a generic redirect unless the alias is explicit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-route-'));
  await writeSkill(root, 'babysit-pr-redirect', 'babysit-pr', 'Redirect for the explicit babysit-pr alias. Use when the user says babysit-pr. Always load github-delivery and run watch-pr.');
  await writeSkill(root, 'github-delivery', 'github-delivery', 'Owns GitHub pull request delivery, CI watch, review handling, merge, and closure. Use for PR delivery or ongoing GitHub PR and CI monitoring.');

  const result = await runAudit(root, [
    { id: 'D1', prompt: 'Watch this GitHub pull request until CI is green', expected_skill: 'github-delivery' },
    { id: 'D2', prompt: 'babysit-pr this pull request', expected_skill: 'babysit-pr' },
  ]);

  assert.equal(result.cases[0].actual_skill, 'github-delivery');
  assert.equal(result.cases[0].pass, true);
  assert.equal(result.cases[1].actual_skill, 'babysit-pr');
  assert.equal(result.cases[1].pass, true);
});

test('explicit hyphenated redirect aliases do not also activate their shorter prefix alias', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-alias-prefix-'));
  await writeSkill(root, 'babysit-redirect', 'babysit', 'Redirect for the explicit babysit alias.');
  await writeSkill(root, 'babysit-pr-redirect', 'babysit-pr', 'Redirect for the explicit babysit-pr alias.');

  const result = await runAudit(root, [
    { id: 'D1', prompt: 'babysit-pr this pull request', expected_skill: 'babysit-pr' },
  ]);

  assert.equal(result.cases[0].actual_skill, 'babysit-pr');
  assert.equal(result.cases[0].ambiguous, false);
  assert.equal(result.cases[0].pass, true);
});

test('explicit-only active specialist routes only when its exact skill name is invoked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-explicit-active-'));
  await writeSkill(
    root,
    'impeccable',
    'impeccable',
    'Explicit-only frontend design specialist. Use only when the user explicitly names impeccable. Not for ordinary UI polish.',
  );

  const result = await runAudit(root, [
    { id: 'D1', prompt: 'Use impeccable to polish this dashboard', expected_skill: 'impeccable' },
    { id: 'D2', prompt: '/impeccable polish this dashboard', expected_skill: 'impeccable' },
    { id: 'N1', prompt: 'Polish this dashboard', expected_skill: null },
    { id: 'N2', prompt: 'Make this dashboard feel impeccable and premium', expected_skill: null },
    { id: 'N3', prompt: 'Do not use impeccable; polish this dashboard normally', expected_skill: null },
  ]);

  assert.deepEqual(
    result.cases.map((row) => [row.id, row.actual_skill, row.ambiguous, row.pass]),
    [
      ['D1', 'impeccable', false, true],
      ['D2', 'impeccable', false, true],
      ['N1', null, false, true],
      ['N2', null, false, true],
      ['N3', null, false, true],
    ],
  );
});

test('negative discovery boundaries using do not use merely to suppress generic ownership', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-negative-boundary-'));
  await writeSkill(root, 'verification-harness', 'verification-harness', 'Create or repair a reusable runtime verification layer. Use when a repository lacks a project verifier. Do not use merely to run an existing smoke suite, write ordinary unit tests, or review merge readiness.');

  const result = await runAudit(root, [
    { id: 'N1', prompt: 'Write tests for this Python parser', expected_skill: null },
  ]);

  assert.equal(result.cases[0].actual_skill, null);
  assert.equal(result.cases[0].pass, true);
});

test('negative discovery boundaries support do not use as the entrypoint for', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-entrypoint-boundary-'));
  await writeSkill(
    root,
    'security-review-redirect',
    'security-review',
    'Standalone security review for codebases before launch. Do not use as the entrypoint for security review on a GitHub PR; use github-delivery for PR security reviews.',
  );
  await writeSkill(
    root,
    'github-delivery',
    'github-delivery',
    'Owns GitHub pull request delivery and PR security reviews.',
  );

  const result = await runAudit(root, [
    { id: 'D1', prompt: 'Security review GitHub PR 42', expected_skill: 'github-delivery' },
  ]);

  assert.equal(result.cases[0].actual_skill, 'github-delivery');
  assert.equal(result.cases[0].pass, true);
});

test('catalog audit deduplicates repeated canonical skill names like Skill Ratchet preflight', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-catalog-dedupe-'));
  await writeSkill(root, 'babysit-redirect', 'babysit', 'Redirect for the explicit babysit alias.');
  await writeSkill(root, path.join('github-delivery', 'overrides', 'babysit'), 'babysit', 'Embedded override copy for babysit.');

  const result = await runAudit(root);
  const matches = result.catalog.filter((entry) => entry.name === 'babysit');

  assert.equal(matches.length, 1);
  assert.match(matches[0].path, /babysit-redirect\/SKILL\.md$/);
  assert.equal(matches[0].variant_count, 1);
});