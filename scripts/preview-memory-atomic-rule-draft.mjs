#!/usr/bin/env node
/**
 * D12.3 operator-authored local rule draft preview.
 * No write-capable DB handle, no model calls, no source or draft text output.
 * A CLI preview never counts as direct-user confirmation.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAtomicReviewArgs, inspectAtomicReviewDb } from './inspect-memory-atomic-review.mjs';
import { previewAtomicRuleDraft } from '../memory-engine/memory-atomic-rule-draft.mjs';

export function parseAtomicRuleDraftArgs(argv = []) {
  const seen = new Set();
  let draftFile = null;
  const inherited = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate option');
    seen.add(flag);
    if (flag === '--draft-file') {
      const value = argv[++i];
      if (typeof value !== 'string' || !value.trim()) throw new Error('missing draft file');
      draftFile = resolve(value);
      continue;
    }
    if (flag === '--show-local-content' || flag === '--intent') throw new Error('unsupported option');
    if (!['--db-path','--project-id','--branch','--limit','--candidate-ref','--review-refs'].includes(flag)) {
      throw new Error('unsupported option');
    }
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim()) throw new Error('missing option value');
    inherited.push(flag, value);
  }
  if (!draftFile) throw new Error('--draft-file is required');
  const parsed = parseAtomicReviewArgs([...inherited, '--intent', 'retain_for_confirmation']);
  if (!parsed.candidateRef || !parsed.reviewRefs) {
    throw new Error('candidate and review references required');
  }
  return { ...parsed, draftFile };
}

export async function inspectAtomicRuleDraftFile({
  dbPath, projectId, branch, limit = 20,
  candidateRef, reviewRefs, draftFile,
  readLocalFile = readFile,
  statLocalFile = stat,
  inspectDb = inspectAtomicReviewDb,
} = {}) {
  if (typeof draftFile !== 'string' || !draftFile.trim()) {
    throw new Error('draft file required');
  }
  const fileInfo = await statLocalFile(draftFile);
  if (!fileInfo.isFile() || fileInfo.size > 2048 || fileInfo.size === 0) {
    throw new Error('draft file size or type is invalid');
  }
  const draftText = await readLocalFile(draftFile, 'utf8');
  // Recompute the provenance report on each invocation. Never accept a
  // stale JSON report or a caller-supplied unverified candidate row.
  const report = inspectDb({
    dbPath, projectId, branch, limit,
    showLocalContent: false,
  });
  return previewAtomicRuleDraft({ report, candidateRef, reviewRefs, draftText });
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  try {
    const result = await inspectAtomicRuleDraftFile(parseAtomicRuleDraftArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error('Atomic rule draft preview unavailable: verify input and source evidence.');
    process.exitCode = 1;
  }
}
