import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderHostReport,
  renderAll,
  assertConfigRendererSupported,
} from '../../scripts/render-agent-runtime.mjs';

const runtime = {
  defaults: { reasoning: 'inherit', isolation: 'inherit', mutation: 'inherit' },
  skills: {
    diagnose: { reasoning: 'high', isolation: 'prefer' },
  },
};

test('host report renders only declared capability state', () => {
  const host = {
    displayName: 'Example Host',
    reviewed: '2026-09-04',
    source: 'https://example.invalid/docs',
    skills: { agentsRoot: true, skillModelRouting: false },
    adapter: { configRenderer: 'unsupported', note: 'Manual only.' },
  };
  const report = renderHostReport('example', host, runtime);
  assert.match(report, /Example Host/);
  assert.match(report, /skillModelRouting: unsupported/);
  assert.match(report, /config renderer: unsupported/);
  assert.match(report, /diagnose.*high.*prefer/);
});

test('config emission fails closed for unsupported host renderer', () => {
  assert.throws(
    () => assertConfigRendererSupported('example', { adapter: { configRenderer: 'unsupported' } }),
    /no supported config renderer/i,
  );
});

test('generated report check tolerates checkout line endings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-render-'));
  const generatedDir = join(root, 'agent-runtime', 'generated');
  await mkdir(generatedDir, { recursive: true });
  const host = {
    displayName: 'Example Host',
    reviewed: '2026-09-04',
    skills: { agentsRoot: true, skillModelRouting: false },
    adapter: { configRenderer: 'unsupported' },
  };
  await writeFile(join(root, 'agent-runtime', 'host-capabilities.json'), JSON.stringify({
    version: 1,
    hosts: { example: host },
  }, null, 2));
  await writeFile(join(root, 'agent-runtime', 'skill-runtime.json'), JSON.stringify(runtime, null, 2));
  const report = renderHostReport('example', host, runtime);
  await writeFile(join(generatedDir, 'example.md'), report.replace(/\n/g, '\r\n'));

  assert.deepEqual(await renderAll(root, { check: true }), []);
});
