import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runMemoryDoctor } from '../memory-engine/memory-doctor.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--cwd', '--db-path', '--cache-dir', '--codex-home'].includes(arg)) {
      throw new Error('unknown argument: ' + arg);
    }
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(arg + ' requires a path');
    }
    const key = {
      '--cwd': 'cwd',
      '--db-path': 'dbPath',
      '--cache-dir': 'cacheDir',
      '--codex-home': 'codexHome',
    }[arg];
    options[key] = resolve(value);
    index += 1;
  }
  return options;
}

function exitCodeForStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'degraded') return 1;
  return 2;
}

export async function runMemoryDoctorCli({
  argv = process.argv.slice(2),
  log = console.log,
  setExitCode = (value) => { process.exitCode = value; },
  runDoctor = runMemoryDoctor,
} = {}) {
  const options = parseArgs(argv);
  const report = await runDoctor(options);
  log(JSON.stringify(report));
  setExitCode(exitCodeForStatus(report?.status));
  return report;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runMemoryDoctorCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}