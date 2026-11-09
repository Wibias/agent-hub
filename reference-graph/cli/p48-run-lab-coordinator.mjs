#!/usr/bin/env node
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createP47DurableLabRevocation } from '../p47-durable-lab-revocation.mjs';
import { startP48AuthenticatedLabCoordinator } from '../p48-authenticated-lab-coordinator.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const LAB = /^[A-Za-z0-9_-]{12,64}$/;
const KEYS = ['schema_version','scope','directory','public_key_path',
  'public_key_sha256','repository_sha','lab_id'];
const SCOPE = ['mode','profiles','default_off','production_route_wiring'];

function reject() {
  throw new TypeError('P48 lab operator configuration BLOCKED');
}
function exact(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort());
}
function safeFile(file, maxBytes) {
  if (typeof file !== 'string' || !isAbsolute(file) || file.includes('\0')
    || file.length > 4096) reject();
  const resolved = resolve(file);
  try {
    if (realpathSync(resolved) !== resolved) reject();
    const stat = lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()
      || stat.size < 1 || stat.size > maxBytes) reject();
    const bytes = readFileSync(resolved, 'utf8');
    if (Buffer.byteLength(bytes, 'utf8') !== stat.size) reject();
    return bytes;
  } catch { reject(); }
}
function validScope(scope) {
  return exact(scope,SCOPE)
    && scope.mode === 'isolated-shadow-rehearsal'
    && scope.default_off === true
    && scope.production_route_wiring === false
    && Array.isArray(scope.profiles)
    && scope.profiles.length === 2
    && scope.profiles.includes('standard')
    && scope.profiles.includes('deep');
}

/**
 * Parse the locally pinned LAB manifest and an environment-only worker
 * bearer token. No network, authentication state write or activation.
 * Never read or generate an Ed25519 PRIVATE signing key.
 */
export function planP48LabOperator({
  argv = process.argv.slice(2),
  env = process.env,
  read = safeFile,
  clock = () => new Date(),
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 2
    || argv[0] !== '--manifest' || typeof read !== 'function'
    || typeof env?.P48_LAB_READ_TOKEN !== 'string'
    || !TOKEN.test(env.P48_LAB_READ_TOKEN)
    || typeof clock !== 'function') reject();
  let manifest;
  try { manifest = JSON.parse(read(argv[1], 8192)); } catch { reject(); }
  if (!exact(manifest,KEYS)
    || manifest.schema_version !== 'reference-graph.p48-lab-operator-config.v1'
    || !validScope(manifest.scope)
    || typeof manifest.directory !== 'string'
    || !isAbsolute(manifest.directory) || manifest.directory.includes('\0')
    || !SHA256.test(manifest.public_key_sha256)
    || !SHA40.test(manifest.repository_sha)
    || !LAB.test(manifest.lab_id)) reject();

  const publicKeyPem = read(manifest.public_key_path, 8192);
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.includes('BEGIN PUBLIC KEY')) reject();

  return {
    store: createP47DurableLabRevocation({
      directory: manifest.directory, scope: manifest.scope,
      publicKeyPem,
      publicKeySha256: manifest.public_key_sha256,
      expectedRepositorySha: manifest.repository_sha,
      expectedLabId: manifest.lab_id, clock,
    }),
    readBearerToken: env.P48_LAB_READ_TOKEN,
    host: '127.0.0.1',
    port: 0,
  };
}

/** Start a lab server only after an authenticated P47 state preflight. */
export async function runP48LabOperator({
  argv = process.argv.slice(2),
  env = process.env,
  read = safeFile,
  clock = () => new Date(),
  stdout = process.stdout,
} = {}) {
  const input = planP48LabOperator({ argv, env, read, clock });
  input.store.readSignedState(); // a missing/partial journal cannot go live
  const server = await startP48AuthenticatedLabCoordinator(input);
  stdout.write(JSON.stringify({
    schema_version: 'reference-graph.p48-lab-operator-listening.v1',
    endpoint: server.endpoint,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  }) + '\n');
  return server;
}

const isCli = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const server = await runP48LabOperator();
    const shutdown = () => {
      server.close().catch(() => { process.exitCode = 2; });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    // Never include paths, manifest bytes, headers, token or public-key data.
    process.stderr.write('P48 loopback lab coordinator BLOCKED\n');
    process.exitCode = 2;
  }
}
