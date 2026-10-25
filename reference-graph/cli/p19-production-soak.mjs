#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  P19_P18_EVIDENCE_SHA256,
  P19_PRODUCTION_URL,
  attestP19ActivationConsumption,
  evaluateP19PromotionReadiness,
  sampleP19ProductionHealth,
} from '../p19-production-soak.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';

const P18_EVIDENCE_PATH = 'reference-graph/evidence/p18-production-activation-receipt-evidence.json';

function usageError() {
  return new Error([
    'P19 requires exactly one mode:',
    '--attest-consumption <out.json>',
    '--sample <samples.jsonl>',
    '--evaluate <attestation.json> <samples.jsonl> <out.json>',
  ].join('\n'));
}

function expectArgCount(argv, count) {
  if (argv.length !== count) throw usageError();
}

function jsonLine(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJson(bytes, name) {
  try {
    return JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

function parseSamplesJsonl(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const samples = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      samples.push(JSON.parse(line));
    } catch {
      throw new Error(`P19 samples JSONL line ${index + 1} must contain valid JSON`);
    }
  }
  return samples;
}

function normalizedUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function hasElevatedKey(env) {
  return [env?.SUPABASE_SECRET_KEY, env?.SUPABASE_SERVICE_ROLE_KEY]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
}

async function ensureParent(path, mkdirImpl = mkdir) {
  await mkdirImpl(dirname(path), { recursive: true });
}

async function writePrivateJson(path, value, {
  mkdirImpl = mkdir,
  writeFileImpl = writeFile,
  chmodImpl = chmod,
} = {}) {
  await ensureParent(path, mkdirImpl);
  await writeFileImpl(path, jsonLine(value), { encoding: 'utf8', mode: 0o600 });
  await chmodImpl(path, 0o600);
}

async function appendPrivateJsonLine(path, value, {
  mkdirImpl = mkdir,
  appendFileImpl = appendFile,
  chmodImpl = chmod,
} = {}) {
  await ensureParent(path, mkdirImpl);
  await appendFileImpl(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmodImpl(path, 0o600);
}

function defaultStoreFactory(env) {
  return ReferenceGraphSupabaseStore.fromEnv(env);
}

export function redactP19Error(error, env = process.env) {
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

export async function runP19ProductionSoakCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  appendFileImpl = appendFile,
  mkdirImpl = mkdir,
  chmodImpl = chmod,
  createStore = defaultStoreFactory,
  attest = attestP19ActivationConsumption,
  sampleHealth = sampleP19ProductionHealth,
  evaluate = evaluateP19PromotionReadiness,
  statePath,
} = {}) {
  if (!Array.isArray(argv) || argv.length === 0) throw usageError();
  const [mode, ...args] = argv;

  if (mode === '--attest-consumption') {
    expectArgCount(argv, 2);
    const [outPath] = args;
    if (normalizedUrl(env?.SUPABASE_URL) !== P19_PRODUCTION_URL) {
      throw new Error('P19 attestation requires the exact production Supabase target');
    }
    if (!hasElevatedKey(env)) {
      throw new Error('P19 attestation requires an elevated Supabase key');
    }

    const p18Bytes = await readFileImpl(P18_EVIDENCE_PATH);
    const actualSha256 = createHash('sha256').update(p18Bytes).digest('hex');
    if (actualSha256 !== P19_P18_EVIDENCE_SHA256) {
      throw new Error('P18 production receipt evidence SHA-256 mismatch');
    }
    const p18Evidence = parseJson(p18Bytes, 'P18 production receipt evidence');
    const store = createStore(env);
    const receipt = await attest({ p18Evidence, store });
    await writePrivateJson(outPath, receipt, {
      mkdirImpl,
      writeFileImpl,
      chmodImpl,
    });
    stdout.write(jsonLine(receipt));
    return receipt?.healthy === true ? 0 : 2;
  }

  if (mode === '--sample') {
    expectArgCount(argv, 2);
    const [samplesPath] = args;
    const sample = await sampleHealth({ env, statePath });
    await appendPrivateJsonLine(samplesPath, sample, {
      mkdirImpl,
      appendFileImpl,
      chmodImpl,
    });
    stdout.write(`${JSON.stringify(sample)}\n`);
    return sample?.healthy === true ? 0 : 2;
  }

  if (mode === '--evaluate') {
    expectArgCount(argv, 4);
    const [attestationPath, samplesPath, outPath] = args;
    const attestation = parseJson(
      await readFileImpl(attestationPath),
      'P19 attestation receipt',
    );
    const samples = parseSamplesJsonl(await readFileImpl(samplesPath));
    const receipt = evaluate({ attestation, samples });
    await writePrivateJson(outPath, receipt, {
      mkdirImpl,
      writeFileImpl,
      chmodImpl,
    });
    stdout.write(jsonLine(receipt));
    return 0;
  }

  throw usageError();
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsMain) {
  try {
    process.exitCode = await runP19ProductionSoakCli();
  } catch (error) {
    process.stderr.write(`${redactP19Error(error, process.env)}\n`);
    process.exitCode = 1;
  }
}
