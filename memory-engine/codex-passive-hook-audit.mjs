function eventHooks(hooks, eventName) {
  const eventMap = (
    hooks
    && typeof hooks === 'object'
    && !Array.isArray(hooks)
    && hooks.hooks
    && typeof hooks.hooks === 'object'
    && !Array.isArray(hooks.hooks)
  ) ? hooks.hooks : hooks;

  if (!eventMap || typeof eventMap !== 'object' || Array.isArray(eventMap)) {
    return [];
  }
  const entries = eventMap[eventName];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => (
    entry && typeof entry === 'object' && Array.isArray(entry.hooks)
      ? entry.hooks.filter((hook) => hook && typeof hook === 'object')
      : []
  ));
}

function commandText(hook) {
  return [hook?.command ?? '', hook?.commandWindows ?? ''].join('\n');
}

function passiveHooks(hooks, eventName) {
  return eventHooks(hooks, eventName).filter((hook) => (
    /memory-engine[\\/]adapters[\\/]codex-passive-memory-hook-cli\.mjs/iu
      .test(commandText(hook))
  ));
}

function hasIgnoreMemoryEnv(hooks) {
  return hooks.length > 0 && hooks.every((hook) => (
    /(?:^|[\s"'])--ignore-memory-env(?=$|[\s"'])/u.test(commandText(hook))
  ));
}

export function inspectCodexPassiveMemoryHookConfiguration(hooks) {
  const prompt = passiveHooks(hooks, 'UserPromptSubmit');
  const tool = passiveHooks(hooks, 'PostToolUse');
  const stop = passiveHooks(hooks, 'Stop');

  const promptSynchronous = prompt.length > 0
    && prompt.every((hook) => hook.async !== true);
  const toolSynchronous = tool.length > 0
    && tool.every((hook) => hook.async !== true);
  const stopAsynchronous = stop.length > 0
    && stop.every((hook) => hook.async === true);
  const ignoreMemoryEnv = (
    hasIgnoreMemoryEnv(prompt)
    && hasIgnoreMemoryEnv(tool)
    && hasIgnoreMemoryEnv(stop)
  );

  const userPromptSubmit = prompt.length > 0;
  const postToolUse = tool.length > 0;
  const rootStop = stop.length > 0;
  const configured = (
    userPromptSubmit
    && postToolUse
    && rootStop
    && promptSynchronous
    && toolSynchronous
    && stopAsynchronous
    && ignoreMemoryEnv
  );

  return {
    configured,
    userPromptSubmit,
    postToolUse,
    rootStop,
    promptSynchronous,
    toolSynchronous,
    stopAsynchronous,
    flags: { ignoreMemoryEnv },
  };
}
