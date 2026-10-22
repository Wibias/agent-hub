import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '../..');
const text = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

test('formal verification is code-bound and distinct from runtime verification', async () => {
  const formal = await text('skills/formal-verification/SKILL.md');
  const contract = await text('skills/formal-verification/references/project-contract.md');
  const runtime = await text('skills/verification-harness/SKILL.md');

  assert.match(formal, /model[- ]check|proof|formal verification/i);
  assert.match(formal, /verification-harness.*runtime|runtime.*verification-harness/i);
  assert.match(formal, /prove the check can fail|failure-sensitivity/i);
  assert.match(formal, /blocked.*sync commit|sync commit.*blocked/i);
  assert.match(contract, /covered code/i);
  assert.match(contract, /sync commit/i);
  assert.match(contract, /bounds and assumptions/i);
  assert.match(runtime, /launch the real application|real application/i);
});

test('task sharpening prefers primary evidence and material professional depth', async () => {
  const skill = await text('skills/context-engineering/SKILL.md');
  assert.match(skill, /rawest relevant evidence|primary source/i);
  assert.match(skill, /top practitioner/i);
  assert.match(skill, /only when it can materially change the outcome/i);
  assert.match(skill, /independent success check/i);
});

test('grilling ideation expands distinct directions before bounded convergence', async () => {
  const skill = await text('skills/grilling/SKILL.md');
  const reference = await text('skills/grilling/references/ideation.md');

  assert.match(skill, /ideation/i);
  assert.match(reference, /4-6 meaningfully different directions/i);
  assert.match(reference, /Not Doing/);
  assert.match(reference, /does not implement|no implementation/i);
  assert.match(reference, /rawest useful material/i);
});

test('grilling fails closed on missing targets, references, grounding, and denied saves', async () => {
  const skill = await text('skills/grilling/SKILL.md');

  assert.match(skill, /missing.*target|no .*target.*resolved/i);
  assert.match(skill, /do not invent.*idea|idea.*do not invent/i);
  assert.match(skill, /missing.*reference|reference.*unavailable/i);
  assert.match(skill, /do not silently.*fall back|no silent.*fall back/i);
  assert.match(skill, /grounding.*fail|fact-finding.*fail|required.*evidence.*fail/i);
  assert.match(skill, /do not claim.*inspect|do not invent.*evidence|evidence.*not.*invent/i);
  assert.match(skill, /write.*denied|write.*fails|save.*fails/i);
  assert.match(skill, /conversation.*result|conversational result/i);
  assert.match(skill, /do not claim.*saved|do not claim.*written|not claim.*artifact/i);
});

test('performance retains negative experiment evidence and rejects neutral complexity', async () => {
  const skill = await text('skills/performance/SKILL.md');
  assert.match(skill, /Experiment ledger/i);
  assert.match(skill, /kept \| reverted \| inconclusive/i);
  assert.match(skill, /within measurement noise.*neutral/i);
  assert.match(skill, /revert/i);
  assert.match(skill, /does not retry|do not repeat|already tested/i);
});

test('episodic memory keeps code claims historical and supersedable', async () => {
  const skill = await text('skills/extract-approach/SKILL.md');
  const storage = await text('skills/extract-approach/references/storage-contract.md');

  assert.match(skill, /historical provenance/i);
  assert.match(skill, /repo@.*commit|repository\/commit/i);
  assert.match(skill, /superseded/i);
  assert.match(skill, /work-recall.*current-state|current-state.*work-recall/i);
  assert.match(storage, /historical evidence/i);
  assert.match(storage, /live state/i);
});

test('skill authoring describes portable procedures instead of model workarounds', async () => {
  const skill = await text('skills/skill-ratchet/SKILL.md');
  assert.match(skill, /portable procedure, not a workaround/i);
  assert.match(skill, /model or runtime/i);
  assert.match(skill, /host-local instructions|agent-runtime/i);
  assert.match(skill, /one discriminating observation/i);
});
