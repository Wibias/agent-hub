#!/usr/bin/env node
/** Read-only typed advisory discovery. No provider call without --judge. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryEngine } from '../memory-engine/index.mjs';
import { discoverTypedRelations, planTypedRelationDiscovery } from '../memory-engine/typed-relation-discovery.mjs';
import { SEMANTIC_RELATION_POLICY_VERSION } from '../memory-engine/semantic-relation-judge.mjs';
import { createIsolatedCodexJsonJudge } from './codex-isolated-memory-judge.mjs';

function parse(argv) {
  const options = { runJudge: false };
  const flags = new Map([
    ['--db-path', 'dbPath'], ['--project', 'projectId'], ['--branch', 'branch'],
    ['--source', 'sourceClaimId'], ['--after', 'afterClaimId'],
    ['--limit', 'maxSources'], ['--targets', 'maxTargets'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--judge' && !options.runJudge) { options.runJudge = true; continue; }
    const field = flags.get(arg);
    const value = argv[++i];
    if (!field || !value || value.startsWith('--') || Object.hasOwn(options, field)) throw new Error('Invalid or repeated option');
    options[field] = field === 'maxSources' || field === 'maxTargets' ? Number(value) : value;
  }
  if (!options.dbPath || !options.projectId || !options.branch) {
    throw new Error('Usage: node scripts/discover-typed-relations.mjs --db-path PATH --project ID --branch NAME [--source ID | --after ID] [--limit N] [--targets N] [--judge]');
  }
  options.dbPath = resolve(options.dbPath);
  if (!existsSync(options.dbPath)) throw new Error('Database must already exist');
  return options;
}

async function main() {
  const { dbPath, runJudge, ...scope } = parse(process.argv.slice(2));
  const memory = new MemoryEngine({ dbPath, readOnly: true });
  let judge;
  try {
    const plan = planTypedRelationDiscovery({ memory, ...scope });
    if (!runJudge || plan.batches.length === 0) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    // Only the explicitly selected project/branch candidates are supplied to
    // the already configured isolated provider. Never write model output.
    judge = await createIsolatedCodexJsonJudge({
      workspaceLabel: 'typed-relation-discovery',
      policyVersion: SEMANTIC_RELATION_POLICY_VERSION,
    });
    const report = await discoverTypedRelations({
      memory, ...scope, judge: ({ prompt }) => judge.judge(prompt),
    });
    console.log(JSON.stringify({ ...report, evaluatorId: judge.evaluatorId }, null, 2));
    if (report.failed) process.exitCode = 1;
  } finally {
    try { await judge?.close(); } finally { memory.close(); }
  }
}

main().catch(error => {
  console.error(error.message?.startsWith('Usage:') ? error.message : 'Typed-relation discovery failed. No memory writes were requested.');
  process.exitCode = 1;
});
