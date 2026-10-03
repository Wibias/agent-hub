import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  auditCodexState,
  classifyCodexStateEntry,
  inspectAgentHubHookConfiguration,
} from '../../memory-engine/codex-state-audit.mjs';
import {
  runCodexStateAudit,
} from '../../scripts/audit-codex-state.mjs';

test('Codex state classifier distinguishes direct memory from adjacent persistent state', () => {
  const cases = [
    ['auth.json', 'file', 'auth', false],
    ['config.toml', 'file', 'runtime_config', false],
    ['hooks.json', 'file', 'hooks', false],
    ['memories_1.sqlite', 'file', 'direct_memory', true],
    ['memories', 'directory', 'direct_memory', true],
    ['memory', 'directory', 'direct_memory', true],
    ['state_5.sqlite', 'file', 'conversation_state', false],
    ['thread_history_1.sqlite', 'file', 'conversation_state', false],
    ['history.jsonl', 'file', 'conversation_state', false],
    ['sessions', 'directory', 'conversation_state', false],
    ['archived_sessions', 'directory', 'conversation_state', false],
    ['rollouts', 'directory', 'conversation_state', false],
    ['archived_rollouts', 'directory', 'conversation_state', false],
    ['goals_1.sqlite', 'file', 'persistent_runtime_state', false],
    ['skills', 'directory', 'instruction_surface', false],
    ['rules', 'directory', 'instruction_surface', false],
    ['AGENTS.md', 'file', 'instruction_surface', false],
    ['random-cache.bin', 'file', 'other', false],
  ];

  for (const [name, type, expectedClass, directMemoryRisk] of cases) {
    assert.deepEqual(
      classifyCodexStateEntry({ name, type }),
      {
        name,
        type,
        classification: expectedClass,
        directMemoryRisk,
      },
    );
  }
});

test('hook inspection reports the exact Agent Hub recall controls without exposing raw commands', () => {
  const hooks = {
    SessionStart: [
      {
        matcher: 'startup|resume|clear|compact',
        hooks: [
          {
            type: 'command',
            commandWindows: 'node C:\\repo\\memory-engine\\embedding-worker-launcher.mjs --cache-dir C:\\repo\\.cache\\memory-engine\\e5',
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            commandWindows: 'node C:\\repo\\memory-engine\\adapters\\codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall',
          },
        ],
      },
    ],
  };

  assert.deepEqual(
    inspectAgentHubHookConfiguration(hooks),
    {
      configured: true,
      userPromptSubmit: true,
      sessionStartLauncher: true,
      stopAgentDecisionCapture: false,
      subagentStopAgentDecisionCapture: false,
      flags: {
        ignoreMemoryEnv: true,
        explicitMemoryRequests: true,
        hybridRecall: true,
        candidateCapture: false,
        autoPipeline: false,
        agentDecisionCapture: false,
      },
    },
  );
});

test('hook inspection reports candidate capture when the managed hook enables it', () => {
  const result = inspectAgentHubHookConfiguration({
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node /repo/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall --candidate-capture',
          },
        ],
      },
    ],
  });

  assert.equal(result.flags.candidateCapture, true);
});

test('hook inspection reports automatic pipeline processing when enabled', () => {
  const result = inspectAgentHubHookConfiguration({
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node /repo/memory-engine/adapters/codex-hook-cli.mjs --candidate-capture --auto-pipeline',
          },
        ],
      },
    ],
  });

  assert.equal(result.flags.candidateCapture, true);
  assert.equal(result.flags.autoPipeline, true);
});

test('hook inspection reports complete root and subagent decision capture', () => {
  const result = inspectAgentHubHookConfiguration({
    Stop: [{
      hooks: [{
        type: 'command',
        command: 'node /repo/memory-engine/adapters/codex-agent-decision-hook-cli.mjs --ignore-memory-env --auto-pipeline',
      }],
    }],
    SubagentStop: [{
      hooks: [{
        type: 'command',
        command: 'node /repo/memory-engine/adapters/codex-agent-decision-hook-cli.mjs --ignore-memory-env --auto-pipeline',
      }],
    }],
  });

  assert.equal(result.stopAgentDecisionCapture, true);
  assert.equal(result.subagentStopAgentDecisionCapture, true);
  assert.equal(result.flags.agentDecisionCapture, true);
});

test('hook inspection accepts the real Codex hooks.json root wrapper', () => {
  const config = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              commandWindows: 'node C:\\repo\\memory-engine\\embedding-worker-launcher.mjs --cache-dir C:\\repo\\.cache\\memory-engine\\e5',
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              commandWindows: 'node C:\\repo\\memory-engine\\adapters\\codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall',
            },
          ],
        },
      ],
    },
  };

  assert.deepEqual(
    inspectAgentHubHookConfiguration(config),
    {
      configured: true,
      userPromptSubmit: true,
      sessionStartLauncher: true,
      stopAgentDecisionCapture: false,
      subagentStopAgentDecisionCapture: false,
      flags: {
        ignoreMemoryEnv: true,
        explicitMemoryRequests: true,
        hybridRecall: true,
        candidateCapture: false,
        autoPipeline: false,
        agentDecisionCapture: false,
      },
    },
  );
});

test('hook inspection fails closed for unrelated Codex hooks', () => {
  assert.deepEqual(
    inspectAgentHubHookConfiguration({
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node ./unrelated-hook.mjs',
            },
          ],
        },
      ],
    }),
    {
      configured: false,
      userPromptSubmit: false,
      sessionStartLauncher: false,
      stopAgentDecisionCapture: false,
      subagentStopAgentDecisionCapture: false,
      flags: {
        ignoreMemoryEnv: false,
        explicitMemoryRequests: false,
        hybridRecall: false,
        candidateCapture: false,
        autoPipeline: false,
        agentDecisionCapture: false,
      },
    },
  );
});

test('Codex state audit reports legacy memory separately from conversation history and instructions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-state-audit-'));

  await writeFile(join(root, 'auth.json'), '{"token":"fixture"}\n');
  await writeFile(join(root, 'config.toml'), 'model = "fixture"\n');
  await writeFile(join(root, 'memories_1.sqlite'), 'fixture');
  await writeFile(join(root, 'state_5.sqlite'), 'fixture');
  await writeFile(join(root, 'thread_history_1.sqlite'), 'fixture');
  await writeFile(join(root, 'history.jsonl'), '{}\n');
  await mkdir(join(root, 'sessions'));
  await mkdir(join(root, 'skills'));
  await writeFile(join(root, 'AGENTS.md'), '# global instructions\n');
  await writeFile(
    join(root, 'hooks.json'),
    JSON.stringify({
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node /repo/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall',
            },
          ],
        },
      ],
    }),
  );

  const report = await auditCodexState({ codexHome: root });

  assert.equal(report.codexHome, root);
  assert.deepEqual(report.agentHubHook, {
    configured: true,
    userPromptSubmit: true,
    sessionStartLauncher: false,
    stopAgentDecisionCapture: false,
    subagentStopAgentDecisionCapture: false,
    flags: {
      ignoreMemoryEnv: true,
      explicitMemoryRequests: true,
      hybridRecall: true,
      candidateCapture: false,
      autoPipeline: false,
      agentDecisionCapture: false,
    },
  });

  assert.deepEqual(report.summary, {
    directMemorySurfaces: 1,
    conversationStateSurfaces: 4,
    persistentRuntimeStateSurfaces: 0,
    instructionSurfaces: 2,
    unknownSurfaces: 0,
    agentHubHookConfigured: true,
    status: 'legacy_memory_present',
  });

  assert.deepEqual(
    report.directMemory.map((entry) => entry.name),
    ['memories_1.sqlite'],
  );
  assert.deepEqual(
    report.conversationState.map((entry) => entry.name),
    [
      'history.jsonl',
      'sessions',
      'state_5.sqlite',
      'thread_history_1.sqlite',
    ],
  );
  assert.deepEqual(
    report.instructions.map((entry) => entry.name),
    ['AGENTS.md', 'skills'],
  );
});

test('Codex state audit does not claim conversation history is direct memory contamination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-state-history-'));
  await mkdir(join(root, 'sessions'));
  await writeFile(join(root, 'state_5.sqlite'), 'fixture');
  await writeFile(
    join(root, 'hooks.json'),
    JSON.stringify({
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node /repo/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall',
            },
          ],
        },
      ],
    }),
  );

  const report = await auditCodexState({ codexHome: root });

  assert.equal(report.summary.directMemorySurfaces, 0);
  assert.equal(report.summary.conversationStateSurfaces, 2);
  assert.equal(report.summary.status, 'no_direct_legacy_memory_detected');
});

test('Codex state audit reports missing Agent Hub hook distinctly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-state-no-hook-'));
  await writeFile(join(root, 'memories_1.sqlite'), 'fixture');

  const report = await auditCodexState({ codexHome: root });

  assert.equal(report.summary.directMemorySurfaces, 1);
  assert.equal(report.summary.agentHubHookConfigured, false);
  assert.equal(report.summary.status, 'agent_hub_hook_missing_with_legacy_memory');
});


test('audit CLI emits one machine-readable report without raw hook commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-state-cli-'));
  await writeFile(join(root, 'memories_1.sqlite'), 'fixture');
  await writeFile(
    join(root, 'hooks.json'),
    JSON.stringify({
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node /secret/repo/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall',
            },
          ],
        },
      ],
    }),
  );

  const lines = [];
  const output = await runCodexStateAudit({
    argv: ['--codex-home', root],
    log(value) {
      lines.push(value);
    },
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.type, 'codex_state_audit');
  assert.equal(parsed.summary.status, 'legacy_memory_present');
  assert.equal(parsed.agent_hub_hook.configured, true);
  assert.deepEqual(parsed.direct_memory, [
    {
      name: 'memories_1.sqlite',
      type: 'file',
      classification: 'direct_memory',
    },
  ]);
  assert.equal(lines[0].includes('/secret/repo'), false);
  assert.deepEqual(parsed, output);
});
