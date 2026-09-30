#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { runCodexMemoryHook } from './codex-hook-runtime.mjs';

async function main() {
  try {
    const raw = await readFile(0, 'utf8');
    const event = JSON.parse(raw);
    const output = await runCodexMemoryHook({ event });
    if (output !== null) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  } catch {
    // Codex command hooks are fail-soft here: exit 0 with no output.
  }
}

await main();
