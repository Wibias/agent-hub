#!/usr/bin/env node
/**
 * Scope-corrected v2 extraction from the *verbatim* general acceptance-rules
 * section inside one existing user-direct Evidence row. Proposals cite the
 * ORIGINAL full source ID, not a fabricated new high-authority Evidence row.
 *
 * Default: read-only, model-free preview.
 * Explicit --run-model: ONE isolated model call and Shadow-only proposals.
 * Never alters original source Evidence, ignored v1 statuses or Claims.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requireIsolatedShadow, sanitizeShadowExtractionFailure } from './extract-memory-shadow-evidence.mjs';
import { createIsolatedCodexJsonJudge } from './codex-isolated-memory-judge.mjs';
import { runEvidenceBoundExtractionPipeline } from '../memory-engine/evidence-bound-pipeline.mjs';
import { inspectMemoryTextSensitivity } from '../memory-engine/index.mjs';

const START = 'Regeln aus plans/regeln-abnahme.md';
const END = 'Repo Wibias/streamer-content.';
const REF_PATTERN = /^~p[0-9a-f]{12}$/u;
const POLICY = 'evidence-extraction-v2';

export function parseAcceptanceRulesArgs(argv = []) {
  const args = { runModel: false };
  const flags = new Map([
    ['--shadow-db', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--branch', 'branch'],
    ['--source-proposal-ref', 'sourceProposalRef'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--run-model') {
      if (args.runModel) throw new Error('duplicate --run-model');
      args.runModel = true;
      continue;
    }
    const name = flags.get(flag);
    const value = argv[++i];
    if (!name || Object.hasOwn(args, name) || typeof value !== 'string'
      || !value.trim() || value !== value.trim()) {
      throw new Error('unsupported, repeated or malformed flag');
    }
    args[name] = value;
  }
  if (!['dbPath','projectId','branch','sourceProposalRef'].every(x => args[x])) {
    throw new Error('exact shadow path, project, branch and source proposal required');
  }
  if (!isAbsolute(args.dbPath) || !REF_PATTERN.test(args.sourceProposalRef)) {
    throw new Error('invalid shadow path or source proposal ref');
  }
  args.dbPath = resolve(args.dbPath);
  return args;
}

function proposalRef(id) {
  return '~p' + createHash('sha256').update(id).digest('hex').slice(0, 12);
}

/**
 * Bounded, exact substring selection. Do NOT paraphrase, edit, combine,
 * synthesize or promote the source's authority. The original Evidence ID
 * stays attached to every proposal for independent full-source Support.
 */
export function selectVerbatimAcceptanceRules(sourceText) {
  if (typeof sourceText !== 'string') throw new TypeError('source text required');
  const start = sourceText.indexOf(START);
  const end = sourceText.indexOf(END, start + START.length);
  if (start < 0 || end < 0 || sourceText.indexOf(START, start + START.length) !== -1) {
    throw new Error('general acceptance-rules boundaries missing or ambiguous');
  }
  const excerpt = sourceText.slice(start, end);
  if (excerpt.length < 600 || excerpt.length > 12000
    || !excerpt.includes('Harte Regeln')
    || !excerpt.includes('zeit.txt')
    || !excerpt.includes('shots')
    || !sourceText.includes(excerpt)) {
    throw new Error('general acceptance-rules excerpt did not pass exact-source validation');
  }
  return excerpt;
}

function inspectSource({ dbPath, projectId, branch, sourceProposalRef }) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    db.exec('PRAGMA query_only=ON');
    const tables = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all().map(row => row.name));
    if (!['project_registry','evidence','claims','memory_evidence_proposals',
      'memory_evidence_proposal_evidence'].every(x => tables.has(x))) {
      throw new Error('expected Shadow schema missing');
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?').get(projectId)) {
      throw new Error('selected project not registered');
    }
    const proposals = db.prepare(
      "SELECT id FROM memory_evidence_proposals WHERE project_id=? AND branch=? AND status='pending'",
    ).all(projectId, branch);
    const selected = proposals.filter(row => proposalRef(row.id) === sourceProposalRef);
    if (selected.length !== 1) throw new Error('source proposal ref not unique or not pending');
    const sources = db.prepare(
      'SELECT e.* FROM memory_evidence_proposal_evidence l '
      + 'JOIN evidence e ON e.id=l.evidence_id WHERE l.proposal_id=?',
    ).all(selected[0].id);
    if (sources.length !== 1) throw new Error('exactly one cited original Evidence row required');
    const row = sources[0];
    if (row.project_id !== projectId || row.branch !== branch
      || row.authority_class !== 'user_direct'
      || row.sensitivity !== 'normal'
      || row.source_kind !== 'session') {
      throw new Error('original direct-user session evidence required in same scope');
    }
    const excerpt = selectVerbatimAcceptanceRules(row.content_redacted);
    const counts = () => ({
      claims: Number(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n),
      proposals: Number(db.prepare(
        'SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch=?',
      ).get(projectId, branch).n),
      ignored: Number(db.prepare(
        "SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch=? AND status='ignored'",
      ).get(projectId, branch).n),
    });
    return {
      source: {
        id: row.id, project_id: projectId, branch,
        authority_class: row.authority_class,
        source_kind: row.source_kind,
        sensitivity: row.sensitivity,
        // This is an unchanged substring of the single original source.
        content_redacted: excerpt,
      },
      excerptLength: excerpt.length,
      counts: counts(),
    };
  } finally { db.close(); }
}

export async function extractAcceptanceRules({
  dbPath, projectId, branch, sourceProposalRef,
  runModel = false,
  localAppData = process.env.LOCALAPPDATA,
  createJudge = createIsolatedCodexJsonJudge,
  runExtraction = runEvidenceBoundExtractionPipeline,
  onModelCallAttempt = () => {},
} = {}) {
  if (![dbPath,projectId,branch,sourceProposalRef].every(x => typeof x === 'string' && x.trim())
    || typeof runModel !== 'boolean'
    || typeof onModelCallAttempt !== 'function') {
    throw new TypeError('exact scope and mode required');
  }
  requireIsolatedShadow(dbPath, { localAppData });
  const before = inspectSource({ dbPath, projectId, branch, sourceProposalRef });
  const base = {
    scope: { projectId, branch }, sourceProposalRef,
    policyVersion: POLICY, sourceEvidenceAuthority: 'user_direct',
    sourceEvidenceRowsCreated: 0, evidenceExcerptIsVerbatim: true,
    excerptLength: before.excerptLength,
    claimsCreated: 0, protectedApproval: false,
    sourceDatabaseModifiedByTool: false, decisionsApplied: 0,
  };
  if (!runModel) {
    return {
      ...base, status: 'shadow_acceptance_rules_inspected',
      modelCallAttempted: false,
      note: 'Read-only, exact excerpt from existing original Evidence; --run-model makes one isolated extraction call.',
    };
  }
  let judge = null;
  let attempted = false;
  try {
    judge = await createJudge({
      workspaceLabel: 'evidence-shadow-acceptance-rules',
      policyVersion: POLICY,
      reasoningEffort: 'medium',
    });
    if (!judge || typeof judge.judge !== 'function'
      || typeof judge.close !== 'function'
      || typeof judge.evaluatorId !== 'string' || !judge.evaluatorId.trim()) {
      throw new Error('isolated judge contract invalid');
    }
    const result = await runExtraction({
      dbPath, projectId, branch, evidence: [before.source],
      evaluatorId: judge.evaluatorId,
      inspectTextSensitivity: inspectMemoryTextSensitivity,
      judge: async ({ prompt }) => {
        attempted = true;
        onModelCallAttempt();
        return judge.judge(prompt);
      },
    });
    const after = inspectSource({ dbPath, projectId, branch, sourceProposalRef });
    if (after.counts.claims !== before.counts.claims
      || after.counts.ignored !== before.counts.ignored) {
      throw new Error('Claim or ignored-proposal count changed during targeted extraction');
    }
    return {
      ...base, status: 'shadow_acceptance_rules_extracted_unreviewed',
      modelCallAttempted: attempted,
      proposedOrMatched: result.proposals.length,
      newProposalRows: after.counts.proposals - before.counts.proposals,
      originalIgnoredProposalsUnchanged: true,
      note: 'Only proposals cite the original full Evidence ID. Existing v1 decisions not reopened; no Support/Claim/approval.',
    };
  } finally {
    if (judge?.close) {
      try { await judge.close(); } catch {}
    }
  }
}

export async function runAcceptanceRulesCommand({
  argv = process.argv.slice(2), run = extractAcceptanceRules,
  write = s => process.stdout.write(s),
} = {}) {
  let attempted = false;
  try {
    const args = parseAcceptanceRulesArgs(argv);
    const result = await run({
      ...args, onModelCallAttempt: () => { attempted = true; },
    });
    write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    write(JSON.stringify({
      ...sanitizeShadowExtractionFailure(error, { modelCallAttempted: attempted }),
      status: 'shadow_acceptance_rules_failed',
      stage: 'scoped_verbatim_acceptance_rules',
      note: 'No automatic retry. Inspect Shadow inventory first. Never share raw source Evidence.',
    }, null, 2) + '\n');
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runAcceptanceRulesCommand();
}
