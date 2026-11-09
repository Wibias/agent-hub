import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runP61OperatorProbe } from './cli/p61-observe-protected-transport.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PROJECT = 'vrznfnxzlxaavpqbzbzd';
const SOURCE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const P61_FIELDS = Object.freeze([
  'schema_version','project_ref','observed_at','completed_at',
  'source_witness_sha256','snapshot_date','refreshed_at','candidate_count',
  'http_get_requests','bounded_transport_elapsed_ms',
  'server_only_transport_verified','source_provenance_independently_attested',
  'twenty_four_hour_soak_complete','forty_eight_case_live_parity_attested',
  'production_rollback_rehearsed','activation_authorized',
  'repository_default_graph_enabled',
]);
const START_FIELDS = Object.freeze([
  'schema_version','attempt_id','started_at','project_ref',
  'source_witness_sha256','activation_authorized',
]);
const FINISH_FIELDS = Object.freeze([
  'schema_version','attempt_id','finished_at','outcome',
  'p61_report_sha256','activation_authorized',
]);

function blocked() { throw new Error('P64 protected attempt journal BLOCKED'); }
function exact(value,keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
       === JSON.stringify([...keys].sort());
}
function iso(value) {
  return typeof value === 'string' && ISO.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
function nowIso(now) {
  const t = now();
  if (!(t instanceof Date) || Number.isNaN(t.valueOf())) blocked();
  return t.toISOString();
}
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function safeDir(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.trim() !== path
    || !path || path.length > 4096) blocked();
  const root = resolve(path);
  if (root === SOURCE_ROOT || root.startsWith(SOURCE_ROOT + sep)) blocked();
  const parent = dirname(root);
  try {
    if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()
      || lstatSync(parent).isSymbolicLink()) blocked();
  } catch { blocked(); }
  return root;
}
function writeExclusive(path,body) {
  let fd;
  try {
    fd = openSync(path,'wx',0o600);
    writeFileSync(fd,body,{encoding:'utf8'});
    fsyncSync(fd);
  } catch { blocked(); }
  finally { if (fd !== undefined) closeSync(fd); }
}
function jsonLine(obj) { return JSON.stringify(obj) + '\n'; }
function safeP61(report,pin) {
  if (!exact(report,P61_FIELDS)
    || report.schema_version !== 'reference-graph.p61-protected-readonly-observation.v1'
    || report.project_ref !== PROJECT
    || !iso(report.observed_at) || !iso(report.completed_at) || !iso(report.refreshed_at)
    || report.snapshot_date !== report.observed_at.slice(0,10)
    || report.source_witness_sha256 !== pin
    || !Number.isInteger(report.candidate_count) || report.candidate_count < 1
    || report.candidate_count > 5000
    || !Number.isInteger(report.http_get_requests) || report.http_get_requests < 1
    || report.http_get_requests > 10
    || !Number.isInteger(report.bounded_transport_elapsed_ms)
    || report.bounded_transport_elapsed_ms < 0 || report.bounded_transport_elapsed_ms > 10000
    || report.server_only_transport_verified !== true
    || report.source_provenance_independently_attested !== false
    || report.twenty_four_hour_soak_complete !== false
    || report.forty_eight_case_live_parity_attested !== false
    || report.production_rollback_rehearsed !== false
    || report.activation_authorized !== false
    || report.repository_default_graph_enabled !== false) blocked();
}

/**
 * Each explicitly requested attempt gets a new private directory:
 * start.json (fsync BEFORE the P61 network probe);
 * optional p61-success.json (only after a validated successful P61 report);
 * finish.json (fsync after success or failure).
 *
 * If the process crashes, the absence of finish.json means INCOMPLETE, not
 * success. Errors are deliberately never serialized: exception messages may
 * contain credentials, URLs or source rows. Neither local fsync nor an
 * operator-owned digest independently proves remote provenance/completeness.
 *
 * The function does not schedule itself, read DB, alter runtime, or deploy.
 */
export async function runP64JournalAttempt({
  argv = [],
  env = process.env,
  probe = runP61OperatorProbe,
  now = () => new Date(),
  id = randomUUID,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 6
    || argv[0] !== '--witness-file'
    || argv[2] !== '--witness-sha256'
    || argv[4] !== '--attempt-dir'
    || typeof argv[1] !== 'string' || !argv[1] || argv[1].includes('\0')
    || argv[1].length > 4096
    || !SHA256.test(argv[3] ?? '')
    || typeof probe !== 'function' || typeof now !== 'function'
    || typeof id !== 'function') blocked();
  const root = safeDir(argv[5]);
  const startedAt = nowIso(now);
  const attemptId = id();
  if (typeof attemptId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(attemptId)) blocked();

  // A failed create prevents ANY invocation of the privileged P61 probe.
  try { mkdirSync(root,{mode:0o700,recursive:false}); }
  catch { blocked(); }
  const started = {
    schema_version:'reference-graph.p64-attempt-start.v1',
    attempt_id:attemptId,
    started_at:startedAt,
    project_ref:PROJECT,
    source_witness_sha256:argv[3],
    activation_authorized:false,
  };
  writeExclusive(resolve(root,'start.json'),jsonLine(started));

  let status = 'blocked', reportSha = null;
  try {
    let stdout = '';
    const report = await probe({
      argv:argv.slice(0,4),env,
      stdout:{write(value) {
        if (typeof value !== 'string' || stdout.length + value.length > 20000) blocked();
        stdout += value;
      }},
    });
    safeP61(report,argv[3]);
    const reportBytes = jsonLine(report);
    if (stdout !== reportBytes) blocked();
    writeExclusive(resolve(root,'p61-success.json'),reportBytes);
    reportSha = digest(reportBytes);
    status = 'passed';
  } catch {
    // Fail closed, no exception message / response / credential in evidence.
  }

  const finished = {
    schema_version:'reference-graph.p64-attempt-finish.v1',
    attempt_id:attemptId,
    finished_at:nowIso(now),
    outcome:status,
    p61_report_sha256:reportSha,
    activation_authorized:false,
  };
  // If the terminal write fails, start.json remains and must be counted
  // as an incomplete attempted operation, never silently accepted.
  writeExclusive(resolve(root,'finish.json'),jsonLine(finished));
  return {
    schema_version:'reference-graph.p64-attempt-summary.v1',
    outcome:status,
    journal_started:true,
    journal_finished:true,
    independent_attempt_completeness_attested:false,
    protected_24_hour_soak_verified:false,
    activation_authorized:false,
    repository_default_graph_enabled:false,
  };
}

function localJson(path) {
  let value;
  try {
    const st=lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink() || st.size < 10 || st.size > 20000) blocked();
    value=JSON.parse(readFileSync(path,'utf8'));
  } catch { blocked(); }
  return value;
}

/** Offline checker: incomplete starts are never counted as successful runs. */
export function inspectP64LocalAttempt({ attemptDir } = {}) {
  const root=safeDir(attemptDir);
  try {
    if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()
      || realpathSync(root)!==root) blocked();
  } catch { blocked(); }
  const files=readdirSync(root).sort();
  if (!files.includes('start.json')
    || files.some(name=>!['start.json','finish.json','p61-success.json'].includes(name))) blocked();
  const started=localJson(resolve(root,'start.json'));
  if (!exact(started,START_FIELDS)
    || started.schema_version!=='reference-graph.p64-attempt-start.v1'
    || started.project_ref!==PROJECT || !iso(started.started_at)
    || !SHA256.test(started.source_witness_sha256)
    || started.activation_authorized!==false
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(started.attempt_id)) blocked();

  let outcome='incomplete';
  if (files.includes('finish.json')) {
    const finished=localJson(resolve(root,'finish.json'));
    if (!exact(finished,FINISH_FIELDS)
      || finished.schema_version!=='reference-graph.p64-attempt-finish.v1'
      || finished.attempt_id!==started.attempt_id
      || !iso(finished.finished_at)
      || Date.parse(finished.finished_at)<Date.parse(started.started_at)
      || finished.activation_authorized!==false
      || !['passed','blocked'].includes(finished.outcome)) blocked();
    if (finished.outcome==='passed') {
      if (!files.includes('p61-success.json')
        || !SHA256.test(finished.p61_report_sha256??'')) blocked();
      const path=resolve(root,'p61-success.json');
      const report=localJson(path);
      safeP61(report,started.source_witness_sha256);
      if (digest(readFileSync(path))!==finished.p61_report_sha256) blocked();
    } else if (finished.p61_report_sha256!==null
      || files.includes('p61-success.json')) blocked();
    outcome=finished.outcome;
  }
  return {
    schema_version:'reference-graph.p64-attempt-local-inspection.v1',
    outcome,
    terminal_record_present:files.includes('finish.json'),
    independently_authenticated:false,
    complete_attempt_journal_verified:false,
    protected_24_hour_soak_verified:false,
    activation_authorized:false,
    repository_default_graph_enabled:false,
  };
}
