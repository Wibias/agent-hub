import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

/**
 * Resolve Codex without a shell. Windows npm provides codex.ps1/codex.cmd
 * rather than an executable that child_process.spawn('codex') can launch.
 * Invoke the installed npm Node entrypoint directly instead of shell:true.
 */
export function resolveCodexCandidateLaunch({
  platform = process.platform,
  env = process.env,
  nodeExecutable = process.execPath,
  fileExists = existsSync,
} = {}) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object');
  }
  if (typeof fileExists !== 'function') {
    throw new TypeError('fileExists must be a function');
  }
  const configured = typeof env.CODEX_BIN === 'string' && env.CODEX_BIN.trim()
    ? env.CODEX_BIN.trim()
    : 'codex';

  // Explicit Node entrypoints are portable across platforms and avoid shell wrappers.
  const configuredExt = win32.extname(configured).toLowerCase();
  if (['.js', '.mjs', '.cjs'].includes(configuredExt)) {
    return { command: nodeExecutable, prefixArgs: [configured], kind: 'npm_node' };
  }

  if (platform !== 'win32') {
    return { command: configured, prefixArgs: [], kind: 'native' };
  }

  const pathValue = Object.entries(env)
    .find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const paths = typeof pathValue === 'string'
    ? pathValue.split(';')
      .map((part) => part.trim().replace(/^"(.*)"$/u, '$1'))
      .filter(Boolean)
    : [];

  const launchNode = (script) => ({
    command: nodeExecutable,
    prefixArgs: [script],
    kind: 'npm_node',
  });

  const resolveNpmShim = (shimPath) => {
    const dir = win32.dirname(shimPath);
    const script = win32.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    return fileExists(script) ? launchNode(script) : null;
  };

  const ext = win32.extname(configured).toLowerCase();
  if (ext === '.exe' || ext === '.com') {
    return { command: configured, prefixArgs: [], kind: 'native' };
  }
  if (ext === '.js' || ext === '.mjs') {
    return launchNode(configured);
  }
  if (ext === '.ps1' || ext === '.cmd' || ext === '.bat') {
    const launch = resolveNpmShim(configured);
    if (launch) return launch;
    throw Object.assign(new Error('Codex npm entrypoint missing'), {
      code: 'CODEX_NPM_ENTRYPOINT_MISSING',
    });
  }
  if (configured !== 'codex') {
    throw Object.assign(new Error('Unsupported Codex launcher on Windows'), {
      code: 'CODEX_WINDOWS_LAUNCH_UNSUPPORTED',
    });
  }

  let foundNpmShim = false;
  for (const dir of paths) {
    const binary = win32.join(dir, 'codex.exe');
    if (fileExists(binary)) {
      return { command: binary, prefixArgs: [], kind: 'native' };
    }
    const ps1 = win32.join(dir, 'codex.ps1');
    const cmd = win32.join(dir, 'codex.cmd');
    if (!fileExists(ps1) && !fileExists(cmd)) continue;
    foundNpmShim = true;
    const launch = resolveNpmShim(ps1);
    if (launch) return launch;
  }

  throw Object.assign(new Error(
    foundNpmShim ? 'Codex npm entrypoint missing' : 'Codex executable not found',
  ), {
    code: foundNpmShim ? 'CODEX_NPM_ENTRYPOINT_MISSING' : 'CODEX_NOT_FOUND',
  });
}
