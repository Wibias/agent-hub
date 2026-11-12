// Compare a reviewed Git commit with a remote HEAD without cloning file contents.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shaPattern = /^[0-9a-f]{40}$/;
const directoryScope = /^(?:[A-Za-z0-9._-]+\/)+$/;

export function directoryScopeFor(source) {
  return typeof source?.scope === 'string' && directoryScope.test(source.scope)
    ? source.scope : null;
}

export function hasScopedChanges({ remote, reviewedCommit, head, scope }) {
  if (!shaPattern.test(reviewedCommit) || !shaPattern.test(head) ||
      !directoryScope.test(scope) || typeof remote !== 'string' || !remote) {
    throw new TypeError('invalid scoped comparison inputs');
  }

  const gitDir = mkdtempSync(join(tmpdir(), 'agent-hub-upstream-'));
  try {
    const git = (args, diff = false) => {
      const result = spawnSync('git', ['--git-dir', gitDir, ...args], {
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1_048_576,
        windowsHide: true,
      });
      if (result.error || (result.status !== 0 && !(diff && result.status === 1))) {
        throw new Error('Git metadata comparison failed (' +
          (result.error?.code ?? result.status ?? 'unknown') + ')');
      }
      return result.status;
    };

    git(['init', '--bare', '-q']);
    // Transfer shallow commits and trees, never binary/file blobs.
    git(['fetch', '--quiet', '--no-tags', '--filter=blob:none', '--depth=1',
      remote, reviewedCommit, head]);
    return git(['-c', 'diff.renames=false', 'diff', '--quiet',
      reviewedCommit, head, '--', scope], true) === 1;
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
}
