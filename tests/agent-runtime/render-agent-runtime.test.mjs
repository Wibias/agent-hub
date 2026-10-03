import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderHostReport,
  renderAll,
  assertConfigRendererSupported,
  renderCodexProfileBundle,
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


test('host report renders documented lifecycle hook capability separately from config rendering', () => {
  const host = {
    displayName: 'OpenAI Codex',
    reviewed: '2026-09-30',
    sources: ['https://developers.openai.com/docs/hooks'],
    skills: { agentsRoot: true, skillModelRouting: false },
    hooks: {
      supported: true,
      command: true,
      pluginBundled: true,
      events: ['SessionStart', 'UserPromptSubmit'],
    },
    adapter: { configRenderer: 'unsupported' },
  };

  const report = renderHostReport('codex', host, runtime);
  assert.match(report, /lifecycle hooks: supported/);
  assert.match(report, /command hooks: supported/);
  assert.match(report, /plugin-bundled hooks: supported/);
  assert.match(report, /hook events: .*SessionStart.*UserPromptSubmit/);
  assert.match(report, /config renderer: unsupported/);
});


test('Codex profile renderer maps only reasoning and leaves isolation/mutation explicit but unmapped', () => {
  const bundle = renderCodexProfileBundle({
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

  assert.equal(bundle.host, 'codex');
  assert.deepEqual(bundle.mappedRuntimeFields, ['reasoning']);
  assert.deepEqual(bundle.unmappedRuntimeFields, ['isolation', 'mutation']);

  const diagnose = bundle.profiles.find((item) => item.skill === 'diagnose');
  assert.deepEqual(diagnose, {
    skill: 'diagnose',
    profile: 'agent-hub-diagnose',
    file: 'agent-hub-diagnose.config.toml',
    mapped: { reasoning: 'high' },
    unmapped: { isolation: 'prefer' },
  });

  const security = bundle.profiles.find(
    (item) => item.skill === 'security-review',
  );
  assert.deepEqual(security.unmapped, {
    isolation: 'prefer',
    mutation: 'read-only',
  });

  const diagnoseFile = bundle.files.find(
    (item) => item.path === 'agent-hub-diagnose.config.toml',
  );
  assert.match(diagnoseFile.content, /model_reasoning_effort = "high"/);
  assert.match(diagnoseFile.content, /isolation=prefer/);
  assert.doesNotMatch(diagnoseFile.content, /sandbox_mode/);
  assert.doesNotMatch(diagnoseFile.content, /approval_policy/);
  assert.doesNotMatch(diagnoseFile.content, /^model\s*=/m);
});

test('Codex renderer does not invent a profile when reasoning is inherited', () => {
  const bundle = renderCodexProfileBundle({
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

  assert.deepEqual(bundle.files, []);
  assert.deepEqual(bundle.profiles, []);
  assert.deepEqual(bundle.unrendered, [{
    skill: 'review-only',
    unmapped: {
      isolation: 'required',
      mutation: 'read-only',
    },
  }]);
});

test('Codex renderer rejects unsafe skill names before deriving profile filenames', () => {
  assert.throws(
    () => renderCodexProfileBundle({
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

test('renderAll materializes and checks Codex profile artifacts for a supported renderer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-codex-render-'));
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
    join(
      generatedDir,
      'codex-profiles',
      'agent-hub-diagnose.config.toml',
    ),
    'model_reasoning_effort = "low"\n',
  );

  const drift = await renderAll(root, { check: true });
  assert.equal(drift.length, 1);
  assert.match(
    drift[0],
    /codex-profiles[\\/]agent-hub-diagnose\.config\.toml$/,
  );
});
