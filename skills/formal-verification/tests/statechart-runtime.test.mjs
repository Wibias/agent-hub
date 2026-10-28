import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testsDir, '..');
const scriptsRoot = path.join(skillRoot, 'statechart', 'scripts');

const expectedRuntimeFiles = [
  'backends/cfg.ts',
  'backends/mermaid.ts',
  'backends/plain-text.ts',
  'backends/report.ts',
  'frontends/config.ts',
  'frontends/dot.ts',
  'frontends/marks.ts',
  'frontends/messages.ts',
  'frontends/spec.ts',
  'frontends/trace.ts',
  'frontends/value.ts',
  'frontends/verdict.ts',
  'frontends/view.ts',
  'ir.ts',
  'package.json',
  'passes/annotate.ts',
  'passes/label.ts',
  'passes/lift.ts',
  'passes/loop-check.ts',
  'passes/paths.ts',
  'passes/reach.ts',
  'passes/region-check.ts',
  'passes/regions.ts',
  'pipeline.ts',
  'run.ts',
  'statechart',
  'statechart.ts',
  'tsconfig.json',
  'worker.ts',
];

const removedLegacyEntries = [
  'chart-to-tla.mjs',
  'compare-charts.mjs',
  'render.mjs',
  'statechart.mjs',
];

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const canExecuteTypeScript =
  nodeMajor >= 24 ||
  (nodeMajor === 23 && nodeMinor >= 6) ||
  (nodeMajor === 22 && nodeMinor >= 18);

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

test('vendored statechart compiler runtime is complete and relative imports resolve', async () => {
  for (const name of expectedRuntimeFiles) {
    const filePath = path.join(scriptsRoot, name);
    assert.equal(await fileExists(filePath), true, `missing vendored statechart runtime file: ${name}`);
  }

  for (const name of removedLegacyEntries) {
    assert.equal(
      await fileExists(path.join(scriptsRoot, name)),
      false,
      `legacy statechart entry must be removed: ${name}`,
    );
  }

  for (const name of expectedRuntimeFiles.filter((candidate) => candidate.endsWith('.ts'))) {
    const filePath = path.join(scriptsRoot, name);
    const source = await readFile(filePath, 'utf8');
    for (const specifier of relativeImports(source)) {
      const resolved = path.resolve(path.dirname(filePath), specifier);
      const candidates = path.extname(resolved)
        ? [resolved]
        : [`${resolved}.ts`, path.join(resolved, 'index.ts')];
      const present = [];
      for (const candidate of candidates) if (await fileExists(candidate)) present.push(candidate);
      assert.ok(present.length > 0, `${name} has unresolved relative import ${specifier}`);
    }
  }
});

test('statechart launcher declares the supported TypeScript runtimes', async () => {
  const launcher = await readFile(path.join(scriptsRoot, 'statechart'), 'utf8');
  assert.match(launcher, /statechart\.ts/);
  assert.match(launcher, /Node 22\.18 to 22\.x/);
  assert.match(launcher, /Node 23\.6 or later/);
  assert.match(launcher, /Bun 1\.1\.5 or later/);
  assert.match(launcher, /Deno 2\.0 or later/);
});

test(
  'statechart compiler usage is local and exposes only the current single-command interface',
  { skip: canExecuteTypeScript ? false : 'requires Node 22.18+ TypeScript execution; dedicated Statechart CI runs Node 22.18' },
  () => {
    const entry = path.join(scriptsRoot, 'statechart.ts');
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
      cwd: skillRoot,
      encoding: 'utf8',
      env: { ...process.env, TLA2TOOLS: '', PATH: process.env.PATH ?? '' },
    });

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /Usage: statechart SPEC\.tla/);
    assert.match(result.stderr, /--config FILE/);
    assert.match(result.stderr, /--view FILE/);
    assert.match(result.stderr, /--out DIR/);
    assert.doesNotMatch(result.stderr, /from-chart|--against|--fixed/);
  },
);
