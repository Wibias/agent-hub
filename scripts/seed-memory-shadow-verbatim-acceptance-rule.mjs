#!/usr/bin/env node
/**
 * Deterministically stage ONE exact, source-derived acceptance rule as an
 * UNREVIEWED Shadow proposal. It neither calls a model nor grants authority.
 * This is a scoped, operator-invoked alternative to a failed v2 model output.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evidenceExtractionFingerprint } from '../memory-engine/evidence-bound-extraction.mjs';
import { EvidenceBoundProposalStore } from '../memory-engine/evidence-bound-proposal-store.mjs';
import { inspectMemoryTextSensitivity } from '../memory-engine/index.mjs';
import {
  inspectSource, parseAcceptanceRulesArgs,
} from './extract-memory-shadow-acceptance-rules.mjs';
import {
  requireIsolatedShadow, sanitizeShadowExtractionFailure,
} from './extract-memory-shadow-evidence.mjs';

const POLICY_VERSION = 'evidence-verbatim-selection-v1';
const EVALUATOR_ID = 'deterministic:verbatim-rule-selection-v1';
const GENERAL_HEADING = 'Harte Regeln für alle künftigen Abnahme-Prompts';
const REQUIRED_INTRO = 'Pflichtblock in jedem Abnahme-Prompt:';
const REQUIRED_LINE = '- Laufzeit im Bericht aus zeit.txt messen, nicht schätzen.';
const CANONICAL_FACT = 'Pflichtblock in jedem Abnahme-Prompt: Laufzeit im Bericht aus zeit.txt messen, nicht schätzen.';
const KIND = 'procedure';

export function parseVerbatimRuleArgs(argv = []) {
  const idx = argv.indexOf('--record-proposal');
  if (idx !== -1 && argv.lastIndexOf('--record-proposal') !== idx) {
    throw new Error('duplicate --record-proposal');
  }
  const record = idx !== -1;
  const rest = record ? argv.filter(x => x !== '--record-proposal') : argv;
  const args = parseAcceptanceRulesArgs(rest);
  if (args.runModel) throw new Error('model option not supported for verbatim rule');
  return { ...args, record };
}

function readCounts(dbPath, projectId, branch, fingerprint) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    db.exec('PRAGMA query_only=ON');
    return {
      claims: Number(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n),
      evidence: Number(db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n),
      ignored: Number(db.prepare(
        "SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch=? AND status='ignored'",
      ).get(projectId, branch).n),
      proposals: Number(db.prepare(
        'SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch=?',
      ).get(projectId, branch).n),
      existing: db.prepare(
        'SELECT id,status,policy_version FROM memory_evidence_proposals '
        + 'WHERE project_id=? AND branch=? AND fingerprint=?',
      ).get(projectId, branch, fingerprint) ?? null,
    };
  } finally { db.close(); }
}

export function selectExactAcceptanceRule(excerpt) {
  if (typeof excerpt !== 'string') throw new TypeError('verbatim source required');
  const heading = excerpt.indexOf(GENERAL_HEADING);
  const intro = excerpt.indexOf(REQUIRED_INTRO);
  const phrase = excerpt.indexOf(REQUIRED_LINE);
  if (heading < 0 || intro < heading || phrase < intro
    || excerpt.indexOf(REQUIRED_LINE, phrase + REQUIRED_LINE.length) !== -1
    || excerpt.indexOf(REQUIRED_INTRO, intro + REQUIRED_INTRO.length) !== -1) {
    throw new Error('exact future-acceptance-rule scope or quote not established');
  }
  // Both fragments are copied exactly; the only normalization removes the
  // intervening list marker. Do not infer additional duties or schedules.
  return { kind: KIND, canonicalFact: CANONICAL_FACT };
}

export function stageVerbatimAcceptanceRule({
  dbPath, projectId, branch, sourceProposalRef, record = false,
  localAppData = process.env.LOCALAPPDATA,
  Store = EvidenceBoundProposalStore,
  now = () => new Date().toISOString(),
} = {}) {
  if (![dbPath,projectId,branch,sourceProposalRef].every(x=>typeof x==='string' && x.trim())
    || typeof record !== 'boolean' || typeof now !== 'function') {
    throw new TypeError('exact Shadow scope, source and mode required');
  }
  requireIsolatedShadow(dbPath, { localAppData });
  const selected = inspectSource({ dbPath, projectId, branch, sourceProposalRef });
  const rule = selectExactAcceptanceRule(selected.source.content_redacted);
  const fingerprint = evidenceExtractionFingerprint(rule);
  const before = readCounts(dbPath, projectId, branch, fingerprint);
  const base = {
    status: 'shadow_verbatim_rule_inspected',
    scope: { projectId, branch },
    sourceProposalRef,
    selectedAuthority: 'user_direct',
    exactRuleVerifiedInSource: true,
    proposalKind: KIND,
    policyVersion: POLICY_VERSION,
    modelCalls: 0,
    claimsCreated: 0,
    sourceEvidenceRowsCreated: 0,
    protectedApproval: false,
    sourceDatabaseModifiedByTool: false,
    decisionsApplied: 0,
    proposalAlreadyExists: before.existing !== null,
  };
  if (!record) return { ...base, note: 'Read-only. --record-proposal explicitly stages one deterministic, unreviewed Shadow proposal.' };
  if (before.existing) return {
    ...base, status: 'shadow_verbatim_rule_already_exists',
    note: 'No row changed. Existing status or policy must not be overwritten.',
  };
  const store = new Store({ dbPath, inspectTextSensitivity: inspectMemoryTextSensitivity });
  let proposal;
  try {
    proposal = store.record({
      id: 'evidence-proposal:' + fingerprint,
      projectId, branch, kind: rule.kind, canonicalFact: rule.canonicalFact,
      evidenceIds: [selected.source.id],
      fingerprint, policyVersion: POLICY_VERSION,
      evaluatorId: EVALUATOR_ID, createdAt: now(),
    });
  } finally { store.close(); }
  const after = readCounts(dbPath, projectId, branch, fingerprint);
  if (!after.existing || after.existing.id !== proposal.id
    || after.existing.status !== 'pending'
    || after.existing.policy_version !== POLICY_VERSION
    || after.claims !== before.claims || after.evidence !== before.evidence
    || after.ignored !== before.ignored
    || after.proposals !== before.proposals + 1) {
    throw new Error('verbatim selection Shadow invariant failed');
  }
  return {
    ...base, status: 'shadow_verbatim_rule_staged_unreviewed',
    proposalRef: '~p' + createHash('sha256').update(proposal.id).digest('hex').slice(0,12),
    proposalsCreated: 1,
    proposalStatus: 'pending',
    note: 'Manual-scoped deterministic quote, not a model verdict or approved memory. Evidence points to the original entire user-direct session.',
  };
}

export function runVerbatimRuleCommand({
  argv = process.argv.slice(2),
  run = stageVerbatimAcceptanceRule,
  write = s => process.stdout.write(s),
} = {}) {
  try {
    const args = parseVerbatimRuleArgs(argv);
    write(JSON.stringify(run(args), null, 2) + '\n');
    return 0;
  } catch (error) {
    write(JSON.stringify({
      ...sanitizeShadowExtractionFailure(error, { modelCallAttempted: false }),
      status: 'shadow_verbatim_rule_failed',
      note: 'No model call made. Inspect the shadow inventory. Do not retry blindly.',
    }, null, 2) + '\n');
    return 2;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runVerbatimRuleCommand();
}
