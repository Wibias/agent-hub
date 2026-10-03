#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyCodexNativeMemoryIsolation,
  planCodexNativeMemoryIsolation,
} from '../memory-engine/codex-native-memory-isolation.mjs';
import { runMemoryDoctor } from '../memory-engine/memory-doctor.mjs';
import {
  installCodexMemoryHooks,
} from './install-codex-memory-hooks.mjs';
import {
  planLegacyCodexProfileRetirement,
  retireLegacyCodexProfiles,
} from './retire-codex-runtime-profiles.mjs';
import { renderAll } from './render-agent-runtime.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultHubRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function defaultCodexHome(env = process.env) {
  if (nonEmpty(env.CODEX_HOME)) return resolve(env.CODEX_HOME.trim());
  return join(homedir(), '.codex');
}

async function readCodexConfig(codexHome) {
  const configPath = join(codexHome, 'config.toml');
  try {
    return {
      configPath,
      exists: true,
      text: await readFile(configPath, 'utf8'),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        configPath,
        exists: false,
        text: '',
      };
    }
    throw error;
  }
}

function summarizeDoctor(report) {
  return {
    status: report?.status ?? 'broken',
    context: {
      status: report?.context?.status ?? null,
      projectId: report?.context?.projectId ?? null,
      branch: report?.context?.branch ?? null,
      revisionSha: report?.context?.revisionSha ?? null,
    },
    database: {
      status: report?.database?.status ?? null,
      quickCheck: report?.database?.quickCheck ?? null,
      lexicalCoverageComplete:
        report?.database?.lexicalCoverageComplete ?? null,
      semanticCoverageComplete:
        report?.database?.semanticCoverageComplete ?? null,
    },
    embedding: {
      cache: report?.embedding?.cache?.status ?? null,
      worker: report?.embedding?.worker?.status ?? null,
    },
    recall: {
      status: report?.recall?.status ?? null,
      reason: report?.recall?.reason ?? null,
    },
    codex: {
      status: report?.codex?.status ?? null,
      reason: report?.codex?.reason ?? null,
      flags: report?.codex?.hook?.flags ?? null,
      sessionStartLauncher:
        report?.codex?.hook?.sessionStartLauncher ?? null,
    },
    nativeCodexMemory: {
      status: report?.nativeCodexMemory?.status ?? null,
      reasons: report?.nativeCodexMemory?.reasons ?? [],
    },
    restoreRecovery: {
      status: report?.restoreRecovery?.status ?? null,
      reason: report?.restoreRecovery?.reason ?? null,
    },
  };
}

function nextSteps({
  hookTrustRequired,
  restartRequired,
  doctorStatus,
}) {
  const steps = [];
  if (hookTrustRequired) {
    steps.push(
      'Restart Codex, open /hooks, and review/trust the changed Agent Hub hook definitions.',
    );
  } else if (restartRequired) {
    steps.push('Restart Codex so changed persistent configuration is reloaded.');
  }
  if (doctorStatus !== 'healthy') {
    steps.push(
      'Run node .\\scripts\\doctor-memory.mjs for the full diagnostic report.',
    );
  }
  return steps;
}

function overallStatus({
  drift,
  apply,
  changesRequired,
  doctorStatus,
}) {
  if (drift.length > 0) return 'blocked_generated_drift';
  if (!apply && changesRequired) return 'changes_required';
  if (doctorStatus === 'healthy') return 'healthy';
  if (doctorStatus === 'degraded') return 'degraded';
  return 'broken';
}

export function parseCodexHostSetupArgs(
  argv = [],
  env = process.env,
) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  const result = {
    apply: false,
    cwd: process.cwd(),
    hubRoot: defaultHubRoot(),
    codexHome: defaultCodexHome(env),
    nodePath: process.execPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      result.apply = true;
      continue;
    }
    if (
      [
        '--cwd',
        '--hub-root',
        '--codex-home',
        '--node',
      ].includes(arg)
    ) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a path');
      if (arg === '--cwd') result.cwd = resolve(value);
      if (arg === '--hub-root') result.hubRoot = resolve(value);
      if (arg === '--codex-home') result.codexHome = resolve(value);
      if (arg === '--node') result.nodePath = resolve(value);
      index += 1;
      continue;
    }

    throw new Error(
      'Unknown option: ' + arg
      + '\nUsage: node scripts/setup-codex-host.mjs '
      + '[--apply] [--cwd PATH] [--hub-root PATH] '
      + '[--codex-home PATH] [--node PATH]',
    );
  }

  return result;
}

export async function runCodexHostSetup({
  apply = false,
  cwd = process.cwd(),
  hubRoot = defaultHubRoot(),
  codexHome = defaultCodexHome(),
  nodePath = process.execPath,
  dependencies = {},
} = {}) {
  const deps = {
    renderAll: dependencies.renderAll ?? renderAll,
    installHooks:
      dependencies.installHooks ?? installCodexMemoryHooks,
    readConfig: dependencies.readConfig ?? readCodexConfig,
    planIsolation:
      dependencies.planIsolation ?? planCodexNativeMemoryIsolation,
    applyIsolation:
      dependencies.applyIsolation ?? applyCodexNativeMemoryIsolation,
    planRetirement:
      dependencies.planRetirement ?? planLegacyCodexProfileRetirement,
    retireProfiles:
      dependencies.retireProfiles ?? retireLegacyCodexProfiles,
    doctor: dependencies.doctor ?? runMemoryDoctor,
  };

  const resolvedHubRoot = resolve(hubRoot);
  const resolvedCwd = resolve(cwd);
  const resolvedCodexHome = resolve(codexHome);
  const hooksPath = join(resolvedCodexHome, 'hooks.json');

  const drift = await deps.renderAll(
    resolvedHubRoot,
    { check: true },
  );

  if (!Array.isArray(drift)) {
    throw new TypeError('renderAll must return a drift array');
  }

  if (drift.length > 0) {
    return {
      type: 'agent_hub_codex_host_setup',
      schemaVersion: 1,
      mode: apply ? 'apply' : 'dry-run',
      status: 'blocked_generated_drift',
      hubRoot: resolvedHubRoot,
      cwd: resolvedCwd,
      codexHome: resolvedCodexHome,
      runtime: {
        status: 'blocked',
        generatedDrift: drift,
      },
      mutationsApplied: false,
      nextSteps: [
        'Regenerate and commit Agent Hub runtime artifacts before changing host state.',
      ],
    };
  }

  const config = await deps.readConfig(resolvedCodexHome);
  const isolationPlan = deps.planIsolation(config.text);
  const hookPlan = deps.installHooks({
    hooksPath,
    hubRoot: resolvedHubRoot,
    nodePath,
    apply: false,
  });
  const retirementPlan = deps.planRetirement({
    codexHome: resolvedCodexHome,
  });
  const beforeDoctor = await deps.doctor({
    cwd: resolvedCwd,
    codexHome: resolvedCodexHome,
  });

  const changesRequired = (
    hookPlan.wouldChange === true
    || isolationPlan.changed === true
    || retirementPlan.wouldChange === true
  );

  if (!apply) {
    const doctor = summarizeDoctor(beforeDoctor);
    return {
      type: 'agent_hub_codex_host_setup',
      schemaVersion: 1,
      mode: 'dry-run',
      status: overallStatus({
        drift,
        apply,
        changesRequired,
        doctorStatus: doctor.status,
      }),
      hubRoot: resolvedHubRoot,
      cwd: resolvedCwd,
      codexHome: resolvedCodexHome,
      runtime: {
        status: 'current',
        generatedDrift: [],
      },
      plan: {
        hooks: {
          wouldChange: hookPlan.wouldChange === true,
          hookTrustRequired:
            hookPlan.hookTrustRequired === true,
          managed: hookPlan.managed ?? null,
          events: hookPlan.plan ?? null,
        },
        nativeMemoryIsolation: {
          configPath: config.configPath,
          configExists: config.exists,
          wouldChange: isolationPlan.changed === true,
          before: isolationPlan.before,
          after: isolationPlan.after,
          backupRequired:
            config.exists === true && isolationPlan.changed === true,
        },
        legacyRuntimeProfiles: {
          wouldChange: retirementPlan.wouldChange === true,
          profiles:
            retirementPlan.profiles?.map((entry) => entry.file) ?? [],
          backupRequired:
            retirementPlan.wouldChange === true,
        },
      },
      doctor,
      mutationsApplied: false,
      nextSteps: changesRequired
        ? ['Review this plan, then rerun with --apply.']
        : nextSteps({
          hookTrustRequired: false,
          restartRequired: false,
          doctorStatus: doctor.status,
        }),
    };
  }

  const nativeMemory = isolationPlan.changed
    ? await deps.applyIsolation({
      codexHome: resolvedCodexHome,
    })
    : {
      changed: false,
      configPath: config.configPath,
      backupPath: null,
      settings: isolationPlan.after,
    };

  const hooks = deps.installHooks({
    hooksPath,
    hubRoot: resolvedHubRoot,
    nodePath,
    apply: true,
  });

  const legacyProfiles = retirementPlan.wouldChange
    ? deps.retireProfiles({
      codexHome: resolvedCodexHome,
      apply: true,
    })
    : {
      ...retirementPlan,
      applied: false,
      backups: [],
    };

  const afterDoctor = await deps.doctor({
    cwd: resolvedCwd,
    codexHome: resolvedCodexHome,
  });
  const doctor = summarizeDoctor(afterDoctor);
  const hookTrustRequired = hooks.hookTrustRequired === true;
  const restartRequired = (
    nativeMemory.changed === true
    || hooks.applied === true
  );

  return {
    type: 'agent_hub_codex_host_setup',
    schemaVersion: 1,
    mode: 'apply',
    status: overallStatus({
      drift,
      apply,
      changesRequired: false,
      doctorStatus: doctor.status,
    }),
    hubRoot: resolvedHubRoot,
    cwd: resolvedCwd,
    codexHome: resolvedCodexHome,
    runtime: {
      status: 'current',
      generatedDrift: [],
    },
    applied: {
      hooks: {
        changed: hooks.applied === true,
        backupPath: hooks.backupPath ?? null,
        hookTrustRequired,
      },
      nativeMemoryIsolation: {
        changed: nativeMemory.changed === true,
        configPath: nativeMemory.configPath ?? config.configPath,
        backupPath: nativeMemory.backupPath ?? null,
        settings: nativeMemory.settings ?? isolationPlan.after,
      },
      legacyRuntimeProfiles: {
        changed: legacyProfiles.applied === true,
        backups: legacyProfiles.backups ?? [],
      },
    },
    doctor,
    mutationsApplied: (
      hooks.applied === true
      || nativeMemory.changed === true
      || legacyProfiles.applied === true
    ),
    restartRequired,
    nextSteps: nextSteps({
      hookTrustRequired,
      restartRequired,
      doctorStatus: doctor.status,
    }),
  };
}

export async function main({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const options = parseCodexHostSetupArgs(argv);
    const result = await runCodexHostSetup(options);
    stdout.write(JSON.stringify(result, null, 2) + '\n');

    if (
      result.status === 'blocked_generated_drift'
      || result.status === 'broken'
    ) {
      process.exitCode = 2;
    } else if (result.status === 'degraded') {
      process.exitCode = 1;
    }
  } catch (error) {
    stderr.write(
      (error instanceof Error ? error.message : String(error))
      + '\n',
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
