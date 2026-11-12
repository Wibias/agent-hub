import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

/**
 * Resolve Codex for a no-shell child process.
 *
 * Windows npm's codex.cmd cannot be passed to spawn() without a shell.
 * Execute its installed JS entrypoint with Node instead, preserving stdin
 * as the sole prompt channel and never evaluating user text as shell input.
 *
 * The same resolver is used for user and agent importance/relation judges.
 */
function regularFile(path) {
  try {
    const st = lstatSync(path);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function envValue(env, name) {
  const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase());
  return key ? env[key] : undefined;
}

function npmShimEntrypoint(dir) {
  const entry = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  return regularFile(entry) ? entry : null;
}

function fromPath(path, { platform, nodeExecutable }) {
  const extension = path.toLowerCase().match(/\.(exe|cmd|bat|ps1|js)$/)?.[1];
  if (platform === 'win32') {
    if (extension === 'exe' && regularFile(path)) {
      return { command: path, prefixArgs: [], kind: 'native' };
    }
    if (extension === 'js' && regularFile(path)) {
      return { command: nodeExecutable, prefixArgs: [path], kind: 'node_js' };
    }
    if (extension === 'cmd' && regularFile(path)) {
      const js = npmShimEntrypoint(resolve(path, '..'));
      return js
        ? { command: nodeExecutable, prefixArgs: [js], kind: 'npm_js' }
        : null;
    }
    return null;
  }
  return regularFile(path)
    ? { command: path, prefixArgs: [], kind: 'native' }
    : null;
}

export function resolveCodexJudgeExecutable({
  env = process.env,
  platform = process.platform,
  nodeExecutable = process.execPath,
  userHome = homedir(),
} = {}) {
  const override = env.AGENT_HUB_MEMORY_JUDGE_CODEX_BIN || env.CODEX_BIN;
  if (typeof override === 'string' && override.trim() && override.trim() !== 'codex') {
    const selected = override.trim();
    if (!isAbsolute(selected)) {
      throw new Error('CODEX_JUDGE_EXECUTABLE_INVALID: override must be an absolute path');
    }
    const located = fromPath(selected, { platform, nodeExecutable });
    if (!located) {
      throw new Error('CODEX_JUDGE_EXECUTABLE_INVALID: override must be an existing exe/js binary or supported npm cmd shim');
    }
    return located;
  }

  if (platform !== 'win32') {
    // POSIX executable lookup is safely delegated to spawn() with shell:false.
    return { command: 'codex', prefixArgs: [], kind: 'path_command' };
  }

  const pathText = envValue(env, 'PATH') ?? '';
  const pathDirs = String(pathText).split(platform === 'win32' ? ';' : delimiter)
    .map(x => x.trim().replace(/^"|"$/g, ''))
    .filter(x => x && isAbsolute(x));

  const localAppData = envValue(env, 'LOCALAPPDATA');
  const appData = envValue(env, 'APPDATA');
  const extraDirs = [
    ...(localAppData && isAbsolute(localAppData)
      ? [join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin')] : []),
    ...(appData && isAbsolute(appData) ? [join(appData, 'npm')] : []),
    join(userHome, 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin'),
  ];
  const dirs = [...new Set([...pathDirs, ...extraDirs])];

  // PATH directory order takes precedence. A global native-first sweep
  // can silently select an older codex.exe from a later directory instead
  // of the npm CLI the user runs via an earlier codex.cmd shim.
  // Within one directory, favor the native executable; never invoke a
  // Windows cmd/bat/PowerShell shim as a child shell.
  for (const dir of dirs) {
    for (const filename of ['codex.exe', 'codex.cmd']) {
      const located = fromPath(join(dir, filename), {
        platform, nodeExecutable,
      });
      if (located) return located;
    }
  }

  throw new Error(
    'CODEX_JUDGE_CLI_NOT_FOUND: no native codex.exe or supported npm codex.cmd entrypoint found; verify Codex CLI installation/PATH in the host environment',
  );
}
