#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  finalizePromotedMemoryCandidates,
} from '../memory-engine/memory-candidate-promotion.mjs';
import {
  defaultCodexMemoryDbPath,
  resolveCodexProjectScope,
} from '../memory-engine/adapters/codex-hook-cli.mjs';
import { resolveGitContext } from '../memory-engine/git-freshness.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parsePositiveInt(value, name, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(name + ' must be an integer between 1 and ' + max);
  }
  return parsed;
}

export function parseMemoryCandidatePromotionArgs(
  argv = [],
  defaultCwd = process.cwd(),
) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  const options = {
    cwd: defaultCwd,
    dbPath: null,
    limit: 10,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (['--cwd', '--db-path', '--limit'].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
      index += 1;

      if (arg === '--cwd') options.cwd = resolve(value);
      else if (arg === '--db-path') options.dbPath = resolve(value);
      else options.limit = parsePositiveInt(value, '--limit', 20);
      continue;
    }

    throw new Error('unknown argument: ' + arg);
  }

  return options;
}

export function resolveMemoryCandidatePromotionRuntime({
  cwd,
  dbPath,
  env = process.env,
} = {}) {
  const git = resolveGitContext({ cwd });
  const scope = resolveCodexProjectScope({
    event: { cwd },
    config: {
      projectId: null,
      repoIdentity: null,
    },
  });

  return {
    cwd: git.repoPath,
    dbPath: dbPath ?? defaultCodexMemoryDbPath({ env }),
    projectId: scope.projectId,
    branch: git.branch,
    revisionSha: git.revisionSha,
  };
}

export function runMemoryCandidatePromotionCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  log = console.log,
  dependencies = {},
} = {}) {
  const options = parseMemoryCandidatePromotionArgs(argv, cwd);
  const resolveRuntime = dependencies.resolveRuntime
    || resolveMemoryCandidatePromotionRuntime;
  const createMemory = dependencies.createMemory
    || (({ dbPath }) => new MemoryEngine({ dbPath }));
  const finalizeCandidates = dependencies.finalizeCandidates
    || finalizePromotedMemoryCandidates;

  const runtime = resolveRuntime({
    cwd: options.cwd,
    dbPath: options.dbPath,
  });
  const memory = createMemory({ dbPath: runtime.dbPath });

  try {
    const output = finalizeCandidates({
      memory,
      projectId: runtime.projectId,
      branch: runtime.branch,
      apply: options.apply,
      limit: options.limit,
    });
    log(JSON.stringify(output));
    return output;
  } finally {
    if (memory && typeof memory.close === 'function') memory.close();
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  try {
    runMemoryCandidatePromotionCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
