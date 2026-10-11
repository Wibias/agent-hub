import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createCodexHostMemoryHookInstaller,
} from '../../scripts/codex-host-memory-hook-installer.mjs';

function corePlanner({ existing }) {
  return {
    config: {
      ...existing,
      hooks: {
        ...(existing.hooks ?? {}),
        SessionStart: [{ hooks: [{ type: 'command', command: 'node core.mjs' }] }],
      },
    },
    changed: true,
    diagnostics: { SessionStart: { action: 'install' } },
  };
}

test('host hook installer factory binds core planner and real passive planner into sync installer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'host-hook-installer-'));
  const hooksPath = join(root, 'hooks.json');
  await writeFile(hooksPath, JSON.stringify({ hooks: {} }), 'utf8');

  const install = createCodexHostMemoryHookInstaller({ planCoreHooks: corePlanner });
  const dry = install({
    hooksPath,
    hubRoot: root,
    nodePath: process.execPath,
    apply: false,
  });

  assert.equal(dry.wouldChange, true);
  assert.equal(dry.applied, false);
  assert.equal(dry.managed.coreMemory, true);
  assert.equal(dry.managed.passiveRunExtraction, true);
  assert.ok(dry.plan.core);
  assert.ok(dry.plan.passive);
});
