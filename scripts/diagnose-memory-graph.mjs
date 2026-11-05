#!/usr/bin/env node
/**
 * D6: read-only offline production smoke test for the Memory Graph Console.
 * Output contains only scope identifiers, status counts, reason codes and timings.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { defaultCodexMemoryDbPath } from '../memory-engine/adapters/codex-hook-cli.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import {
  createAsyncGitGraphView,
  resolveMemoryConsoleGitScopeAsync,
} from '../memory-engine/memory-console-git-context.mjs';
import {
  listGraphDiagnosticScopes,
  parseGraphDiagnosticsArgs,
  runGraphDiagnostics,
} from '../memory-engine/memory-graph-diagnostics.mjs';
import { memoryUiGraph } from '../memory-engine/memory-ui-model.mjs';

const HELP = `Memory Graph D6 read-only diagnostics (Node 24)

Discover scopes:
  node scripts/diagnose-memory-graph.mjs --list-scopes [--db-path PATH]

Smoke test and p50/p95 benchmark:
  node scripts/diagnose-memory-graph.mjs --project-id ID --branch NAME
    [--db-path PATH] [--repo-root PATH ...] [--samples 1..20]
    [--max-p95-ms POSITIVE_NUMBER]

Only explicitly configured --repo-root values can verify Git freshness.
No claim values, raw Evidence, repository paths or raw exception messages are printed.
No MemoryEngine writes or production Recall changes are made.`;

/** Run a read-only query and produce a sanitized report. */
export async function executeMemoryGraphDiagnosis({ argv = [], emit = console.log } = {}) {
  const options = parseGraphDiagnosticsArgs(argv);
  if (options.help) { emit(HELP); return { outcome: 'help' }; }
  const dbPath = resolve(options.dbPath ?? defaultCodexMemoryDbPath());
  if (!existsSync(dbPath)) throw new Error('database_not_found');
  const memory = new MemoryEngine({ dbPath, readOnly: true });
  try {
    if (options.listScopes) {
      const report = { schemaVersion: 1, mode: 'read_only',
        scopes: listGraphDiagnosticScopes(memory.exportCanonical()) };
      emit(JSON.stringify(report, null, 2));
      return report;
    }
    const report = await runGraphDiagnostics({
      projectId: options.projectId,
      branch: options.branch,
      rootsConfigured: options.roots.length,
      samples: options.samples,
      maxP95Ms: options.maxP95Ms,
      queryGraph: async () => {
        const scope = await resolveMemoryConsoleGitScopeAsync({
          memory, projectId: options.projectId, branch: options.branch,
          repositoryRoots: options.roots,
        });
        const graphMemory = scope.status === 'verified'
          ? await createAsyncGitGraphView(memory, {
            projectId: options.projectId, branch: options.branch, scope,
          })
          : memory;
        const graph = memoryUiGraph(graphMemory, {
          projectId: options.projectId, branch: options.branch,
          revisionSha: scope.revisionSha,
        });
        return { scope, graph };
      },
    });
    emit(JSON.stringify(report, null, 2));
    return report;
  } finally {
    memory.close();
  }
}

async function main() {
  try {
    const report = await executeMemoryGraphDiagnosis({ argv: process.argv.slice(2) });
    if (report.outcome === 'fail') process.exitCode = 1;
    if (report.outcome === 'blocked') process.exitCode = 2;
  } catch (error) {
    // Error text can contain an absolute DB/repository path: never print it.
    const code = error?.message === 'database_not_found'
      ? 'database_not_found' : error instanceof TypeError || error instanceof RangeError
        ? 'invalid_arguments_or_data' : 'diagnostic_runtime_error';
    console.error(JSON.stringify({ schemaVersion: 1, mode: 'read_only', outcome: 'fail', code }));
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) await main();
