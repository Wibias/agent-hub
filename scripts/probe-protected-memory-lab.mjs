#!/usr/bin/env node
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROTECTED_LAB_PROJECT, PROTECTED_LAB_BRANCH, requestProtectedLabClaims,
} from '../memory-engine/adapters/codex-protected-claim-pipe.mjs';

export async function runProbe({ pinPath, query = 'Synthetic non-authorizing lab fact' } = {}) {
  if (!pinPath || !isAbsolute(pinPath))
    throw new Error('absolute_operator_pinned_public_key_required');
  return requestProtectedLabClaims({
    pinPath, projectId: PROTECTED_LAB_PROJECT,
    branch: PROTECTED_LAB_BRANCH, query,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 4 || process.argv[2] !== '--pin') {
    process.stderr.write('Usage: node scripts/probe-protected-memory-lab.mjs --pin ABSOLUTE_ADMIN_PIN\n');
    process.exitCode = 2;
  } else {
    try {
      const response = await runProbe({ pinPath: process.argv[3] });
      process.stdout.write(JSON.stringify(response) + '\n');
      if (response.status !== 'found_lab_only') process.exitCode = 2;
    } catch {
      // Never fall back to unverified plain SQLite, HTML, or caller-supplied
      // fixture data when pipe, signed envelope, or pinned key fails.
      process.stdout.write(JSON.stringify({
        status: 'protected_lab_read_unverified',
        items: [], read_only: true,
      }) + '\n');
      process.exitCode = 2;
    }
  }
}
