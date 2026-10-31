import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '../..');

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function git(cwd, ...args) {
  return execFile('git', args, { cwd });
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

test('PStack plugin-cache safety keeps discovery but forbids mutation in cache', async () => {
  const preflight = await text('skills/skill-ratchet/scripts/preflight.mjs');
  const skill = await text('skills/skill-ratchet/SKILL.md');
  const reference = await text('skills/skill-ratchet/references/capability-preflight.md');

  assert.match(preflight, /codex-plugin-cache[\s\S]{0,240}discovery-only/);
  assert.match(skill, /plugins\/cache[\s\S]{0,600}discovery-only/i);
  assert.match(skill, /persistent writable/i);
  assert.match(reference, /mutation_policy/i);
  assert.match(reference, /discovery-only/i);
});

test('context engineering sharpens intent and removes redundant rule text', async () => {
  const contextEngineering = await text('skills/context-engineering/SKILL.md');

  assert.match(contextEngineering, /separate the desired outcome from the request wording/i);
  assert.match(contextEngineering, /independent success check/i);
  assert.match(contextEngineering, /linter, formatter, type checker, hook, or deterministic script can enforce it/i);
  assert.match(contextEngineering, /discoverable from a stable local example/i);
  assert.match(contextEngineering, /do not copy Claude-specific conditional XML/i);
});

test('context engineering preserves critical directives when generated context approaches host output limits', async () => {
  const contextEngineering = await text('skills/context-engineering/SKILL.md');

  assert.match(contextEngineering, /output (?:limit|budget)/i);
  assert.match(contextEngineering, /headroom/i);
  assert.match(contextEngineering, /dereferenceable|read.*in full|pointer/i);
  assert.match(contextEngineering, /critical directives/i);
  assert.match(contextEngineering, /target identity/i);
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

test('workflow provenance passes on its captured head and rejects an unrecorded head change', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-hub-workflow-provenance-'));
  await git(tempRoot, 'init', '-b', 'main');
  await git(tempRoot, 'config', 'user.email', 'test@example.com');
  await git(tempRoot, 'config', 'user.name', 'Agent Hub Test');
  await writeFile(path.join(tempRoot, 'README.md'), 'baseline\n');
  await git(tempRoot, 'add', 'README.md');
  await git(tempRoot, 'commit', '-m', 'baseline');
  const { stdout: baseStdout } = await git(tempRoot, 'rev-parse', 'HEAD');
  const baseHead = baseStdout.trim();
  await git(tempRoot, 'switch', '-c', 'feature/provenance');

  const scaffoldPath = path.join(
    repoRoot,
    'skills/codex-dynamic-workflows/scripts/new_workflow.py',
  );
  const verifierPath = path.join(
    repoRoot,
    'skills/codex-dynamic-workflows/scripts/verify_workflow.py',
  );

  await execFile(
    'python3',
    [scaffoldPath, 'Provenance test', '--root', '.workflow', '--base-branch', 'main'],
    { cwd: tempRoot },
  );

  const workflowDir = path.join(tempRoot, '.workflow', 'provenance-test');
  const state = JSON.parse(await readFile(path.join(workflowDir, 'state.json'), 'utf8'));
  assert.equal(state.repository.base_branch, 'main');
  assert.equal(state.repository.base_head, baseHead);
  assert.equal(state.repository.working_branch, 'feature/provenance');
  assert.equal(state.repository.working_head, baseHead);
  assert.equal(state.repository.last_validated_head, baseHead);

  await mkdir(path.join(workflowDir, 'packets'), { recursive: true });
  await mkdir(path.join(workflowDir, 'results'), { recursive: true });
  await writeFile(path.join(workflowDir, 'packets', 'probe.md'), '# Probe\n');
  await writeFile(path.join(workflowDir, 'results', 'probe.md'), '# Result\n');

  const fresh = await execFile('python3', [verifierPath, workflowDir], { cwd: tempRoot });
  assert.match(fresh.stdout, /Workflow verification passed/);

  await writeFile(path.join(tempRoot, 'README.md'), 'changed head\n');
  await git(tempRoot, 'add', 'README.md');
  await git(tempRoot, 'commit', '-m', 'advance head');

  await assert.rejects(
    execFile('python3', [verifierPath, workflowDir], { cwd: tempRoot }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /stale workflow provenance/i);
      return true;
    },
  );
});

test('PR descriptions can use one compact structural view without visual duplication', async () => {
  const prDescription = await text('skills/github-delivery/references/pr-description.md');

  assert.match(prDescription, /compact structural view/i);
  assert.match(prDescription, /component tree|call flow|data flow|ownership boundary/i);
  assert.match(prDescription, /do not repeat the same fact in prose and a visual/i);
  assert.match(prDescription, /omit the visual/i);
});

test('github delivery treats always-on cost and generated-output review as contract evidence', async () => {
  const reviews = await text('skills/github-delivery/references/policy/reviews.md');
  const propagation = await text('skills/github-delivery/references/semantic-propagation-review.md');
  const prDescription = await text('skills/github-delivery/references/pr-description.md');

  assert.match(reviews, /always-on|per-edit|per-request|per-message/i);
  assert.match(reviews, /baseline/i);
  assert.match(reviews, /candidate|branch/i);
  assert.match(reviews, /same measurement method/i);
  assert.match(reviews, /p50|p95/i);
  assert.match(propagation, /generated|machine-written/i);
  assert.match(propagation, /semantic source|authoritative source/i);
  assert.match(propagation, /parity|regenerat/i);
  assert.match(prDescription, /generated|mechanical/i);
});

test('Impeccable vendor pin tracks upstream 4.8.0 while preserving the Agent Hub overlay boundary', async () => {
  const upstream = await text('skills/impeccable/UPSTREAM.md');
  const skill = await text('skills/impeccable/SKILL.md');
  const engineVersion = (await text('skills/impeccable/scripts/VERSION')).trim();
  const checksums = await text('skills/impeccable/scripts/engine-checksums.txt');

  assert.match(upstream, /df3a4abe7d0840d5f60324812c432e00b66a4e75/);
  assert.match(upstream, /Skill version: `4\.8\.0`/);
  assert.match(upstream, /Engine version: `0\.1\.18`/);
  assert.match(skill, /version: 4\.8\.0/);
  assert.match(skill, /Scale ambition to the surface's mode/i);
  assert.doesNotMatch(skill, /the ceiling covers the whole cycle/i);
  assert.equal(engineVersion, '0.1.18');
  assert.match(checksums, /0\.1\.18 impeccable-windows-x64\.exe [0-9a-f]{64}/);
  assert.match(skill, /Explicit-only Impeccable frontend design specialist/i);
  assert.match(skill, /repository instruction injection/i);
});

test('Impeccable sync preserves Agent Hub runtime integration files that were never upstream vendor files', async () => {
  const upstream = await text('skills/impeccable/UPSTREAM.md');
  const localContextRuntime = await text('skills/impeccable/scripts/context.mjs');

  assert.match(upstream, /Files shared with upstream/i);
  assert.match(localContextRuntime, /readLocalSkillVersion|resolveProject/);
});
