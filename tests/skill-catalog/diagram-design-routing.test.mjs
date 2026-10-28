import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '../..');
const cli = path.join(repoRoot, 'scripts', 'audit-skill-catalog.mjs');
const cases = path.join(repoRoot, 'tests', 'skill-catalog', 'diagram-design-routing.jsonl');

test('live skill catalog satisfies the diagram-design routing boundary', async () => {
  try {
    await execFileAsync(process.execPath, [
      cli,
      '--skills-root', path.join(repoRoot, 'skills'),
      '--cases', cases,
      '--strict',
    ], { cwd: repoRoot });
  } catch (error) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`diagram-design routing audit failed${output ? `\n${output}` : ''}`, {
      cause: error,
    });
  }
});
