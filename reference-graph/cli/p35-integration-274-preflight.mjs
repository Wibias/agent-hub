#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateP35IntegrationPreflight } from '../p35-integration-preflight.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOCK_RELATIVE = 'reference-graph/p35-integration-274-lock.json';
const SHA256 = /^[a-f0-9]{64}$/;

function requireArgs(argv) {
  const values = { root: DEFAULT_ROOT, evidence: null, sha256: null, asOf: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (typeof value !== 'string' || !value) {
      throw new Error('P35 integration preflight argument missing');
    }
    if (flag === '--root') values.root = resolve(value);
    else if (flag === '--evidence') values.evidence = value;
    else if (flag === '--sha256') values.sha256 = value;
    else if (flag === '--as-of') values.asOf = value;
    else throw new Error('P35 integration preflight argument invalid');
  }
  if ((values.evidence === null) !== (values.sha256 === null)
    || (values.evidence === null) !== (values.asOf === null)
    || (values.sha256 !== null && !SHA256.test(values.sha256))) {
    throw new Error('P35 integration preflight requires all evidence arguments');
  }
  return values;
}

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
}

function gitText(root, args) {
  const result = git(root, args);
  return { status: result.status, stdout: (result.stdout ?? Buffer.alloc(0)).toString('utf8') };
}

function collectRepository(root, lock) {
  const head = gitText(root, ['rev-parse', 'HEAD']);
  if (head.status !== 0) throw new Error('P35 integration preflight requires a git checkout');
  const headSha = head.stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('P35 integration preflight head invalid');

  const reviewedHeadPresent = git(root, ['cat-file', '-e', lock.reviewed_head_sha + '^{commit}']).status === 0;
  let reviewedHeadIsAncestor = null;
  let postPinChangedPaths = null;
  if (reviewedHeadPresent) {
    reviewedHeadIsAncestor = git(root, ['merge-base', '--is-ancestor', lock.reviewed_head_sha, 'HEAD']).status === 0;
    const diff = gitText(root, ['diff', '--name-only', lock.reviewed_head_sha + '..HEAD']);
    if (diff.status !== 0) throw new Error('P35 integration preflight diff failed');
    postPinChangedPaths = diff.stdout.split('\n').map(line => line.trim()).filter(Boolean);
  }

  // Hash committed blobs, not working-tree bytes: the checkout may apply
  // autocrlf or filters, while the pin was computed over repository content.
  const blobHash = path => {
    const blob = git(root, ['cat-file', 'blob', 'HEAD:' + path]);
    if (blob.status !== 0) throw new Error('P35 integration preflight blob unavailable');
    return createHash('sha256').update(blob.stdout).digest('hex');
  };

  const fileHashes = lock.reviewed_files.map(entry => ({
    path: entry.path,
    sha256: blobHash(entry.path),
  }));

  const historicalLockSha256 = blobHash(lock.historical_p35_lock.path);
  return {
    headSha,
    reviewedHeadPresent,
    reviewedHeadIsAncestor,
    postPinChangedPaths,
    historicalLockSha256,
    fileHashes,
  };
}

/**
 * Strictly offline verifier of the consolidated integration head. It reads the
 * lock and working tree, and optionally a separately collected GitHub snapshot.
 * No network, no writes, no credentials. Exit 2 always: this gate has no
 * deploy- or merge-authorizing terminal state.
 */
export function runP35Integration274PreflightCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  root = DEFAULT_ROOT,
} = {}) {
  const args = requireArgs(argv);
  const checkout = resolve(args.root ?? root);
  const lock = JSON.parse(readFileSync(join(checkout, LOCK_RELATIVE), 'utf8'));

  let evidence = null;
  if (args.evidence !== null) {
    const bytes = readFileSync(args.evidence);
    if (bytes.byteLength === 0 || bytes.byteLength > 500_000
      || createHash('sha256').update(bytes).digest('hex') !== args.sha256) {
      throw new Error('P35 integration evidence pin invalid');
    }
    evidence = JSON.parse(bytes.toString('utf8'));
  }

  const report = evaluateP35IntegrationPreflight({
    lock,
    repository: collectRepository(checkout, lock),
    evidence,
    asOf: args.asOf,
  });
  stdout.write(JSON.stringify(report, null, 2) + '\n');
  return 2;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsMain) {
  try {
    process.exitCode = runP35Integration274PreflightCli();
  } catch {
    // Never echo local paths, credentials or raw error details.
    process.stderr.write('P35 integration preflight failed: invalid, stale or mismatched input\n');
    process.exitCode = 1;
  }
}
