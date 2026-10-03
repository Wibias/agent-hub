import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scriptUrl = new URL(
  '../../scripts/run-memory-windows-release-smoke.ps1',
  import.meta.url,
);

test('Windows release smoke identifies encoded hook via readable command', async () => {
  const script = await readFile(scriptUrl, 'utf8');

  assert.match(
    script,
    /\$_\.command\s+-is\s+\[string\]/,
  );
  assert.match(
    script,
    /\$_\.command\s+-match\s+"codex-hook-cli\\\.mjs"/,
  );
  assert.match(
    script,
    /\$_\.commandWindows\s+-is\s+\[string\]/,
  );
  assert.doesNotMatch(
    script,
    /\$_\.commandWindows\s+-match\s+"codex-hook-cli\\\.mjs"/,
  );
  assert.match(
    script,
    /-Command\s+\$PromptHook\.commandWindows/,
  );
});
