import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRecallCase } from './adapter-contract.mjs';
import {
  redactSyntheticSecret,
  SYNTHETIC_SECRET,
} from './runner.mjs';

async function defaultRootFactory(caseId) {
  return mkdtemp(join(tmpdir(), `memory-ratchet-${caseId.toLowerCase()}-`));
}

function serialisableError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  return {
    name: 'Error',
    message: String(error),
    stack: null,
  };
}

function containsSyntheticSecret(value) {
  return JSON.stringify(value ?? null).includes(SYNTHETIC_SECRET);
}

export async function runCoreTrack({
  adapterFactory,
  caseIds,
  rootFactory = defaultRootFactory,
  runCase = runRecallCase,
}) {
  if (typeof adapterFactory !== 'function') {
    throw new TypeError('adapterFactory must be a function');
  }
  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    throw new TypeError('caseIds must be a non-empty array');
  }

  const cases = [];
  let metadata = null;

  for (const caseId of caseIds) {
    const adapter = adapterFactory();
    metadata ??= adapter.metadata;
    const root = await rootFactory(caseId);

    try {
      const run = await runCase(adapter, caseId, root);
      const secretLeaked = containsSyntheticSecret(run);
      cases.push({
        case_id: caseId,
        status: 'completed',
        secret_leaked: secretLeaked,
        run: redactSyntheticSecret(run),
      });
    } catch (error) {
      const rawError = serialisableError(error);
      const secretLeaked = containsSyntheticSecret(rawError);
      cases.push({
        case_id: caseId,
        status: 'error',
        secret_leaked: secretLeaked,
        error: redactSyntheticSecret(rawError),
      });
    }
  }

  return {
    candidate: metadata?.candidate ?? null,
    adapter_revision: metadata?.adapter_revision ?? null,
    network_required: metadata?.network_required ?? null,
    cases,
  };
}
