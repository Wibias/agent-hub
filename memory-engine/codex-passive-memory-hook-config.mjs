import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(value, name) {
  if (!nonEmpty(value)) throw new TypeError(name + ' must be a non-empty string');
  return value.trim();
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function windowsPowerShellCommand(executable, args = []) {
  const script = [
    '&',
    quotePowerShellLiteral(executable),
    ...args.map((arg) => quotePowerShellLiteral(arg)),
    ';',
    'exit $LASTEXITCODE',
  ].join(' ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
}

export function buildCodexPassiveMemoryHookEntries({
  hubRoot,
  nodePath,
  reasoningEffort = 'medium',
  model = null,
  judgeTimeoutMs = 120_000,
} = {}) {
  const root = requireString(hubRoot, 'hubRoot');
  const node = requireString(nodePath, 'nodePath');
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (model !== null && !nonEmpty(model)) {
    throw new TypeError('model must be null or a non-empty string');
  }
  if (!Number.isInteger(judgeTimeoutMs) || judgeTimeoutMs < 1) {
    throw new TypeError('judgeTimeoutMs must be a positive integer');
  }

  const script = resolve(
    root,
    'memory-engine',
    'adapters',
    'codex-passive-memory-hook-cli.mjs',
  );
  const commonArgs = ['--ignore-memory-env'];
  const stopArgs = [
    ...commonArgs,
    '--reasoning-effort', reasoningEffort,
    '--judge-timeout-ms', String(judgeTimeoutMs),
  ];
  if (model !== null) stopArgs.push('--model', model);

  const hook = (args, options = {}) => ({
    type: 'command',
    command: `node ${quote(script)} ${args.map(quote).join(' ')}`,
    commandWindows: windowsPowerShellCommand(node, [script, ...args]),
    ...options,
  });

  return {
    UserPromptSubmit: {
      hooks: [hook(commonArgs, {
        timeout: 10,
        statusMessage: 'Buffering project memory evidence',
      })],
    },
    PostToolUse: {
      hooks: [hook(commonArgs, {
        timeout: 10,
        statusMessage: 'Buffering tool evidence',
      })],
    },
    Stop: {
      hooks: [hook(stopArgs, {
        timeout: 600,
        async: true,
        statusMessage: 'Extracting durable project memory',
      })],
    },
  };
}
