import { randomUUID as nodeRandomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, posix, win32 } from 'node:path';

const STATE_SCHEMA = 'reference-graph.p17-local-activation-state.v1';
const ACTIVATION_FLAG = 'REFERENCE_GRAPH_QUICK_RUNTIME';
const ACTIVATION_VALUE = 'graph';
const STATE_FILE = 'activation-state-v1.json';
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function canonicalUtc(value) {
  if (!nonEmpty(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function validState(value) {
  if (!exactKeys(value, [
    'schema',
    'mode',
    'change_id',
    'consumption_id',
    'grant_payload_hash',
    'updated_at',
  ])) return false;

  if (value.schema !== STATE_SCHEMA) return false;
  if (!['legacy', 'graph'].includes(value.mode)) return false;
  if (typeof value.change_id !== 'string' || !UUID.test(value.change_id)) return false;
  if (!canonicalUtc(value.updated_at)) return false;

  if (value.mode === 'graph') {
    return nonEmpty(value.consumption_id)
      && typeof value.grant_payload_hash === 'string'
      && HEX64.test(value.grant_payload_hash);
  }

  return value.consumption_id === null && value.grant_payload_hash === null;
}

function requireHex64(value, name) {
  if (typeof value !== 'string' || !HEX64.test(value)) {
    throw new TypeError(`${name} must be a 64-character lowercase hex string`);
  }
  return value;
}

function requireNonEmpty(value, name) {
  if (!nonEmpty(value)) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function requireActivationFlag(value) {
  if (value !== ACTIVATION_FLAG) {
    throw new TypeError(`activation flag must be ${ACTIVATION_FLAG}`);
  }
}

function requireActivationValue(value) {
  if (value !== ACTIVATION_VALUE) {
    throw new TypeError(`activation value must be ${ACTIVATION_VALUE}`);
  }
}

function requireNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError('now must return a valid Date');
  }
  return value.toISOString();
}

function pathApi(platform) {
  return platform === 'win32' ? win32 : posix;
}

export function defaultP17ActivationStatePath({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
} = {}) {
  if (nonEmpty(env.AGENT_HUB_REFERENCE_GRAPH_STATE)) {
    return env.AGENT_HUB_REFERENCE_GRAPH_STATE.trim();
  }

  const path = pathApi(platform);
  if (platform === 'win32') {
    const localAppData = nonEmpty(env.LOCALAPPDATA)
      ? env.LOCALAPPDATA.trim()
      : win32.join(homeDir, 'AppData', 'Local');
    return win32.join(
      localAppData,
      'agent-hub',
      'reference-graph',
      STATE_FILE,
    );
  }

  const stateHome = nonEmpty(env.XDG_STATE_HOME)
    ? env.XDG_STATE_HOME.trim()
    : posix.join(homeDir, '.local', 'state');
  return path.join(stateHome, 'agent-hub', 'reference-graph', STATE_FILE);
}

export async function readP17RawState({
  statePath = defaultP17ActivationStatePath(),
} = {}) {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8'));
    return validState(value) ? value : null;
  } catch {
    return null;
  }
}

export async function readP17ActivationState(options = {}) {
  const state = await readP17RawState(options);
  if (state?.mode === 'graph') {
    return {
      production_source: 'reference-graph',
      quick_graph_enabled: true,
      repository_default_graph_enabled: false,
    };
  }
  return {
    production_source: 'legacy-control',
    quick_graph_enabled: false,
    repository_default_graph_enabled: false,
  };
}

async function atomicWriteState(statePath, state, tempSuffix) {
  const parent = dirname(statePath);
  await mkdir(parent, { recursive: true });
  const tempPath = `${statePath}.tmp-${tempSuffix}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(tempPath, statePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function applyP17LocalActivation(input = {}, {
  statePath = defaultP17ActivationStatePath(),
  now = () => new Date(),
  randomUUID = nodeRandomUUID,
} = {}) {
  requireActivationFlag(input.activation_flag);
  requireActivationValue(input.activation_value);
  const grantPayloadHash = requireHex64(
    input.grant_payload_hash,
    'grant_payload_hash',
  );
  const consumptionId = requireNonEmpty(input.consumption_id, 'consumption_id');
  const changeId = requireNonEmpty(randomUUID(), 'randomUUID result');
  if (!UUID.test(changeId)) throw new TypeError('randomUUID must return a UUID');

  const state = {
    schema: STATE_SCHEMA,
    mode: 'graph',
    change_id: changeId,
    consumption_id: consumptionId,
    grant_payload_hash: grantPayloadHash,
    updated_at: requireNow(now),
  };

  await atomicWriteState(statePath, state, nodeRandomUUID());
  return { applied: true, change_id: changeId };
}

export async function rollbackP17LocalActivation(input = {}, {
  statePath = defaultP17ActivationStatePath(),
  now = () => new Date(),
  randomUUID = nodeRandomUUID,
} = {}) {
  requireActivationFlag(input.activation_flag);
  const current = await readP17RawState({ statePath });
  if (current?.mode !== 'graph') {
    throw new Error('P17 graph activation state is unavailable for rollback');
  }
  if (input.activation_change_id !== current.change_id) {
    throw new Error('P17 rollback activation change id does not match current state');
  }
  if (input.consumption_id !== current.consumption_id) {
    throw new Error('P17 rollback consumption id does not match current state');
  }
  if (input.grant_payload_hash !== current.grant_payload_hash) {
    throw new Error('P17 rollback grant payload hash does not match current state');
  }

  const changeId = requireNonEmpty(randomUUID(), 'randomUUID result');
  if (!UUID.test(changeId)) throw new TypeError('randomUUID must return a UUID');
  const state = {
    schema: STATE_SCHEMA,
    mode: 'legacy',
    change_id: changeId,
    consumption_id: null,
    grant_payload_hash: null,
    updated_at: requireNow(now),
  };

  await atomicWriteState(statePath, state, nodeRandomUUID());
  return { rolled_back: true, change_id: changeId };
}
