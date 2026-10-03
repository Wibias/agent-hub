import { createHash } from 'node:crypto';
import { basename } from 'node:path';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeLocalLabel(value) {
  const label = String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return label || 'repository';
}

export function canonicalizeGitRemote(value) {
  if (!nonEmpty(value)) return null;
  const remote = value.trim();

  let host;
  let repoPath;

  const scpLike = remote.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (scpLike) {
    host = scpLike[1];
    repoPath = scpLike[2];
  } else {
    let parsed;
    try {
      parsed = new URL(remote);
    } catch {
      return null;
    }
    host = parsed.hostname;
    repoPath = parsed.pathname;
  }

  host = String(host || '').trim().toLowerCase();
  repoPath = String(repoPath || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');

  if (!host || !repoPath || /\s/.test(repoPath)) return null;
  const segments = repoPath.split('/').filter(Boolean);
  if (
    segments.length < 2
    || segments.some((segment) => segment === '.' || segment === '..')
  ) {
    return null;
  }

  return `${host}/${segments.join('/')}`;
}

export function canonicalizeLocalGitProjectId(value) {
  if (!nonEmpty(value)) return null;
  const raw = value.trim();
  if (
    raw.includes('..')
    || /[\\\s]/.test(raw)
  ) {
    return null;
  }
  const segments = raw.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const normalized = segments.map(safeLocalLabel).filter(Boolean).join('/');
  return normalized ? `local.git/${normalized}` : null;
}

export function resolveGitRepositoryIdentity({
  repoPath,
  execFile,
} = {}) {
  if (!nonEmpty(repoPath)) {
    throw new TypeError('repoPath must be a non-empty string');
  }
  if (typeof execFile !== 'function') {
    throw new TypeError('execFile must be a function');
  }

  let configuredLocal = null;
  try {
    configuredLocal = String(
      execFile('git', [
        '-C',
        repoPath,
        'config',
        '--local',
        '--get',
        'agent-hub.project-id',
      ]),
    ).trim();
  } catch {}

  if (configuredLocal) {
    const localIdentity = canonicalizeLocalGitProjectId(configuredLocal);
    if (!localIdentity) {
      throw new Error(
        'Git agent-hub.project-id cannot be converted to a safe local repository identity',
      );
    }
    return {
      projectId: localIdentity,
      repoIdentity: localIdentity,
      canonicalRemote: null,
      identitySource: 'local_config',
    };
  }

  let remote = null;
  try {
    remote = String(
      execFile('git', ['-C', repoPath, 'remote', 'get-url', 'origin']),
    ).trim();
  } catch {}

  if (remote) {
    const remoteIdentity = canonicalizeGitRemote(remote);
    if (!remoteIdentity) {
      throw new Error(
        'Git origin remote cannot be converted to a safe repository identity',
      );
    }
    return {
      projectId: remoteIdentity,
      repoIdentity: remoteIdentity,
      canonicalRemote: remoteIdentity,
      identitySource: 'origin',
    };
  }

  let roots;
  try {
    roots = String(
      execFile('git', ['-C', repoPath, 'rev-list', '--max-parents=0', 'HEAD']),
    )
      .split(/\r?\n/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .sort();
  } catch {
    roots = [];
  }

  if (
    roots.length === 0
    || roots.some((value) => !/^[0-9a-f]{40,64}$/.test(value))
  ) {
    throw new Error(
      'Local Git repository identity requires at least one commit or git config --local agent-hub.project-id <name>',
    );
  }

  const repoName = safeLocalLabel(basename(repoPath));
  const fingerprint = createHash('sha256')
    .update(roots.join('\n'), 'utf8')
    .digest('hex')
    .slice(0, 12);
  const localIdentity = `local.git/${repoName}@${fingerprint}`;

  return {
    projectId: localIdentity,
    repoIdentity: localIdentity,
    canonicalRemote: null,
    identitySource: 'root_commit',
  };
}
