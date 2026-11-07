#!/usr/bin/env node
/**
 * D12.2 local-only manual review for classic direct-user candidates.
 *
 * By default, prints only synthetic refs and allowlisted metadata.
 * --show-local-content explicitly prints the candidate's stored redacted
 * source text to the local terminal; do not post it without reviewing it.
 *
 * No model request, database writes, candidate evaluations, or promotions.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoryCandidateJudgeRef } from '../memory-engine/memory-candidate-judge.mjs';

const KINDS = new Set([
  'decision', 'preference', 'constraint', 'correction',
  'rejected_approach', 'known_issue',
]);

export function parseCandidateReviewArgs(argv = []) {
  const parsed = { dbPath: null, projectId: null, branch: null, showLocalContent: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate option');
    seen.add(flag);
    if (flag === '--show-local-content') {
      parsed.showLocalContent = true;
      continue;
    }
    if (!['--db-path', '--project-id', '--branch'].includes(flag)) {
      throw new Error('unsupported option');
    }
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim()) throw new Error('missing option value');
    if (flag === '--db-path') parsed.dbPath = resolve(value);
    else if (flag === '--project-id') parsed.projectId = value.trim();
    else parsed.branch = value.trim();
  }
  if (!parsed.dbPath || !parsed.projectId || !parsed.branch) {
    throw new Error('--db-path, --project-id and --branch are required');
  }
  return parsed;
}

/** Only explicit user-direct items that still await importance judgment. */
export function inspectPendingCandidateReview({
  dbPath, projectId, branch, showLocalContent = false,
  openDatabase = (path) => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (!dbPath || !projectId || !branch) throw new Error('scope is required');
  const db = openDatabase(dbPath);
  try {
    const rows = db.prepare(
      'SELECT id, proposed_type, proposed_value FROM memory_candidates '
      + "WHERE project_id = ? AND branch = ? AND source_authority = 'user_direct' "
      + "AND status = 'pending' AND evaluated_at IS NULL "
      + 'ORDER BY created_at ASC, id ASC LIMIT 20',
    ).all(projectId, branch);
    const candidates = rows.map((row) => ({
      candidateRef: memoryCandidateJudgeRef(row.id),
      kind: KINDS.has(row.proposed_type) ? row.proposed_type : 'unknown',
      ...(showLocalContent ? { localCandidateText: String(row.proposed_value ?? '') } : {}),
    }));
    return {
      type: 'agent_hub_memory_candidate_local_review_v1',
      readOnly: true,
      modelInvocations: 0,
      scope: { projectId, branch },
      candidateCount: candidates.length,
      contentIncluded: showLocalContent,
      candidates,
      reviewCriteria: [
        'Does the user statement apply to future sessions or only to one task?',
        'Is there a named expiry, milestone, or migration end?',
        'Would forgetting it cause repeated work or violation of a project rule?',
        'Does the source specify scope and qualifiers without inference?',
      ],
    };
  } finally {
    db.close();
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  try {
    const report = inspectPendingCandidateReview(parseCandidateReviewArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
  } catch {
    console.error('Local candidate review unavailable. Verify source DB and exact scope.');
    process.exitCode = 1;
  }
}
