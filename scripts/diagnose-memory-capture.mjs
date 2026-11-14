#!/usr/bin/env node
/** Read-only capture funnel summary without Claim/Evidence contents. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMemoryCapture } from '../memory-engine/memory-capture-diagnostics.mjs';

export function parseCaptureDiagnosticArgs(argv = []) {
  const options = {};
  const flags = new Map([
    ['--db-path', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--branch', 'branch'],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const key = flags.get(name);
    const value = argv[index + 1];
    if (!key || Object.hasOwn(options, key) || typeof value !== 'string' || !value.trim()) {
      throw new Error('expected --db-path PATH --project-id ID --branch BRANCH (once each)');
    }
    options[key] = key === 'dbPath' ? resolve(value) : value.trim();
  }
  if (Object.keys(options).length !== flags.size) {
    throw new Error('expected --db-path PATH --project-id ID --branch BRANCH');
  }
  return options;
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  try {
    console.log(JSON.stringify(inspectMemoryCapture(parseCaptureDiagnosticArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    // No SQL errors or stored content are printed. The caller only needs failure status.
    console.error('Memory capture diagnostic unavailable: check database, scope and schema.');
    process.exitCode = 1;
  }
}
