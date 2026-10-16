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

test('PStack principle refresh stays semantic instead of mechanism-specific', async () => {
  const agents = await text('AGENTS.md');
  const diagnose = await text('skills/diagnose/SKILL.md');

  assert.match(
    agents,
    /test fails when the protected behavior or contract breaks/i,
    'global test guidance should define observable behavior rather than one synthetic mutation',
  );
  assert.doesNotMatch(
    agents,
    /every imported collaborator returned `undefined`|every imported collaborator returned undefined/i,
    'global test guidance should not prescribe one collaborator mutation heuristic',
  );
  assert.match(
    diagnose,
    /observation that would come out differently if the premise were false/i,
    'repeated-fix diagnosis should falsify the shared premise directly',
  );
});

test('context engineering sharpens intent and removes redundant rule text', async () => {
  const contextEngineering = await text('skills/context-engineering/SKILL.md');

  assert.match(contextEngineering, /separate the desired outcome from the request wording/i);
  assert.match(contextEngineering, /independent success check/i);
  assert.match(contextEngineering, /enforced by a linter, formatter, type checker, hook, or deterministic script/i);
  assert.match(contextEngineering, /discoverable from a stable local example/i);
  assert.match(contextEngineering, /do not copy Claude-specific conditional XML/i);
});

test('dynamic workflows bind durable state to repository provenance and expose the iterated control-loop recipe', async () => {
  const skill = await text('skills/codex-dynamic-workflows/SKILL.md');
  const managerState = await text('skills/codex-dynamic-workflows/references/manager-state.md');
  const scaffold = await text('skills/codex-dynamic-workflows/scripts/new_workflow.py');
  const verifier = await text('skills/codex-dynamic-workflows/scripts/verify_workflow.py');
  const controlLoop = await text('skills/codex-dynamic-workflows/references/iterated-control-loop.md');

  for (const source of [managerState, scaffold, verifier]) {
    assert.match(source, /base_head/);
    assert.match(source, /working_head/);
    assert.match(source, /last_validated_head/);
  }
  assert.match(verifier, /stale workflow provenance/i);
  assert.match(skill, /iterated-control-loop\.md/);
  assert.match(controlLoop, /set point/i);
  assert.match(controlLoop, /sensor/i);
  assert.match(controlLoop, /controller/i);
  assert.match(controlLoop, /actuator/i);
  assert.match(controlLoop, /dampener/i);
  assert.match(controlLoop, /one open PR per loop/i);
});

test('PR descriptions can use one compact structural view without visual duplication', async () => {
  const prDescription = await text('skills/github-delivery/references/pr-description.md');

  assert.match(prDescription, /compact structural view/i);
  assert.match(prDescription, /component tree|call flow|data flow|ownership boundary/i);
  assert.match(prDescription, /do not repeat the same fact in prose and a visual/i);
  assert.match(prDescription, /omit the visual/i);
});
