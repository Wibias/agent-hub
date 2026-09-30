import { execFileSync } from 'node:child_process';

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function defaultExecFile(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function resolveGitContext({
  cwd,
  execFile = defaultExecFile,
}) {
  assertNonEmptyString(cwd, 'cwd');
  if (typeof execFile !== 'function') {
    throw new TypeError('execFile must be a function');
  }

  const repoPath = String(
    execFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel']),
  ).trim();
  assertNonEmptyString(repoPath, 'repository root');

  const branch = String(
    execFile('git', ['-C', repoPath, 'branch', '--show-current']),
  ).trim();
  if (!branch) {
    throw new Error('current Git checkout has no branch; detached HEAD is unsupported');
  }

  const revisionSha = String(
    execFile('git', ['-C', repoPath, 'rev-parse', 'HEAD']),
  ).trim();
  if (!/^[0-9a-f]{40}$/i.test(revisionSha)) {
    throw new Error('current Git revision must be a full commit SHA');
  }

  return {
    repoPath,
    branch,
    revisionSha,
  };
}

export function gitBlobOid({
  repoPath,
  revisionSha,
  path,
  execFile = defaultExecFile,
}) {
  assertNonEmptyString(repoPath, 'repoPath');
  assertNonEmptyString(revisionSha, 'revisionSha');
  assertNonEmptyString(path, 'path');
  if (typeof execFile !== 'function') {
    throw new TypeError('execFile must be a function');
  }

  const output = String(execFile(
    'git',
    ['-C', repoPath, 'ls-tree', '-z', revisionSha, '--', path],
  ));
  if (output.length === 0) return null;

  const record = output.split('\0', 1)[0];
  const tab = record.indexOf('\t');
  if (tab < 0) {
    throw new Error(`unexpected git ls-tree output for ${path}`);
  }

  const [mode, type, oid] = record.slice(0, tab).split(/\s+/);
  const returnedPath = record.slice(tab + 1);
  if (!mode || !type || !oid || returnedPath !== path) {
    throw new Error(`unexpected git ls-tree record for ${path}`);
  }
  if (type !== 'blob') return null;
  if (!/^[0-9a-f]{40,64}$/i.test(oid)) {
    throw new Error(`unexpected git blob object id for ${path}`);
  }
  return oid;
}

export function refreshRepositoryFreshness({
  memory,
  projectId,
  branch,
  revisionSha,
  repoPath,
  execFile = defaultExecFile,
}) {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  assertNonEmptyString(projectId, 'projectId');
  assertNonEmptyString(branch, 'branch');
  assertNonEmptyString(revisionSha, 'revisionSha');
  assertNonEmptyString(repoPath, 'repoPath');

  const paths = memory.repositoryPaths({ projectId, branch });
  for (const path of paths) {
    memory.recordRepositoryPathState({
      projectId,
      branch,
      path,
      commitSha: revisionSha,
      blobOid: gitBlobOid({
        repoPath,
        revisionSha,
        path,
        execFile,
      }),
    });
  }

  return paths.length;
}
