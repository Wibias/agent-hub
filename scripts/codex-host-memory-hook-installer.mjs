import {
  installCodexCombinedMemoryHooks,
} from './install-codex-combined-memory-hooks.mjs';
import {
  planCodexPassiveMemoryHooks,
} from './install-codex-passive-memory-hooks.mjs';

export function createCodexHostMemoryHookInstaller({
  planCoreHooks,
  planPassiveHooks = planCodexPassiveMemoryHooks,
} = {}) {
  if (typeof planCoreHooks !== 'function') {
    throw new TypeError('planCoreHooks must be a function');
  }
  if (typeof planPassiveHooks !== 'function') {
    throw new TypeError('planPassiveHooks must be a function');
  }

  return function installCodexHostMemoryHooks(options = {}) {
    return installCodexCombinedMemoryHooks({
      ...options,
      planCoreHooks,
      planPassiveHooks,
    });
  };
}
