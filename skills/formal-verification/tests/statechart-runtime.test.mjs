import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testsDir, '..');
const scriptsRoot = path.join(skillRoot, 'statechart', 'scripts');

const expectedScripts = [
  'bug-states.mjs',
  'chart-edges.mjs',
  'chart-parts.mjs',
  'chart-to-tla.mjs',
  'compare-charts.mjs',
  'lib.mjs',
  'map-view.mjs',
  'property-loop.mjs',
  'read-check.mjs',
  'regions-chart.mjs',
  'render.mjs',
  'rule-book.mjs',
  'second-replay.mjs',
  'snapshot.mjs',
  'spec-text.mjs',
  'statechart-help.mjs',
  'statechart.mjs',
  'tlc-to-chart-args.mjs',
  'tlc-to-chart.mjs',
  'tlc-tools.mjs',
  'ways-in.mjs',
];

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function relativeImports(source) {
  const found = new Set();
  const staticImport = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
  const dynamicImport = /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

test('vendored statechart runtime is complete and relative imports resolve', async () => {
  for (const name of expectedScripts) {
    const filePath = path.join(scriptsRoot, name);
    assert.equal(await fileExists(filePath), true, `missing vendored statechart script: ${name}`);
  }

  for (const name of expectedScripts) {
    const filePath = path.join(scriptsRoot, name);
    const source = await readFile(filePath, 'utf8');
    for (const specifier of relativeImports(source)) {
      const resolved = path.resolve(path.dirname(filePath), specifier);
      const candidates = path.extname(resolved) ? [resolved] : [`${resolved}.mjs`, path.join(resolved, 'index.mjs')];
      const present = [];
      for (const candidate of candidates) if (await fileExists(candidate)) present.push(candidate);
      assert.ok(present.length > 0, `${name} has unresolved relative import ${specifier}`);
    }
  }
});

test('statechart help is local and does not require TLC or renderer bootstrap', async () => {
  const entry = path.join(scriptsRoot, 'statechart.mjs');
  assert.equal(await fileExists(entry), true, 'statechart CLI entrypoint must exist');

  const result = spawnSync(process.execPath, [entry, '--help'], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, TLA2TOOLS: '', PATH: process.env.PATH ?? '' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /from-spec/);
  assert.match(result.stdout, /from-chart/);
  assert.match(result.stdout, /\brender\b/);
});
