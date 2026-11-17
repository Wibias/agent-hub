#!/usr/bin/env node
// Disposable Windows SCM CI ONLY. A consistent SQLite online backup taken
// BEFORE any private read. Never run on an operator's personal memory DB.
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform!=='win32'
    ||process.env.GITHUB_ACTIONS!=='true'
    ||process.env.RUNNER_OS!=='Windows'
    ||!process.env.ProgramData
    ||!process.env.RUNNER_TEMP
    ||process.argv.length!==2)
  throw Error('ci_sqlite_online_snapshot_forbidden');

const from=join(process.env.ProgramData,'AgentHubMemoryReviewLab-State',
  'review-authority.sqlite3');
const to=join(process.env.RUNNER_TEMP,
  'AgentHubMemoryReviewLab-PreRead-Baseline.sqlite3');
if (!existsSync(from)||existsSync(to))
  throw Error('ci_sqlite_baseline_missing_or_preexists');
const source=new DatabaseSync(from,{readOnly:true});
try {
  const receipts=source.prepare(
    'SELECT COUNT(*) AS n FROM protected_ci_read_once_receipts').get().n;
  const revocations=source.prepare(
    'SELECT COUNT(*) AS n FROM protected_ci_read_once_revocations').get().n;
  if(receipts!==0||revocations!==0)
    throw Error('ci_sqlite_baseline_already_contains_one_shot_authority');
  await backup(source,to);
} finally {
  source.close();
}
const saved=new DatabaseSync(to,{readOnly:true});
try {
  if(saved.prepare('SELECT COUNT(*) AS n FROM protected_ci_read_once_receipts').get().n!==0
    ||saved.prepare('SELECT COUNT(*) AS n FROM protected_ci_read_once_revocations').get().n!==0)
    throw Error('ci_sqlite_baseline_mismatch');
} finally {
  saved.close();
}
process.stdout.write(JSON.stringify({
  status:'ci_pre_read_sqlite_online_backup_exact_empty_journal',
  receipt_rows:0,revocation_rows:0,production_authorized:false,
})+'\n');
