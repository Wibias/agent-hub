import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderHostReport,
  renderAll,
  assertConfigRendererSupported,
  renderCodexRuntimeBundle,
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
    () => assertConfigRendererSupported(
      'example',
      { adapter: { configRenderer: 'unsupported' } },
    ),
    /no supported config renderer/i,
  );
});

test('generated report check tolerates checkout line endings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-render-'));
  try {
    const generatedDir = join(root, 'agent-runtime', 'generated');
    await mkdir(generatedDir, { recursive: true });
    const host = {
      displayName: 'Example Host',
      reviewed: '2026-09-04',
      skills: { agentsRoot: true, skillModelRouting: false },
      adapter: { configRenderer: 'unsupported' },
    };
    await writeFile(
      join(root, 'agent-runtime', 'host-capabilities.json'),
      JSON.stringify({ version: 1, hosts: { example: host } }, null, 2),
    );
    await writeFile(
      join(root, 'agent-runtime', 'skill-runtime.json'),
      JSON.stringify(runtime, null, 2),
    );
    const report = renderHostReport('example', host, runtime);
    await writeFile(
      join(generatedDir, 'example.md'),
      report.replace(/\n/g, '\r\n'),
    );

    assert.deepEqual(await renderAll(root, { check: true }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('host report renders documented lifecycle hook capability separately from config rendering', () => {
  const host = {
    displayName: 'OpenAI Codex',
    reviewed: '2026-10-03',
    sources: ['https://developers.openai.com/docs/hooks'],
    skills: { agentsRoot: true, skillModelRouting: false },
    hooks: {
      supported: true,
      command: true,
      pluginBundled: true,
      events: ['SessionStart', 'UserPromptSubmit'],
    },
    adapter: { configRenderer: 'supported' },
  };

  const report = renderHostReport('codex', host, runtime);
  assert.match(report, /lifecycle hooks: supported/);
  assert.match(report, /command hooks: supported/);
  assert.match(report, /plugin-bundled hooks: supported/);
  assert.match(report, /hook events: .*SessionStart.*UserPromptSubmit/);
  assert.match(report, /config renderer: supported/);
});

test('Codex runtime renderer maps only reasoning and keeps other semantics unmapped', () => {
  const bundle = renderCodexRuntimeBundle({
    defaults: {
      reasoning: 'inherit',
      isolation: 'inherit',
      mutation: 'inherit',
    },
    skills: {
      diagnose: {
        reasoning: 'high',
        isolation: 'prefer',
      },
      'security-review': {
        reasoning: 'high',
        isolation: 'prefer',
        mutation: 'read-only',
      },
      'writing-ticks': {
        reasoning: 'low',
      },
    },
  });

  assert.equal(bundle.schemaVersion, 2);
  assert.equal(bundle.host, 'codex');
  assert.equal(bundle.activation.mode, 'cli-override');
  assert.equal(bundle.activation.precedence, 'cli-override');
  assert.deepEqual(bundle.mappedRuntimeFields, ['reasoning']);
  assert.deepEqual(bundle.unmappedRuntimeFields, ['isolation', 'mutation']);

  const diagnose = bundle.runtimes.find((item) => item.skill === 'diagnose');
  assert.deepEqual(diagnose, {
    skill: 'diagnose',
    mapped: { reasoning: 'high' },
    unmapped: { isolation: 'prefer' },
  });

  const security = bundle.runtimes.find(
    (item) => item.skill === 'security-review',
  );
  assert.deepEqual(security.unmapped, {
    isolation: 'prefer',
    mutation: 'read-only',
  });

  assert.equal(Object.hasOwn(diagnose.mapped, 'model'), false);
  assert.equal(Object.hasOwn(diagnose.mapped, 'sandbox_mode'), false);
  assert.equal(Object.hasOwn(diagnose.mapped, 'approval_policy'), false);
});

test('Codex runtime renderer does not invent a launch mapping when reasoning is inherited', () => {
  const bundle = renderCodexRuntimeBundle({
    defaults: {
      reasoning: 'inherit',
      isolation: 'inherit',
      mutation: 'inherit',
    },
    skills: {
      'review-only': {
        isolation: 'required',
        mutation: 'read-only',
      },
    },
  });

  assert.deepEqual(bundle.runtimes, []);
  assert.deepEqual(bundle.unrendered, [{
    skill: 'review-only',
    unmapped: {
      isolation: 'required',
      mutation: 'read-only',
    },
  }]);
});

test('Codex runtime renderer rejects unsafe skill names', () => {
  assert.throws(
    () => renderCodexRuntimeBundle({
      defaults: {
        reasoning: 'inherit',
        isolation: 'inherit',
        mutation: 'inherit',
      },
      skills: {
        '../escape': { reasoning: 'high' },
      },
    }),
    /unsafe skill name/i,
  );
});

test('renderAll materializes and checks CLI runtime manifest and rejects legacy generated profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-codex-render-'));
  try {
    const generatedDir = join(root, 'agent-runtime', 'generated');
    await mkdir(generatedDir, { recursive: true });

    await writeFile(
      join(root, 'agent-runtime', 'host-capabilities.json'),
      JSON.stringify({
        version: 1,
        hosts: {
          codex: {
            displayName: 'OpenAI Codex',
            reviewed: '2026-10-03',
            skills: {
              agentsRoot: true,
              skillModelRouting: false,
            },
            adapter: {
              configRenderer: 'supported',
            },
          },
        },
      }, null, 2),
    );
    await writeFile(
      join(root, 'agent-runtime', 'skill-runtime.json'),
      JSON.stringify({
        defaults: {
          reasoning: 'inherit',
          isolation: 'inherit',
          mutation: 'inherit',
        },
        skills: {
          diagnose: {
            reasoning: 'high',
            isolation: 'prefer',
          },
        },
      }, null, 2),
    );

    assert.deepEqual(await renderAll(root), []);
    assert.deepEqual(await renderAll(root, { check: true }), []);

    await writeFile(
      join(generatedDir, 'codex-runtime', 'manifest.json'),
      '{"broken":true}\n',
    );
    let drift = await renderAll(root, { check: true });
    assert.equal(drift.length, 1);
    assert.match(
      drift[0],
      /codex-runtime[\\/]manifest\.json$/,
    );

    await renderAll(root);
    const legacyDir = join(generatedDir, 'codex-profiles');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, 'agent-hub-diagnose.config.toml'),
      'model_reasoning_effort = "high"\n',
    );

    drift = await renderAll(root, { check: true });
    assert.ok(drift.some((item) => /codex-profiles$/.test(item)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
