#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  P13_EVIDENCE_SHA256,
  createP14EnrollmentManifest,
} from '../p14-authority-enrollment-grant.mjs';
import { executeP17Activation } from '../p17-activation-runner.mjs';
import { readP17ActivationState } from '../p17-local-runtime-actuator.mjs';
import {
  assembleAndVerifyP18Grant,
  createP18AuthorityDescriptor,
  createP18GrantArtifacts,
  hashP18AuthorityDescriptor,
  preflightP18ProductionActivation,
} from '../p18-production-ceremony.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';

const P13_EVIDENCE_PATH = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';
const CONFIRMATION_TOKEN = 'ACTIVATE-QUICK-REFERENCE-GRAPH';
const RECEIPT_KEYS = Object.freeze([
  'status',
  'grant_verified',
  'activation_authorized',
  'grant_consumed',
  'activation_performed',
  'rollback_performed',
  'rollback_verified',
  'production_source',
  'retry_requires_new_grant',
  'request_hash',
  'authority_hash',
  'grant_payload_hash',
  'blocker',
]);

function usageError() {
  return new Error([
    'P18 requires exactly one mode:',
    '--authority-descriptor <public-spki.der> <authority-id> <key-id> <out.json>',
    '--authority-hash <authority.json>',
    '--prepare-grant <authority.json> <approved-sha256-file> <payload.json> <canonical.json>',
    '--assemble-grant <authority.json> <approved-sha256-file> <payload.json> <signature.bin> <grant.json>',
    '--preflight <authority.json> <approved-sha256-file> <grant.json>',
    `--activate-production <authority.json> <approved-sha256-file> <grant.json> ${CONFIRMATION_TOKEN}`,
    '--status',
  ].join('\n'));
}

function expectArgs(argv, count) {
  if (argv.length !== count) throw usageError();
}

function parseJson(bytes, name) {
  try {
    return JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

function parseApproval(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes.toString('utf8').trim() : String(bytes).trim();
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('approved authority SHA-256 file must contain exactly one lowercase 64-character digest');
  }
  return value;
}

function jsonLine(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readP13Evidence(readFileImpl) {
  return parseJson(await readFileImpl(P13_EVIDENCE_PATH), 'P13 evidence');
}

async function readCeremonyInputs({ readFileImpl, authorityPath, approvalPath, grantPath = null }) {
  const authority = parseJson(await readFileImpl(authorityPath), 'authority descriptor');
  const approvedAuthoritySha256 = parseApproval(await readFileImpl(approvalPath));
  const grant = grantPath
    ? parseJson(await readFileImpl(grantPath), 'signed grant')
    : null;
  return { authority, approvedAuthoritySha256, grant };
}

function sanitizeActivationReceipt(result) {
  const receipt = {};
  for (const key of RECEIPT_KEYS) receipt[key] = result?.[key] ?? null;
  return receipt;
}

function defaultStoreFactory(env) {
  return ReferenceGraphSupabaseStore.fromEnv(env);
}

function redactError(error, env) {
  let text = error instanceof Error ? error.message : String(error);
  for (const name of [
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
  ]) {
    const value = typeof env?.[name] === 'string' ? env[name] : '';
    if (value) text = text.split(value).join('[redacted]');
  }
  return text;
}

export async function runP18ProductionActivationCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  statePath,
  now = () => new Date(),
  nonce = () => undefined,
  preflight = preflightP18ProductionActivation,
  createStore = defaultStoreFactory,
  executeActivation = executeP17Activation,
} = {}) {
  if (!Array.isArray(argv) || argv.length === 0) throw usageError();
  const [mode, ...args] = argv;

  if (mode === '--status') {
    expectArgs(argv, 1);
    stdout.write(jsonLine(await readP17ActivationState({ statePath })));
    return 0;
  }

  if (mode === '--authority-descriptor') {
    expectArgs(argv, 5);
    const [publicKeyPath, authorityId, keyId, outPath] = args;
    const descriptor = createP18AuthorityDescriptor({
      publicKeySpkiDer: await readFileImpl(publicKeyPath),
      authorityId,
      keyId,
    });
    await writeFileImpl(outPath, jsonLine(descriptor), { encoding: 'utf8', mode: 0o600 });
    stdout.write(`${hashP18AuthorityDescriptor(descriptor)}\n`);
    return 0;
  }

  if (mode === '--authority-hash') {
    expectArgs(argv, 2);
    const authority = parseJson(await readFileImpl(args[0]), 'authority descriptor');
    stdout.write(`${hashP18AuthorityDescriptor(authority)}\n`);
    return 0;
  }

  if (mode === '--prepare-grant') {
    expectArgs(argv, 5);
    const [authorityPath, approvalPath, payloadPath, canonicalPath] = args;
    const p13Evidence = await readP13Evidence(readFileImpl);
    const { authority, approvedAuthoritySha256 } = await readCeremonyInputs({
      readFileImpl,
      authorityPath,
      approvalPath,
    });
    const artifacts = createP18GrantArtifacts({
      p13Evidence,
      authority,
      approvedAuthoritySha256,
      now: now(),
      nonce: nonce(),
    });
    await writeFileImpl(payloadPath, jsonLine(artifacts.grant_payload), { encoding: 'utf8', mode: 0o600 });
    await writeFileImpl(canonicalPath, artifacts.canonical_payload_utf8, { encoding: 'utf8', mode: 0o600 });
    stdout.write(`${artifacts.payload_sha256}\n`);
    return 0;
  }

  if (mode === '--assemble-grant') {
    expectArgs(argv, 6);
    const [authorityPath, approvalPath, payloadPath, signaturePath, grantPath] = args;
    const p13Evidence = await readP13Evidence(readFileImpl);
    const { authority, approvedAuthoritySha256 } = await readCeremonyInputs({
      readFileImpl,
      authorityPath,
      approvalPath,
    });
    const grantPayload = parseJson(await readFileImpl(payloadPath), 'grant payload');
    const signature = await readFileImpl(signaturePath);
    const assembled = assembleAndVerifyP18Grant({
      p13Evidence,
      authority,
      approvedAuthoritySha256,
      grantPayload,
      signature,
      now: now(),
    });
    await writeFileImpl(grantPath, jsonLine(assembled.grant), { encoding: 'utf8', mode: 0o600 });
    stdout.write(jsonLine({
      grant_verified: assembled.verification.grantVerified,
      activation_authorized: assembled.verification.activationAuthorized,
      activation_performed: assembled.verification.activationPerformed,
    }));
    return 0;
  }

  if (mode === '--preflight') {
    expectArgs(argv, 4);
    const [authorityPath, approvalPath, grantPath] = args;
    const p13Evidence = await readP13Evidence(readFileImpl);
    const { authority, approvedAuthoritySha256, grant } = await readCeremonyInputs({
      readFileImpl,
      authorityPath,
      approvalPath,
      grantPath,
    });
    const result = await preflight({
      p13Evidence,
      authority,
      approvedAuthoritySha256,
      grant,
      env,
      statePath,
      now: now(),
    });
    stdout.write(jsonLine(result));
    return 0;
  }

  if (mode === '--activate-production') {
    expectArgs(argv, 5);
    const [authorityPath, approvalPath, grantPath, confirmation] = args;
    if (confirmation !== CONFIRMATION_TOKEN) {
      throw new Error(`production activation requires exact confirmation token ${CONFIRMATION_TOKEN}`);
    }
    const p13Evidence = await readP13Evidence(readFileImpl);
    const { authority, approvedAuthoritySha256, grant } = await readCeremonyInputs({
      readFileImpl,
      authorityPath,
      approvalPath,
      grantPath,
    });
    const current = now();
    const preflightResult = await preflight({
      p13Evidence,
      authority,
      approvedAuthoritySha256,
      grant,
      env,
      statePath,
      now: current,
    });
    if (preflightResult?.preflight_ready !== true) {
      throw new Error('P18 production preflight did not return ready');
    }
    const enrollmentManifest = createP14EnrollmentManifest({
      p13Evidence,
      p13EvidenceSha256: P13_EVIDENCE_SHA256,
      authority,
      approvedAuthoritySha256,
    });
    const supabaseStore = createStore(env);
    const result = await executeActivation({
      p13Evidence,
      enrollmentManifest,
      grant,
      supabaseStore,
      statePath,
      runtimeEnv: env,
      now,
    });
    stdout.write(jsonLine(sanitizeActivationReceipt(result)));
    return 0;
  }

  throw usageError();
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsMain) {
  try {
    process.exitCode = await runP18ProductionActivationCli();
  } catch (error) {
    process.stderr.write(`${redactError(error, process.env)}\n`);
    process.exitCode = 1;
  }
}
