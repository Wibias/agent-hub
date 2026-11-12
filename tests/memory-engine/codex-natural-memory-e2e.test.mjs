import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { readCodexMemory } from '../../memory-engine/adapters/codex-readonly-memory-mcp.mjs';
import {
  canonicalizeExplicitMemoryValue, parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';

function withGitFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'codex-natural-memory-'));
  const cwd = join(root, 'repo');
  const dbPath = join(root, 'memory.sqlite3');
  try {
    mkdirSync(cwd);
    execFileSync('git', ['init', '-b', 'main', cwd], { stdio: 'ignore' });
    execFileSync('git', ['-C', cwd, 'config', 'user.email', 'memory@example.test']);
    execFileSync('git', ['-C', cwd, 'config', 'user.name', 'Memory Test']);
    execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', 'https://github.com/example/natural-memory.git']);
    writeFileSync(join(cwd, 'README.md'), '# fixture\n');
    execFileSync('git', ['-C', cwd, 'add', 'README.md']);
    execFileSync('git', ['-C', cwd, 'commit', '-m', 'initial'], { stdio: 'ignore' });
    run({ root, cwd, dbPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('conversational memory commands require unmistakable direct-user wording', () => {
  const approved = [
    ['Merke dir: Wir verwenden PostgreSQL.', 'Wir verwenden PostgreSQL.'],
    ['Bitte merke dir: Wir verwenden SQLite.', 'Wir verwenden SQLite.'],
    ['Merke dir, dass wir PostgreSQL verwenden.', 'wir PostgreSQL verwenden.'],
    ['Remember: Use Node 24.', 'Use Node 24.'],
    ['Remember this: Avoid silent changes.', 'Avoid silent changes.'],
    ['Remember that we use Node 24.', 'we use Node 24.'],
    ['memory: database is Postgres', 'database is Postgres'],
  ];
  for (const [prompt, value] of approved) {
    const parsed = parseExplicitMemoryPrompt(prompt);
    assert.equal(parsed?.mode, 'remember', prompt);
    assert.equal(canonicalizeExplicitMemoryValue(parsed.value), value, prompt);
  }
  for (const prompt of [
    'Can you remember our PostgreSQL choice?',
    'The code comment says: Merke dir: ...',
    'Please remember to run the tests',
    'Merke dir die Ergebnisse',
    'Merke dir, dass wir SQLite nutzen.\nUnd baue anschließend die API.',
    'Remember that we use Node.\nAlso deploy now.',
    'Merke dir:',
    'Remember:',
  ]) {
    assert.equal(parseExplicitMemoryPrompt(prompt), null, prompt);
  }
});

test('original Codex UserPromptSubmit CLI stores exact explicit user text; normal Recall retrieves it', () => {
  withGitFixture(({ cwd, dbPath }) => {
    const script = fileURLToPath(new URL('../../memory-engine/adapters/codex-hook-cli.mjs', import.meta.url));
    const userPrompt = 'Merke dir, dass wir fuer dieses Projekt PostgreSQL verwenden.';
    const run = spawnSync(process.execPath, [script, '--explicit-memory-requests'], {
      cwd,
      input: JSON.stringify({
        session_id: 'natural-memory-session',
        turn_id: 'natural-memory-turn',
        cwd,
        hook_event_name: 'UserPromptSubmit',
        prompt: userPrompt,
      }),
      env: { ...process.env, AGENT_HUB_MEMORY_DB: dbPath, AGENT_HUB_MEMORY_CAPTURE_PROMPTS: 'false' },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.decision, 'block');
    assert.match(result.reason, /Memory stored for the current project and branch/);

    const memory = new MemoryEngine({ dbPath });
    try {
      const records = memory.exportCanonical();
      assert.equal(records.claims.length, 1);
      const claim = records.claims[0];
      assert.equal(claim.project_id, 'github.com/example/natural-memory');
      assert.equal(claim.branch_scope, 'main');
      assert.equal(claim.kind, 'user_direct');
      assert.equal(claim.value_text, 'wir fuer dieses Projekt PostgreSQL verwenden.');
      assert.equal(records.evidence[0].content_redacted, userPrompt);
      assert.equal(records.evidence[0].authority_class, 'user_direct');
      assert.equal(records.evidence[0].metadata_json.includes('explicit_memory'), true);
    } finally {
      memory.close();
    }

    const recall = readCodexMemory({
      cwd, query: 'PostgreSQL',
      env: { AGENT_HUB_MEMORY_DB: dbPath },
    });
    assert.equal(recall.status, 'found');
    assert.equal(recall.project_id, 'github.com/example/natural-memory');
    assert.equal(recall.branch, 'main');
    assert.equal(recall.items[0].claim.value, 'wir fuer dieses Projekt PostgreSQL verwenden.');
  });
});
