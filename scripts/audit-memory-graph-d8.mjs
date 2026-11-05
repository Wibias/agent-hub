#!/usr/bin/env node
/** D8: inspect an existing MemoryEngine DB without writing or printing private payloads. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { defaultCodexMemoryDbPath } from '../memory-engine/adapters/codex-hook-cli.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import { auditRepositoryEvidence } from '../memory-engine/memory-graph-d8-evidence-audit.mjs';

const HELP = `D8: read-only repository Evidence coverage audit (Node 24)

  node scripts/audit-memory-graph-d8.mjs --project-id ID --branch NAME [--db-path PATH]

Outputs counts and fixed diagnostic labels only. No claim content, Evidence text,
repository paths, source references, or raw exception messages are printed.
This command does NOT validate Git freshness or write MemoryEngine state.
`;

/** Reject ambiguous, duplicate, or implicit database/scope selections. */
export function parseD8Args(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('invalid arguments');
  const opts = { projectId: null, branch: null, dbPath: null, help: false };
  const flags = { '--project-id': 'projectId', '--branch': 'branch', '--db-path': 'dbPath' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (seen.has(name)) throw new TypeError('duplicate option');
    seen.add(name);
    if (name === '--help') { opts.help = true; continue; }
    if (!Object.hasOwn(flags, name)) throw new TypeError('unknown option');
    const next = argv[++i];
    if (typeof next !== 'string' || !next.trim() || next.startsWith('--') || next.includes('\0')) {
      throw new TypeError('invalid option value');
    }
    opts[flags[name]] = next.trim();
  }
  if (!opts.help && (!opts.projectId || !opts.branch)) {
    throw new TypeError('project-id and branch required');
  }
  return opts;
}

/** Execute only canonical read methods on a read-only SQLite connection. */
export async function executeD8EvidenceAudit({ argv = [], emit = console.log } = {}) {
  const args = parseD8Args(argv);
  if (args.help) { emit(HELP); return { outcome: 'help' }; }
  const dbPath = resolve(args.dbPath ?? defaultCodexMemoryDbPath());
  if (!existsSync(dbPath)) throw new Error('database_not_found');
  const memory = new MemoryEngine({ dbPath, readOnly: true });
  try {
    const report = auditRepositoryEvidence(memory.exportCanonical(), args);
    emit(JSON.stringify(report, null, 2));
    return report;
  } finally {
    memory.close();
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (import.meta.url === invoked) {
  try {
    const report = await executeD8EvidenceAudit({ argv: process.argv.slice(2) });
    if (report.outcome === 'blocked') process.exitCode = 2;
  } catch (error) {
    const code = error?.message === 'database_not_found' ? 'database_not_found'
      : error instanceof TypeError ? 'invalid_arguments_or_scope' : 'audit_runtime_error';
    console.error(JSON.stringify({ schemaVersion: 1, mode: 'read_only_evidence_audit', outcome: 'fail', code }));
    process.exitCode = 1;
  }
}
