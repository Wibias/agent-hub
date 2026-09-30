#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveGitContext } from '../git-freshness.mjs';
import { MemoryEngine } from '../index.mjs';
import { createMemoryProtocol } from '../protocol.mjs';
import {
  parseCodexMemoryConfig,
  resolveCodexProjectScope,
} from './codex-hook-cli.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireObject(value, name) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireAllowedKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${name} contains a forbidden field`);
    }
  }
}

function requireString(value, name) {
  if (!nonEmptyString(value)) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, name) {
  if (value === undefined || value === null) return null;
  return requireString(value, name);
}

function stringArray(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function normalizeCommitInput(input) {
  requireObject(input, 'input');
  requireAllowedKeys(
    input,
    new Set(['evidence_id', 'claim', 'lifecycle']),
    'input',
  );

  const claim = requireObject(input.claim, 'claim');
  requireAllowedKeys(
    claim,
    new Set([
      'kind',
      'subject',
      'predicate',
      'value',
      'valid_from',
      'valid_until',
    ]),
    'claim',
  );

  const lifecycle = input.lifecycle ?? {};
  requireObject(lifecycle, 'lifecycle');
  requireAllowedKeys(
    lifecycle,
    new Set(['supersedes', 'rejects', 'conflicts_with']),
    'lifecycle',
  );

  return {
    evidenceId: requireString(input.evidence_id, 'evidence_id'),
    claim: {
      kind: requireString(claim.kind, 'claim.kind'),
      subject: requireString(claim.subject, 'claim.subject'),
      predicate: requireString(claim.predicate, 'claim.predicate'),
      value: requireString(claim.value, 'claim.value'),
      validFrom: optionalString(claim.valid_from, 'claim.valid_from'),
      validUntil: optionalString(claim.valid_until, 'claim.valid_until'),
    },
    lifecycle: {
      supersedes: stringArray(lifecycle.supersedes, 'lifecycle.supersedes'),
      rejects: stringArray(lifecycle.rejects, 'lifecycle.rejects'),
      conflictsWith: stringArray(
        lifecycle.conflicts_with,
        'lifecycle.conflicts_with',
      ),
    },
  };
}

function lifecycleTargetsStayInScope({
  memory,
  lifecycle,
  projectId,
  branch,
}) {
  const targetIds = [
    ...lifecycle.supersedes,
    ...lifecycle.rejects,
    ...lifecycle.conflictsWith,
  ];

  for (const targetId of targetIds) {
    const target = memory.getClaim(targetId);
    if (
      !target
      || target.project_id !== projectId
      || target.branch_scope !== branch
    ) {
      return false;
    }
  }
  return true;
}

function createExplicitUserClaimAuthorizer({
  memory,
  projectId,
  branch,
}) {
  return ({ evidence, claim, lifecycle }) => (
    evidence.project_id === projectId
    && evidence.branch === branch
    && evidence.authority_class === 'user_direct'
    && claim.branchScope === branch
    && lifecycleTargetsStayInScope({
      memory,
      lifecycle,
      projectId,
      branch,
    })
  );
}

function defaultEnsureDbDirectory(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export async function commitCodexMemoryClaim({
  input,
  cwd = process.cwd(),
  env = process.env,
  configOptions = {},
  clock = () => new Date().toISOString(),
  claimIdFactory = () => `claim:codex:${randomUUID()}`,
  createEngine = (options) => new MemoryEngine(options),
  createProtocol = createMemoryProtocol,
  resolveProjectScope = resolveCodexProjectScope,
  resolveContext = resolveGitContext,
  ensureDbDirectory = defaultEnsureDbDirectory,
} = {}) {
  const normalized = normalizeCommitInput(input);
  const config = parseCodexMemoryConfig(env, configOptions);
  const scope = resolveProjectScope({
    event: { cwd },
    config,
  });
  const gitContext = resolveContext({ cwd });

  if (
    configOptions.ignoreMemoryEnv === true
    || !nonEmptyString(env.AGENT_HUB_MEMORY_DB)
  ) {
    ensureDbDirectory(config.dbPath);
  }

  const memory = createEngine({ dbPath: config.dbPath });
  try {
    if (!memory.getProject(scope.projectId)) {
      const registration = {
        projectId: scope.projectId,
        repoIdentity: scope.repoIdentity,
      };
      if (scope.canonicalRemote !== null) {
        registration.canonicalRemote = scope.canonicalRemote;
      }
      memory.registerProject(registration);
    }

    const claimId = requireString(claimIdFactory(), 'generated claim id');
    const createdAt = requireString(clock(), 'generated claim timestamp');

    const protocol = createProtocol({
      memory,
      authorizeClaim: createExplicitUserClaimAuthorizer({
        memory,
        projectId: scope.projectId,
        branch: gitContext.branch,
      }),
    });

    const claim = {
      id: claimId,
      kind: normalized.claim.kind,
      subject: normalized.claim.subject,
      predicate: normalized.claim.predicate,
      value: normalized.claim.value,
      branch_scope: gitContext.branch,
      created_at: createdAt,
    };
    if (normalized.claim.validFrom !== null) {
      claim.valid_from = normalized.claim.validFrom;
    }
    if (normalized.claim.validUntil !== null) {
      claim.valid_until = normalized.claim.validUntil;
    }

    const response = await protocol.handle({
      protocol: 'memory.protocol.v1',
      operation: 'assert_claim',
      request_id: `codex-memory-commit:${claimId}`,
      payload: {
        evidence_id: normalized.evidenceId,
        claim,
        lifecycle: {
          supersedes: normalized.lifecycle.supersedes,
          rejects: normalized.lifecycle.rejects,
          conflicts_with: normalized.lifecycle.conflictsWith,
        },
      },
    });

    if (!response?.ok) {
      throw new Error(
        response?.error?.message ?? 'Memory claim commit was denied.',
      );
    }

    return {
      project_id: scope.projectId,
      branch: gitContext.branch,
      evidence_id: normalized.evidenceId,
      claim_id: response.result.claim.id,
      state: response.result.claim.state,
    };
  } finally {
    memory.close();
  }
}

async function readStdin(stream = process.stdin) {
  stream.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stream) {
    raw += chunk;
  }
  return raw;
}

function parseCliOptions(args) {
  const options = {
    ignoreMemoryEnv: false,
  };
  for (const arg of args) {
    if (arg === '--ignore-memory-env') {
      options.ignoreMemoryEnv = true;
      continue;
    }
    throw new Error('Unsupported memory commit CLI option.');
  }
  return options;
}

async function main() {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const result = await commitCodexMemoryClaim({
      input,
      configOptions: {
        ignoreMemoryEnv: options.ignoreMemoryEnv,
      },
    });
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: {
        code: 'memory_commit_failed',
        message: 'Memory claim commit failed.',
      },
    })}\n`);
    process.exitCode = 2;
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
