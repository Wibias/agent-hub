#!/usr/bin/env node
// Disposable Windows SCM CI ONLY. This is not a Codex MCP entrypoint.
import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requestSignedDirectCi, DIRECT_CI_PROJECT,
} from '../memory-engine/adapters/codex-protected-direct-read-ci.mjs';

export async function run({ pinPath, expectedSid, revisionSha } = {}) {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_OS !== 'Windows'
    || !isAbsolute(pinPath ?? ''))
    throw new Error('direct_ci_only');
  // Independent process token identity evidence, never read from MCP input.
  const whoami = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  const actualSid = whoami.match(/S-1-5-21-(?:[0-9]+-){2,}[0-9]+/u)?.[0];
  if (!actualSid || actualSid !== expectedSid)
    throw new Error('direct_ci_actual_windows_sid_mismatch');
  const query = 'knowledge';
  const response = await requestSignedDirectCi({
    pinPath, expectedSid, revisionSha, query, maxItems: 3,
  });
  const fact = 'This knowledge statement is proposed from unverified historical Evidence.';
  if (response.status !== 'found_direct_ci_only'
    || response.project_id !== DIRECT_CI_PROJECT
    || response.principal_sid !== actualSid
    || response.signed_response_verified !== true
    || response.trusted_for_production_recall !== false
    || response.physical_human_approval_verified !== false
    || response.published_to_codex !== false
    || response.items.length !== 1
    || response.items[0].value !== fact
    || response.items[0].historical_evidence_verified !== false)
    throw new Error('direct_ci_signed_service_claim_unexpected');

  // The server must close the connection before signing or leaking
  // another revision. A valid signature is NOT an authorization bypass.
  let wrongRevisionDenied = false;
  try {
    await requestSignedDirectCi({
      pinPath, expectedSid, revisionSha: 'c'.repeat(40),
      query, maxItems: 3, timeoutMs: 1500,
    });
  } catch { wrongRevisionDenied = true; }
  if (!wrongRevisionDenied)
    throw new Error('direct_ci_wrong_revision_exposed_claim');

  let wrongSidDenied = false;
  const parts = expectedSid.split('-');
  parts[parts.length - 1] = String(Number(parts.at(-1)) + 1);
  try {
    await requestSignedDirectCi({
      pinPath, expectedSid: parts.join('-'), revisionSha,
      query, maxItems: 3, timeoutMs: 1500,
    });
  } catch { wrongSidDenied = true; }
  if (!wrongSidDenied)
    throw new Error('direct_ci_wrong_sid_response_accepted');

  return {
    status: 'protected_direct_read_ci_sid_scope_signature_pass',
    claim_count: 1, principal_sid_matches_os: true,
    signed_response_verified: true,
    wrong_revision_denied: true, wrong_sid_denied: true,
    actual_physical_hello_verified: false,
    trusted_for_production_recall: false,
    published_to_codex: false,
    production_no_go: true,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 8 || process.argv[2] !== '--pin'
    || process.argv[4] !== '--sid' || process.argv[6] !== '--revision') {
    process.stderr.write('CI only: --pin ABS_ADMIN_PIN --sid WINDOWS_SID --revision FULL_SHA\n');
    process.exitCode = 2;
  } else {
    try {
      const report = await run({
        pinPath: process.argv[3],
        expectedSid: process.argv[5],
        revisionSha: process.argv[7],
      });
      process.stdout.write(JSON.stringify(report) + '\n');
    } catch (e) {
      process.stderr.write('Direct CI signed read denied: ' + e.message + '\n');
      process.exitCode = 2;
    }
  }
}
