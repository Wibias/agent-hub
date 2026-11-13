#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveApprovedWriteScope } from '../memory-engine/adapters/codex-approved-memory-write.mjs';
import {
  inspectProjectMemoryPublication, changeProjectMemoryPublication,
} from '../memory-engine/adapters/project-wide-user-memory.mjs';

function parseArgs(args) {
  if (args.length !== 5 || args[0] !== '--cwd' || args[2] !== '--claim-id'
    || !['--publish', '--revoke', '--inspect'].includes(args[4])) {
    throw new Error('Usage: --cwd ABSOLUTE_PROJECT_ROOT --claim-id EXACT_CLAIM_ID --inspect|--publish|--revoke');
  }
  return { cwd: args[1], claimId: args[3], action: args[4].slice(2) };
}

export async function main({
  argv = process.argv.slice(2), input = process.stdin, output = process.stdout,
} = {}) {
  try {
    const { cwd, claimId, action } = parseArgs(argv);
    const scope = resolveApprovedWriteScope({ cwd });
    const before = inspectProjectMemoryPublication({
      dbPath: scope.dbPath, projectId: scope.projectId, claimId,
    });
    output.write(JSON.stringify(before, null, 2) + '\n');
    if (action === 'inspect') return;
    if (!input.isTTY || !output.isTTY) throw new Error('interactive_operator_tty_required');
    const terminal = createInterface({ input, output });
    try {
      const expected = action === 'publish' ? 'PUBLISH PROJECT-WIDE' : 'REVOKE PROJECT-WIDE';
      const entered = await terminal.question('Type ' + expected + ' to authorize this exact Claim: ');
      if (entered !== expected) throw new Error('operator_confirmation_denied');
      const result = changeProjectMemoryPublication({
        dbPath: scope.dbPath, projectId: scope.projectId, claimId,
        operation: action, confirmed: true,
      });
      output.write(JSON.stringify(result, null, 2) + '\n');
    } finally {
      terminal.close();
    }
  } catch (error) {
    process.stderr.write('PROJECT_MEMORY_PUBLICATION_DENIED: ' + error.message + '\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
