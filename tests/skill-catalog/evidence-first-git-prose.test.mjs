import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '../..');

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('global guidance separates substance from artifact-specific prose shaping', async () => {
  const agents = await text('AGENTS.md');

  assert.match(agents, /separate substance from presentation/i);
  assert.match(agents, /outcome, facts, evidence, and required content/i);
  assert.match(agents, /artifact-specific prose/i);
  assert.match(agents, /do not (?:load|apply).*broad style profiles globally/i);
  assert.doesNotMatch(agents, /ASD-STE100|Simplified Technical English|Google developer documentation style guide|STOW/i);
});

test('commit messages derive meaning from repository evidence before prose cleanup', async () => {
  const gitWorkflow = await text('skills/github-delivery/references/git-workflow.md');

  assert.match(gitWorkflow, /staged diff|current diff/i);
  assert.match(gitWorkflow, /logical effect/i);
  assert.match(gitWorkflow, /reason|rationale/i);
  assert.match(gitWorkflow, /references\/prose-quality\.md/);
  assert.match(gitWorkflow, /after.*(?:facts|substance|meaning).*established|establish.*(?:facts|substance|meaning).*before/i);
  assert.match(gitWorkflow, /If applied, this commit will/i);
  assert.doesNotMatch(gitWorkflow, /50-character|72-column|ASD-STE100|Simplified Technical English/i);
});

test('prose quality explicitly covers commit messages as a late readability pass', async () => {
  const proseQuality = await text('skills/github-delivery/references/prose-quality.md');

  assert.match(proseQuality, /commit messages/i);
  assert.match(proseQuality, /after.*(?:facts|content|meaning).*established|establish.*(?:facts|content|meaning).*before/i);
  assert.match(proseQuality, /readability only/i);
  assert.match(proseQuality, /do not score whether the text .*sounds human/i);
});
