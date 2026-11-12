#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareApprovedMemoryWrite } from '../memory-engine/adapters/codex-approved-memory-write.mjs';

function args(argv) {
  if (argv.length !== 2 || argv[0] !== '--cwd') throw new Error('Usage: node scripts/prepare-codex-approved-memory-write.mjs --cwd ABSOLUTE_REPO_ROOT');
  return { cwd: argv[1] };
}

export async function main({
  argv = process.argv.slice(2), input = process.stdin, output = process.stdout,
} = {}) {
  try {
    const options = args(argv);
    if (!input.isTTY || !output.isTTY) throw new Error('interactive_operator_tty_required');
    const terminal = createInterface({ input, output });
    try {
      const text = await terminal.question('Exact memory fact to save (max 1200 chars): ');
      if (!text.trim() || text.length > 1200) throw new Error('memory_text_length_invalid');
      output.write('\nOnly this text will be prepared for a single memory commit. Project: ' + options.cwd + '\n');
      const confirmation = await terminal.question('Type APPROVE ONE WRITE to confirm: ');
      if (confirmation !== 'APPROVE ONE WRITE') throw new Error('operator_confirmation_denied');
      const result = prepareApprovedMemoryWrite({ cwd: options.cwd, text, confirmed: true });
      output.write(JSON.stringify(result, null, 2) + '\n');
    } finally {
      terminal.close();
    }
  } catch (error) {
    process.stderr.write('MEMORY_WRITE_PREPARE_DENIED: ' + error.message + '\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
