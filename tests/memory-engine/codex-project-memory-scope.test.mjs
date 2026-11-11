import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  prepareProjectReadOnlyMcp,
  renderProjectReadOnlyMcpConfig,
} from '../../scripts/prepare-codex-memory-project-scope.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-codex-project-mcp-'));
  const repo = join(root, 'repo');
  const codexHome = join(root, 'codex-home');
  mkdirSync(repo); mkdirSync(codexHome);
  mkdirSync(join(repo, 'scripts'));
  writeFileSync(join(repo, 'scripts', 'run-codex-memory-mcp.mjs'), '// fixture\n');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  return {
    root, repo, codexHome,
    env: { ...process.env, CODEX_HOME: codexHome },
    close() { rmSync(root, { recursive: true, force: true }); },
  };
}

test('project-specific config is dry-run by default and uses absolute checkout path', () => {
  const f = fixture();
  try {
    const r = prepareProjectReadOnlyMcp({ cwd: f.repo, env: f.env });
    assert.equal(r.applied, false);
    assert.equal(existsSync(r.path), false);
    assert.match(r.contents, /\[mcp_servers\.agenthub-memory-read\]/);
    assert.match(r.contents, /enabled_tools = \["memory_recall"\]/);
    assert.match(r.contents, /default_tools_approval_mode = "prompt"/);
    assert.match(r.contents, /environment_id = "local"/);
    assert.ok(r.contents.includes(f.repo.replaceAll('\\', '\\\\')));
    assert.equal(r.contents, renderProjectReadOnlyMcpConfig({ repoRoot: f.repo }));
  } finally { f.close(); }
});

test('explicit apply creates project-local config and refuses overwrite', () => {
  const f = fixture();
  try {
    const r = prepareProjectReadOnlyMcp({
      cwd: f.repo, apply: true, env: f.env,
    });
    assert.equal(r.applied, true);
    assert.equal(readFileSync(r.path, 'utf8'), r.contents);
    assert.throws(() => prepareProjectReadOnlyMcp({
      cwd: f.repo, apply: true, env: f.env,
    }), /will not be overwritten/);
    assert.equal(readFileSync(r.path, 'utf8'), r.contents);
  } finally { f.close(); }
});

test('existing global registration must be removed before project apply', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.codexHome, 'config.toml'),
      '[mcp_servers.agenthub-memory-read]\ncommand = "node"\n');
    assert.throws(() => prepareProjectReadOnlyMcp({
      cwd: f.repo, apply: true, env: f.env,
    }), /Global agenthub-memory-read MCP is still registered/);
    assert.equal(existsSync(join(f.repo, '.codex', 'config.toml')), false);
  } finally { f.close(); }
});

test('non-root project directory is rejected instead of silently expanding access', () => {
  const f = fixture();
  try {
    const sub = join(f.repo, 'src');
    mkdirSync(sub);
    assert.throws(() => prepareProjectReadOnlyMcp({
      cwd: sub, apply: true, env: f.env,
    }), /Git repository root/);
  } finally { f.close(); }
});
