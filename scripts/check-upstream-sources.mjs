#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const registryPath = resolve(repoRoot, 'upstream-sources.json');
const offline = process.argv.includes('--offline');

function fail(message, code = 2) {
  console.error(`ERROR ${message}`);
  process.exit(code);
}

function validate(registry) {
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.sources)) {
    fail('invalid upstream-sources.json schema');
  }

  const ids = new Set();
  for (const source of registry.sources) {
    if (!source || typeof source !== 'object') fail('source entry must be an object');
    for (const field of ['id', 'repository', 'reviewedCommit', 'scope']) {
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

if (offline) {
  for (const source of registry.sources) {
    console.log(`RECORDED ${source.id} ${source.reviewedCommit} scope=${source.scope}`);
  }
  process.exit(0);
}

let updates = 0;
for (const source of registry.sources) {
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

  if (head === source.reviewedCommit) {
    console.log(`CURRENT ${source.id} ${source.repository} ${head} scope=${source.scope}`);
  } else {
    updates += 1;
    console.log(
      `UPDATE ${source.id} ${source.repository} reviewed=${source.reviewedCommit} head=${head} scope=${source.scope}`,
    );
  }
}

process.exit(updates === 0 ? 0 : 1);
