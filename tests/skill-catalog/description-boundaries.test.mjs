import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseFrontmatter } from '../../skills/skill-ratchet/scripts/shared.mjs';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '../..');

async function description(skill) {
  const text = await readFile(path.join(repoRoot, 'skills', skill, 'SKILL.md'), 'utf8');
  return parseFrontmatter(text).description ?? '';
}

const broadActivity = /\buse when (?:working with|writing|building|fixing|debugging|testing|finishing|committing)\b/i;
const workflowLeak = /\b(?:must|always|never|do not)\s+(?:run|load|read|execute|call|invoke|launch)\b|(?:scripts\/|references\/)[^\s`]+/i;

test('removed Vite and Vitest skills are not discoverable', () => {
  for (const skill of ['vite', 'vitest']) assert.equal(existsSync(path.join(repoRoot, 'skills', skill, 'SKILL.md')), false);
});

test('ai-agent-security discovery requires explicit security intent', async () => {
  const value = await description('ai-agent-security');
  assert.match(value, /threat model|security review|harden|red-team/i);
  assert.match(value, /Not for ordinary implementation/i);
  assert.doesNotMatch(value, broadActivity);
});

test('GitHub delivery owns PR creation without a redirect skill', async () => {
  const value = await description('github-delivery');
  assert.match(value, /GitHub pull request|PR delivery|GitHub delivery/i);
  assert.equal(existsSync(path.join(repoRoot, 'skills/create-pr-from-local-work-redirect/SKILL.md')), false);
});

test('simplify is the default cleanup owner without discovery-time load suppression', async () => {
  const value = await description('simplify');
  assert.match(value, /default|ordinary cleanup|canonical.*cleanup/i);
  assert.match(value, /simplif|clean up|cleanup|over-engineer|readability/i);
  assert.doesNotMatch(value, workflowLeak);
});

test('ponytail-review discovery is reserved for explicit named invocation', async () => {
  const value = await description('ponytail-review');
  assert.match(value, /explicit|only when/i);
  assert.match(value, /ponytail-review|\/ponytail-review/i);
  assert.match(value, /simplify/i);
  assert.doesNotMatch(value, workflowLeak);
});

test('code-simplification discovery is reserved for explicit named invocation', async () => {
  const value = await description('code-simplification');
  assert.match(value, /explicit|only when/i);
  assert.match(value, /code-simplification/i);
  assert.match(value, /simplify/i);
  assert.doesNotMatch(value, workflowLeak);
});

test('design-with-ai is the single visible-UI and explicit Impeccable owner', async () => {
  const owner = await description('design-with-ai');
  assert.match(owner, /visible product-UI design/i);
  assert.match(owner, /explicit Impeccable requests use the integrated DWA command route/i);
  const catalog = JSON.parse(await readFile(path.join(repoRoot, 'knowledge', 'index.json'), 'utf8'));
  assert.equal(catalog.entries.some((entry) => entry.id === 'agents/impeccable' && entry.status === 'active'), false,
    'standalone Impeccable must not be registered as a discovery surface');
});

test('source-driven-development requires explicit source-grounding intent', async () => {
  const value = await description('source-driven-development');
  assert.match(value, /official documentation|source-cited|source-ground/i);
  assert.match(value, /explicit|asks|requests|wants/i);
  assert.match(value, /Not for ordinary|not the default/i);
  assert.doesNotMatch(value, /correctness matters|building with frameworks\/libraries/i);
});

test('retired extract-approach has no discoverable entrypoint', () => {
  assert.equal(existsSync(path.join(repoRoot, 'skills/extract-approach/SKILL.md')), false);
});

test('retired vault-research has no discoverable entrypoint', () => {
  assert.equal(existsSync(path.join(repoRoot, 'skills/vault-research/SKILL.md')), false);
});

test('diagnose discovery is reserved for resistant bugs and false-success paths', async () => {
  const value = await description('diagnose');
  assert.match(value, /resist|first-pass|false-success|write reports success|repeated fixes/i);
  assert.match(value, /Not for straightforward first-pass bugs|interface-design friction/i);
  assert.doesNotMatch(value, broadActivity);
  assert.doesNotMatch(value, workflowLeak);
});

test('skill-ratchet discovery identifies skill authoring and publication without procedure leakage', async () => {
  const value = await description('skill-ratchet');
  assert.match(value, /Agent Skills|SKILL\.md|publication readiness/i);
  assert.match(value, /Not for ordinary domain execution|unrelated to Agent Skills/i);
  assert.doesNotMatch(value, broadActivity);
  assert.doesNotMatch(value, workflowLeak);
});

test('codex-dynamic-workflows requires explicit orchestration instead of task size alone', async () => {
  const value = await description('codex-dynamic-workflows');
  assert.match(value, /swarm|subagents|parallel agents|dynamic workflow|orchestrat/i);
  assert.match(value, /explicit|asks|requests|wants/i);
  assert.match(value, /domain|migration|audit/i);
  assert.doesNotMatch(value, /a large migration\s+or audit/i);
  assert.doesNotMatch(value, workflowLeak);
});
