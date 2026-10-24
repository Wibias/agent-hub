import { executeP15Activation } from './p15-activation-executor.mjs';
import {
  applyP17LocalActivation,
  readP17ActivationState,
  rollbackP17LocalActivation,
} from './p17-local-runtime-actuator.mjs';

function requireSupabaseStore(store) {
  if (!store || typeof store.consumeActivationGrantNonceP16 !== 'function') {
    throw new TypeError('supabaseStore.consumeActivationGrantNonceP16 must be a function');
  }
  return store;
}

export async function executeP17Activation({
  p13Evidence,
  enrollmentManifest,
  grant,
  supabaseStore,
  statePath,
  probeRuntime,
  now = () => new Date(),
} = {}) {
  const store = requireSupabaseStore(supabaseStore);
  if (typeof probeRuntime !== 'function') {
    throw new TypeError('probeRuntime must be a function');
  }

  return executeP15Activation({
    p13Evidence,
    enrollmentManifest,
    grant,
    now,
    readActivationState: () => readP17ActivationState({ statePath }),
    consumeGrantNonce: (input) => store.consumeActivationGrantNonceP16(input),
    applyActivation: (input) => applyP17LocalActivation(input, { statePath }),
    probeRuntime,
    rollbackActivation: (input) => rollbackP17LocalActivation(input, { statePath }),
  });
}
