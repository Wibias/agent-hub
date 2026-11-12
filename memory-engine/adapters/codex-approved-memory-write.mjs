import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { MemoryEngine } from '../index.mjs';
import { resolveGitContext } from '../git-freshness.mjs';
import {
  defaultGlobalMemoryScopePath, describeGlobalMemoryProject, loadGlobalMemoryScope, samePath,
} from './codex-global-memory-scope.mjs';
import { commitCodexMemoryClaim } from './codex-memory-commit-cli.mjs';

const ACTION = 'memory_claim_commit';
const ENVIRONMENT = 'local_preview';
const OPERATOR_SOURCE = 'local:operator-confirmation';
const SOURCE_KIND = 'operator_explicit';

function sameApprovedDirectory(a, b) {
  if (samePath(a, b)) return true;
  // Windows 8.3 aliases (RUNNER~1 vs runneradmin) can spell the same NTFS object differently.
  // Compare exact file IDs, never substring or prefix matches.
  const x = statSync(a, { bigint: true });
  const y = statSync(b, { bigint: true });
  return x.isDirectory() && y.isDirectory()
    && x.ino !== 0n && x.ino === y.ino && x.dev === y.dev;
}


/** This is a pinned, allowlisted per-project preview, not an authenticated host session. */
export function resolveApprovedWriteScope({
  cwd, scopePath = defaultGlobalMemoryScopePath(),
} = {}) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('absolute_project_root_required');
  if (typeof scopePath !== 'string' || !isAbsolute(scopePath)) throw new Error('absolute_scope_file_required');
  const manifest = loadGlobalMemoryScope(scopePath);
  if (!manifest) throw new Error('scope_not_configured');
  const current = describeGlobalMemoryProject({ cwd });
  const prefix = String(execFileSync('git', ['-C', resolve(cwd), 'rev-parse', '--show-prefix'], { encoding: 'utf8', timeout: 5000 })).trim();
  if (prefix !== '') throw new Error('pinned_cwd_must_be_git_root');
  const approved = manifest.projects.find((entry) => sameApprovedDirectory(entry.root, current.root));
  if (!approved) throw new Error('project_not_approved');
  if (approved.project_id !== current.project_id || approved.repo_identity !== current.repo_identity) {
    throw new Error('project_identity_changed');
  }
  const stat = lstatSync(manifest.memory_db);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('memory_database_not_regular_file');
  const git = resolveGitContext({ cwd: current.root });
  return {
    cwd: current.root, dbPath: realpathSync(manifest.memory_db),
    projectId: approved.project_id, repoIdentity: approved.repo_identity,
    branch: git.branch, revisionSha: git.revisionSha,
  };
}

function ensureProject(memory, scope) {
  const project = memory.getProject(scope.projectId);
  if (!project || project.repo_identity !== scope.repoIdentity) throw new Error('project_not_registered_or_changed');
}

function approvedEvidence(evidence, scope) {
  return evidence !== null
    && evidence.project_id === scope.projectId
    && evidence.branch === scope.branch
    && evidence.authority_class === 'user_direct'
    && evidence.source_kind === SOURCE_KIND
    && evidence.source_ref === OPERATOR_SOURCE
    && evidence.metadata?.event_type === 'explicit_operator_approval'
    && evidence.metadata?.purpose === 'codex_memory_write_preview';
}

/** Only an out-of-band, explicitly confirmed operator command may call this.
 * It records a single redacted fact and a 10-minute one-use approval.
 */
export function prepareApprovedMemoryWrite({
  cwd, scopePath, text, confirmed = false,
  now = () => new Date(),
  createEngine = (dbPath) => new MemoryEngine({ dbPath }),
  idFactory = randomUUID,
} = {}) {
  if (confirmed !== true) throw new Error('explicit_operator_confirmation_required');
  if (typeof text !== 'string' || text.trim().length < 1 || text.length > 1200) {
    throw new Error('memory_text_length_invalid');
  }
  const scope = resolveApprovedWriteScope({ cwd, scopePath });
  const memory = createEngine(scope.dbPath);
  try {
    ensureProject(memory, scope);
    const start = now();
    if (!(start instanceof Date) || !Number.isFinite(start.getTime())) throw new Error('invalid_clock');
    const issuedAt = start.toISOString();
    const expiresAt = new Date(start.getTime() + 10 * 60_000).toISOString();
    const evidenceId = 'evidence:codex-approved:' + idFactory();
    const approvalId = 'approval:codex-approved:' + idFactory();
    memory.recordEvidence({
      id: evidenceId, projectId: scope.projectId,
      harness: 'codex', sessionId: null,
      sourceKind: SOURCE_KIND, sourceRef: OPERATOR_SOURCE,
      capturedAt: issuedAt, branch: scope.branch, commitSha: null,
      path: null, blobOid: null, content: text.trim(),
      authorityClass: 'user_direct',
      metadata: {
        event_type: 'explicit_operator_approval',
        purpose: 'codex_memory_write_preview',
      },
    });
    memory.recordApproval({
      id: approvalId, projectId: scope.projectId,
      action: ACTION, target: evidenceId, environment: ENVIRONMENT,
      artifact: null, constraints: {
        branch: scope.branch, repo_identity: scope.repoIdentity,
      },
      issuedAt, expiresAt, maxUses: 1, sourceEvidenceId: evidenceId,
    });
    return {
      status: 'prepared', project_id: scope.projectId, branch: scope.branch,
      evidence_id: evidenceId, approval_id: approvalId, expires_at: expiresAt,
      max_uses: 1,
    };
  } finally {
    memory.close();
  }
}

/** Native MemoryEngine authorization is consumed before the existing canonical
 * commit protocol. Failure after consumption must fail closed (no refund).
 */
export async function commitApprovedMemoryWrite({
  cwd, scopePath, evidenceId,
  createEngine = (dbPath) => new MemoryEngine({ dbPath }),
  commit = commitCodexMemoryClaim,
} = {}) {
  if (typeof evidenceId !== 'string' || !/^evidence:codex-approved:[0-9a-f-]{36}$/i.test(evidenceId)) {
    return { status: 'invalid_evidence_id', committed: false };
  }
  let scope;
  try { scope = resolveApprovedWriteScope({ cwd, scopePath }); }
  catch { return { status: 'scope_denied', committed: false }; }
  const memory = createEngine(scope.dbPath);
  try {
    ensureProject(memory, scope);
    const evidence = memory.getEvidence(evidenceId);
    if (!approvedEvidence(evidence, scope)) return { status: 'evidence_denied', committed: false };
    const decision = memory.authorizeAction({
      projectId: scope.projectId, action: ACTION, target: evidenceId,
      environment: ENVIRONMENT, artifact: null,
      constraints: { branch: scope.branch, repo_identity: scope.repoIdentity },
    });
    if (!decision.authorized) return { status: 'approval_denied', committed: false };
  } catch {
    return { status: 'memory_write_denied', committed: false };
  } finally {
    memory.close();
  }
  try {
    const result = await commit({
      input: { evidence_id: evidenceId, lifecycle: {} }, cwd: scope.cwd,
      env: {
        AGENT_HUB_MEMORY_DB: scope.dbPath,
        AGENT_HUB_MEMORY_PROJECT_ID: scope.projectId,
        AGENT_HUB_MEMORY_REPO_IDENTITY: scope.repoIdentity,
      },
    });
    if (result.project_id !== scope.projectId || result.branch !== scope.branch || result.evidence_id !== evidenceId) {
      return { status: 'commit_result_mismatch', committed: false };
    }
    return {
      status: 'committed', committed: true, project_id: result.project_id,
      branch: result.branch, evidence_id: evidenceId, claim_id: result.claim_id,
      claim_state: result.state,
    };
  } catch {
    return { status: 'commit_failed_approval_consumed', committed: false };
  }
}
