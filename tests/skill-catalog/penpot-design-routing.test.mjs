import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '../..');
const cli = path.join(repoRoot, 'scripts', 'audit-skill-catalog.mjs');
const cases = path.join(repoRoot, 'tests', 'skill-catalog', 'penpot-design-routing.jsonl');

test('live skill catalog keeps Penpot design work under design-with-ai without stealing Penpot infrastructure', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    '--skills-root', path.join(repoRoot, 'skills'),
    '--cases', cases,
    '--json',
  ], { cwd: repoRoot });

  const result = JSON.parse(stdout);
  const byId = new Map(result.cases.map((row) => [row.id, row]));

  for (const id of ['PEN1', 'PEN2', 'PEN3']) {
    assert.equal(byId.get(id)?.actual_skill, 'design-with-ai', `${id} must route to design-with-ai`);
    assert.equal(byId.get(id)?.ambiguous, false, `${id} must not be ambiguous`);
  }

  for (const id of ['PENN1', 'PENN2']) {
    assert.notEqual(byId.get(id)?.actual_skill, 'design-with-ai', `${id} must stay outside design-with-ai ownership`);
  }
});
