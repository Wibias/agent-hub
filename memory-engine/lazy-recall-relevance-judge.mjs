export function createLazyRecallRelevanceJudge({
  enabled = false,
  createRuntime,
  runtimeOptions = {},
} = {}) {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('enabled must be a boolean');
  }
  if (typeof createRuntime !== 'function') {
    throw new TypeError('createRuntime must be a function');
  }
  if (!runtimeOptions || typeof runtimeOptions !== 'object' || Array.isArray(runtimeOptions)) {
    throw new TypeError('runtimeOptions must be an object');
  }

  let runtime = null;
  let runtimePromise = null;

  async function ensureRuntime() {
    if (runtime) return runtime;
    if (runtimePromise === null) {
      runtimePromise = Promise.resolve(createRuntime(runtimeOptions)).then((created) => {
        if (!created || typeof created.judge !== 'function') {
          throw new TypeError('created recall relevance runtime must expose judge()');
        }
        runtime = created;
        return created;
      });
    }
    return runtimePromise;
  }

  const judge = enabled
    ? async (args) => {
        const active = await ensureRuntime();
        return active.judge(args);
      }
    : null;

  return {
    judge,
    evaluatorId() {
      return runtime?.evaluatorId ?? null;
    },
    async close() {
      let active = runtime;
      if (!active && runtimePromise !== null) {
        try { active = await runtimePromise; } catch { active = null; }
      }
      if (active && typeof active.close === 'function') {
        await active.close();
      }
      runtime = null;
      runtimePromise = null;
    },
  };
}
