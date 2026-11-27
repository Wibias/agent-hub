#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { directoryScopeFor, hasScopedChanges } from './lib/upstream-scope-diff.mjs';
import { classifyUpstreamStatus, needsUpstreamAction, validateUpstreamIntegration } from './lib/upstream-status.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const registryPath = resolve(repoRoot, 'upstream-sources.json');
const offline = process.argv.includes('--offline');
const decisions = new Set(['current', 'not-applicable', 'separate-pr', 'update-pending']);

function fail(message, code = 2) {
  console.error(`ERROR ${message}`);
  process.exit(code);
}

function validate(registry) {
  if (registry?.schemaVersion !== 2 || !Array.isArray(registry.sources)) {
    fail('invalid upstream-sources.json schema');
  }

  const ids = new Set();
  for (const source of registry.sources) {
    if (!source || typeof source !== 'object') fail('source entry must be an object');
    for (const field of ['id', 'repository', 'reviewedCommit', 'scope', 'decision']) {
      if (typeof source[field] !== 'string' || source[field].trim() === '') {
        fail(`${source.id ?? '<unknown>'}: missing ${field}`);
      }
    }
    if (ids.has(source.id)) fail(`duplicate source id ${source.id}`);
    ids.add(source.id);
    if (!/^[0-9a-f]{40}$/.test(source.reviewedCommit)) {
      fail(`${source.id}: reviewedCommit must be a full 40-character SHA`);
    }
    if (!/^[^/\s]+\/[^/\s]+$/.test(source.repository)) {
      fail(`${source.id}: repository must be owner/name`);
    }
    if (!decisions.has(source.decision)) fail(`${source.id}: unsupported decision ${source.decision}`);
    if (source.localPin != null && !/^[0-9a-f]{40}$/.test(source.localPin)) {
      fail(`${source.id}: localPin must be a full 40-character SHA`);
    }
    if (source.decision === 'update-pending' && !source.localPin) {
      fail(`${source.id}: update-pending requires localPin`);
    }
    try {
      validateUpstreamIntegration(source);
    } catch (error) {
      fail(`${source.id}: ${error.message}`);
    }
  }
  // Reference-only research sources are monitored for drift, but never
  // installed, promoted to canonical skill owners, or used to authorize
  // executable imports. Keep the original five-source registry intact.
  if (registry.referenceSources != null && !Array.isArray(registry.referenceSources)) {
    fail('referenceSources must be an array when present');
  }
  const repositories = new Set(registry.sources.map(source => source.repository.toLowerCase()));
  for (const source of registry.referenceSources ?? []) {
    if (!source || typeof source !== 'object') fail('reference source must be an object');
    for (const field of ['id', 'repository', 'reviewedCommit', 'scope', 'decision', 'reviewedAt']) {
      if (typeof source[field] !== 'string' || source[field].trim() === '') {
        fail(`reference ${source.id ?? '<unknown>'}: missing ${field}`);
      }
    }
    if (ids.has(source.id)) fail(`duplicate source id ${source.id}`);
    ids.add(source.id);
    if (!/^[0-9a-f]{40}$/.test(source.reviewedCommit)) {
      fail(`reference ${source.id}: reviewedCommit must be a full 40-character SHA`);
    }
    if (!/^[^/\s]+\/[^/\s]+$/.test(source.repository)) {
      fail(`reference ${source.id}: repository must be owner/name`);
    }
    if (repositories.has(source.repository.toLowerCase())) {
      fail(`reference ${source.id}: duplicate monitored repository`);
    }
    repositories.add(source.repository.toLowerCase());
    if (!['current', 'not-applicable'].includes(source.decision)) {
      fail(`reference ${source.id}: reference-only decision must be current or not-applicable`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.reviewedAt)) {
      fail(`reference ${source.id}: reviewedAt must use YYYY-MM-DD`);
    }
    if (source.localPin != null || source.integrationOwner != null) {
      fail(`reference ${source.id}: references cannot claim local pins or skill ownership`);
    }
  }
  return registry;
}

let registry;
try {
  registry = validate(JSON.parse(readFileSync(registryPath, 'utf8')));
} catch (error) {
  if (error?.code === 'ENOENT') fail('upstream-sources.json not found');
  if (error instanceof SyntaxError) fail(`invalid JSON: ${error.message}`);
  throw error;
}

function adoptionStatus(source) {
  if (source.decision === 'update-pending') {
    return `PENDING ${source.id} reviewed=${source.reviewedCommit} local=${source.localPin} scope=${source.scope}`;
  }
  return `RECORDED ${source.id} ${source.reviewedCommit} decision=${source.decision} scope=${source.scope}`;
}

if (offline) {
  for (const source of registry.sources) console.log(adoptionStatus(source));
  for (const source of registry.referenceSources ?? []) {
    console.log(`REFERENCE_RECORDED ${source.id} ${source.reviewedCommit} decision=${source.decision} scope=${source.scope}`);
  }
  process.exit(0);
}

let findings = 0;
const watched = [
  ...registry.sources.map(source => ({ source, referenceOnly: false })),
  ...(registry.referenceSources ?? []).map(source => ({ source, referenceOnly: true })),
];
for (const { source, referenceOnly } of watched) {
  const remote = `https://github.com/${source.repository}.git`;
  const result = spawnSync('git', ['ls-remote', remote, 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) fail(`${source.id}: git ls-remote failed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${source.id}: git ls-remote exited ${result.status}: ${result.stderr.trim()}`);
  }

  const head = result.stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(head)) fail(`${source.id}: could not parse remote HEAD`);

  const advanced = head !== source.reviewedCommit;
  const scopedDirectory = directoryScopeFor(source);
  let scopedChanges = null;
  if (advanced && scopedDirectory) {
    try {
      scopedChanges = hasScopedChanges({
        remote,
        reviewedCommit: source.reviewedCommit,
        head,
        scope: scopedDirectory,
      });
    } catch (error) {
      fail(`${source.id}: scoped update check failed: ${error.message}`);
    }
  }

  const status = classifyUpstreamStatus({
    advanced,
    scopedChanges,
    decision: source.decision,
  });
  const evidence = scopedChanges === null ? (advanced ? 'unscoped' : 'same-head') :
    scopedChanges ? 'scope-changed' : 'scope-unchanged';
  const owner = source.integrationOwner ? ` owner=${source.integrationOwner}` : '';
  const details = `${source.id} ${source.repository} reviewed=${source.reviewedCommit} head=${head} scope=${source.scope} evidence=${evidence} adoption=${source.decision}${owner}`;
  const local = source.localPin ? ` local=${source.localPin}` : '';

  // SCOPE_CHANGED requires relevance review. REVIEW means the prose-only scope
  // is not machine-comparable. Neither status claims adoption is necessary.
  const label = referenceOnly ? `REFERENCE_${status}` : status;
  console.log(`${label} ${details}${local}`);
  if (needsUpstreamAction(status)) findings += 1;
}

process.exit(findings === 0 ? 0 : 1);
