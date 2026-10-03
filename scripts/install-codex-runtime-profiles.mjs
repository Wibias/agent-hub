#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function retiredCodexRuntimeProfileInstallerStatus() {
  return {
    schemaVersion: 1,
    host: 'codex',
    status: 'retired',
    reason: 'Named Codex profile files are mutable user configuration. Interactive settings such as /model can rewrite the selected profile, so Agent Hub no longer installs runtime policy into profile files.',
    replacement: 'node scripts/run-codex-runtime.mjs <skill> [-- <codex args>]',
    cleanup: 'node scripts/retire-codex-runtime-profiles.mjs [--apply]',
  };
}

export function main({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const status = retiredCodexRuntimeProfileInstallerStatus();

  if (argv.includes('--apply')) {
    stderr.write(
      'install-codex-runtime-profiles: retired; refusing to reinstall mutable Codex profile files.\n'
      + 'Use: ' + status.replacement + '\n'
      + 'To back up and remove legacy Agent Hub profiles: '
      + status.cleanup + '\n',
    );
    process.exitCode = 2;
    return;
  }

  if (argv.length > 0 && !argv.includes('--help')) {
    stderr.write(
      'install-codex-runtime-profiles: retired; unsupported arguments.\n',
    );
    process.exitCode = 2;
    return;
  }

  stdout.write(JSON.stringify(status, null, 2) + '\n');
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
