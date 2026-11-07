#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { verifyP26FrozenEvidence } from '../p26-evidence-verifier.mjs';

export async function runP26FrozenEvidenceVerificationCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 2) {
    throw new Error('P26 requires <archive-directory> <independent-manifest-sha256>');
  }
  const [archiveDir, expectedManifestSha256] = argv;
  const summary = await verifyP26FrozenEvidence({ archiveDir, expectedManifestSha256 });
  stdout.write(JSON.stringify(summary, null, 2) + '\n');
  return 0;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsMain) {
  try {
    process.exitCode = await runP26FrozenEvidenceVerificationCli();
  } catch (error) {
    // CLI never prints private archive paths, sample contents, or JSON values.
    const reason = error instanceof Error && error.message.startsWith('P26 ')
      && !/[\\/]|[{}]/.test(error.message)
      ? error.message
      : 'P26 input could not be verified';
    process.stderr.write(`P26 verification failed: ${reason}\n`);
    process.exitCode = 1;
  }
}
