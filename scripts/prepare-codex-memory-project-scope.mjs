#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Project-local Codex MCP configuration is loaded only for trusted projects.
 * The generator never edits global Codex config and never overwrites existing
 * .codex/config.toml. --apply is intentionally required for any mutation.
 */
export function renderProjectReadOnlyMcpConfig({ repoRoot }) {
  if (typeof repoRoot !== 'string' || !isAbsolute(repoRoot)) {
    throw new TypeError('repoRoot must be absolute');
  }
  const entry = join(repoRoot, 'scripts', 'run-codex-memory-mcp.mjs');
  const toml = (s) => JSON.stringify(s);
  return [
    '# Personal project-scoped AgentHub MCP. Do not commit this machine-specific path.',
    '[mcp_servers.agenthub-memory-read]',
    'command = "node"',
    'args = [' + [entry, '--cwd', repoRoot].map(toml).join(', ') + ']',
    'cwd = ' + toml(repoRoot),
    'enabled = true',
    'environment_id = "local"',
    'enabled_tools = ["memory_recall"]',
    'default_tools_approval_mode = "prompt"',
    '',
  ].join('\n');
}

function globalConfigHasMcp({ env, homeDir }) {
  const codexHome = typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim()
    ? env.CODEX_HOME.trim() : join(homeDir, '.codex');
  const globalConfig = join(codexHome, 'config.toml');
  if (!existsSync(globalConfig)) return false;
  return /^\s*\[mcp_servers\.(?:"agenthub-memory-read"|agenthub-memory-read)\]\s*$/m
    .test(readFileSync(globalConfig, 'utf8'));
}

export function prepareProjectReadOnlyMcp({
  cwd,
  apply = false,
  env = process.env,
  homeDir = homedir(),
  gitPrefix = (root) => execFileSync(
    'git', ['-C', root, 'rev-parse', '--show-prefix'], { encoding: 'utf8' },
  ).trim(),
} = {}) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
    throw new TypeError('Pass --cwd with an absolute AgentHub repository path');
  }
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('Node.js 24+ is required');
  }
  const root = realpathSync(resolve(cwd));
  // Git reports an empty relative prefix only from its repository root.
  // Comparing Git's path spelling to Windows realpath is unreliable: Git for
  // Windows may return a different drive letter case or short/long path.
  if (gitPrefix(root) !== '') {
    throw new Error('--cwd must point to the Git repository root');
  }
  if (!existsSync(join(root, 'scripts', 'run-codex-memory-mcp.mjs'))) {
    throw new Error('MCP server entrypoint is missing in this checkout');
  }

  const configPath = join(root, '.codex', 'config.toml');
  const contents = renderProjectReadOnlyMcpConfig({ repoRoot: root });
  if (existsSync(configPath)) {
    throw new Error('A project .codex/config.toml already exists. It will not be overwritten; merge the MCP table manually.');
  }
  if (apply && globalConfigHasMcp({ env, homeDir })) {
    throw new Error('Global agenthub-memory-read MCP is still registered. Remove only that global entry with "codex mcp remove agenthub-memory-read" before --apply.');
  }
  if (apply) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  return {
    scope: 'trusted_project_only',
    applied: apply,
    path: configPath,
    contents,
    reminder: 'Project config is machine-specific and must not be committed. Restart Codex Desktop; this is not a security boundary against a local user who can read the SQLite file directly.',
  };
}

export function parseArgs(argv) {
  let cwd = null;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cwd' && cwd === null) {
      cwd = argv[++i];
    } else if (argv[i] === '--apply' && apply === false) {
      apply = true;
    } else {
      throw new Error('Usage: node scripts/prepare-codex-memory-project-scope.mjs --cwd ABSOLUTE_REPO [--apply]');
    }
  }
  if (!cwd) throw new Error('An absolute --cwd is required');
  return { cwd, apply };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = prepareProjectReadOnlyMcp(parseArgs(process.argv.slice(2)));
    process.stdout.write(
      (result.applied ? 'PROJECT_MCP_CONFIG_CREATED' : 'PROJECT_MCP_CONFIG_DRY_RUN')
      + '\n' + result.path + '\n' + result.contents
      + '\n' + result.reminder + '\n',
    );
  } catch (error) {
    process.stderr.write('PROJECT_MCP_CONFIG_DENIED: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
