import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('vite discovery is specific to Vite surfaces, not generic frontend work', async () => {
  const value = await description('vite');
  assert.match(value, /vite\.config|Vite-specific|Vite configuration/i);
  assert.match(value, /Not for generic frontend/i);
  assert.doesNotMatch(value, broadActivity);
});

test('vitest discovery requires Vitest-specific context and rejects generic test writing', async () => {
  const value = await description('vitest');
  assert.match(value, /Vitest-specific|vitest\.config/i);
  assert.match(value, /Not for generic test writing/i);
  assert.doesNotMatch(value, broadActivity);
});

test('ai-agent-security discovery requires explicit security intent', async () => {
  const value = await description('ai-agent-security');
  assert.match(value, /threat model|security review|harden|red-team/i);
  assert.match(value, /Not for ordinary implementation/i);
  assert.doesNotMatch(value, broadActivity);
});

test('create-pr-from-local-work discovery routes without embedding the workflow', async () => {
  const value = await description('create-pr-from-local-work-redirect');
  assert.match(value, /create a PR|open a PR|local work/i);
  assert.match(value, /redirect|github-delivery/i);
  assert.doesNotMatch(value, workflowLeak);
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

test('design-with-ai is the default visible-UI owner and impeccable is explicit-only', async () => {
  const owner = await description('design-with-ai');
  const specialist = await description('impeccable');
  assert.match(owner, /canonical|default/i);
  assert.match(owner, /explicit.*impeccable|impeccable.*explicit/i);
  assert.match(specialist, /explicit|only when/i);
  assert.match(specialist, /impeccable|\/impeccable/i);
  assert.match(specialist, /design-with-ai/i);
});

test('source-driven-development requires explicit source-grounding intent', async () => {
  const value = await description('source-driven-development');
  assert.match(value, /official documentation|source-cited|source-ground/i);
  assert.match(value, /explicit|asks|requests|wants/i);
  assert.match(value, /Not for ordinary|not the default/i);
  assert.doesNotMatch(value, /correctness matters|building with frameworks\/libraries/i);
});

test('extract-approach discovery does not prescribe automatic end-of-task execution', async () => {
  const value = await description('extract-approach');
  assert.match(value, /extract approach|write a learning|remember this/i);
  assert.match(value, /explicit|asks|requests|wants/i);
  assert.doesNotMatch(value, /at end of|any session|prefer running|silently skipping/i);
  assert.doesNotMatch(value, workflowLeak);
});

test('codex-dynamic-workflows requires explicit orchestration instead of task size alone', async () => {
  const value = await description('codex-dynamic-workflows');
  assert.match(value, /swarm|subagents|parallel agents|dynamic workflow|orchestrat/i);
  assert.match(value, /explicit|asks|requests|wants/i);
  assert.match(value, /domain|migration|audit/i);
  assert.doesNotMatch(value, /a large migration\s+or audit/i);
});