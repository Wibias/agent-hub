import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillRoot = path.join(repoRoot, 'skills/diagram-design');
const python = (process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'])
  .find((cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0);

test('the vendored PlantUML extractor parses sequence data without rendering or executing it',
  { skip: python ? false : 'Python interpreter unavailable' }, () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-puml-'));
    try {
      const source = path.join(folder, 'flow.puml');
      fs.writeFileSync(source,
        '@startuml\nparticipant Client\nparticipant Server\nClient -> Server: ping\n@enduml\n');
      const result = spawnSync(python, [
        path.join(skillRoot, 'scripts/plantuml_extract.py'), source, '--json',
      ], { cwd: repoRoot, encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const data = JSON.parse(result.stdout);
      assert.equal(data.diagrams_total, 1);
      assert.equal(data.diagrams.length, 1);
      assert.equal(data.diagrams[0].kind, 'sequence');
      assert.equal(data.diagrams[0].edges.length, 1);
      assert.equal(data.diagrams[0].nodes.length, 2);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

test('the AgentHub ownership layer exposes new types without replacing upstream provenance', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const upstream = fs.readFileSync(path.join(skillRoot, 'UPSTREAM.md'), 'utf8');
  for (const relative of [
    'references/import-plantuml.md',
    'references/type-event-modeling.md',
    'references/type-requirement-traceability.md',
    'references/type-sbgn.md',
    'references/type-steps.md',
    'references/type-unit-grid.md',
  ]) {
    assert.ok(fs.existsSync(path.join(skillRoot, relative)), relative);
    assert.ok(skill.includes(relative), relative + ' must be an explicit route');
  }
  assert.match(upstream, /f6db0decea96de66b901331a0f79a8d4b147ebae/);
  assert.match(skill, /project's existing design authority first/);
});
