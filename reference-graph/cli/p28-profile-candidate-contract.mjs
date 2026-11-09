#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP8OfflineQuickCandidatePool } from '../p8-cutover-review.mjs';
import {
  auditP28ProfileCandidateContract,
  buildP28OfflineProfileCandidatePool,
} from '../p28-profile-candidate-contract.mjs';

function requireDate(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--date'
      || typeof argv[1] !== 'string'
      || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(argv[1])) {
    throw new Error('P28 requires exactly --date YYYY-MM-DD');
  }
  const now = new Date(argv[1] + 'T00:00:00.000Z');
  if (Number.isNaN(now.valueOf()) || now.toISOString().slice(0, 10) !== argv[1]) {
    throw new Error('P28 date is invalid');
  }
  return now;
}

export function runP28ProfileCandidateAuditCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
} = {}) {
  const now = requireDate(argv);
  const records = loadRecords();

  // Both are generated from the same local reviewed/current source. Neither
  // is proof of the deployed P10 snapshot or a live Graph projection.
  const current = buildP8OfflineQuickCandidatePool(records, { now });
  const proposed = buildP28OfflineProfileCandidatePool({ records, now });
  const currentAudit = auditP28ProfileCandidateContract({ candidates: current });
  const proposedAudit = auditP28ProfileCandidateContract({ candidates: proposed });

  const report = {
    schema_version: 'reference-graph.p28-profile-candidate-review.v1',
    reference_date: now.toISOString().slice(0, 10),
    data_source: 'offline-legacy-catalog-projections-only',
    current_p10_equivalent: currentAudit,
    proposed_offline: proposedAudit,
    graph_parity_verified: false,
    repository_default_graph_enabled: false,
    activation_performed: false,
  };
  stdout.write(JSON.stringify(report, null, 2) + '\n');
  return 0;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsMain) {
  try {
    process.exitCode = runP28ProfileCandidateAuditCli();
  } catch {
    // Do not disclose local filesystem paths, records or arbitrary input.
    process.stderr.write('P28 audit failed: invalid input or local read error\n');
    process.exitCode = 1;
  }
}
