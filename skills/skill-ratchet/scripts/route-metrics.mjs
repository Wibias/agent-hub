#!/usr/bin/env node
// Optional deterministic analysis of externally observed real routing runs.
// This script never launches a model or qualifies a skill.
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 10000;
function fail(message) { throw new Error(message); }
function fileLines(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) fail('Expected a regular non-symlink file <= 4 MiB: ' + file);
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim() !== '');
}
function parseJsonl(file) {
  const lines = fileLines(file);
  if (lines.length > MAX_ROWS) fail('Input exceeds 10000 rows: ' + file);
  return lines.map((line, i) => {
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('Not an object');
      return row;
    } catch (err) { fail(file + ':' + (i + 1) + ': invalid JSON object (' + err.message + ')'); }
  });
}
function requiredString(value, label) {
  if (typeof value !== 'string' || value.length > 1024 || value.trim() !== value || !value) fail('Invalid ' + label);
  return value;
}
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') { options.json = true; continue; }
    if (!['--skill-root', '--observations'].includes(a) || !args[i + 1] || args[i + 1].startsWith('--') || options[a.slice(2)]) fail('Expected --skill-root <dir> --observations <file> [--json]');
    options[a.slice(2)] = args[++i];
  }
  if (!options['skill-root'] || !options.observations) fail('Expected --skill-root <dir> --observations <file> [--json]');
  return options;
}
function metrics(counts) {
  const { tp, fp, tn, fn } = counts;
  const div = (a, b) => b === 0 ? null : a / b;
  return {
    ...counts,
    accuracy: div(tp + tn, tp + fp + tn + fn),
    precision: div(tp, tp + fp),
    recall: div(tp, tp + fn),
    falseTriggerRate: div(fp, fp + tn),
  };
}
function summarize(skillRoot, observations) {
  const skill = path.basename(skillRoot);
  const cases = parseJsonl(path.join(skillRoot, 'tests', 'evals', 'cases.jsonl')).filter(row => row.category !== 'config');
  const byId = new Map();
  for (const row of cases) {
    const id = requiredString(row.id, 'canonical case ID');
    if (byId.has(id)) fail('Duplicate canonical case: ' + id);
    if (row.category !== 'must-not-trigger' && typeof row.expected_skill !== 'string') fail('Missing expected_skill for canonical case ' + id);
    byId.set(id, row.category !== 'must-not-trigger' && row.expected_skill === skill);
  }
  if (byId.size === 0) fail('No canonical non-config cases');
  const rows = parseJsonl(observations);
  if (rows.length === 0) fail('No observed routing runs');
  const runs = new Map();
  for (const row of rows) {
    const id = requiredString(row.case_id, 'case_id');
    const runId = requiredString(row.run_id, 'run_id');
    const model = requiredString(row.model, 'model');
    const revision = requiredString(row.revision, 'revision');
    const evidenceRef = requiredString(row.evidence_ref, 'evidence_ref');
    if (!/^[0-9a-f]{40}$/.test(revision)) fail('revision must be a full Git SHA in run ' + runId);
    if (!byId.has(id)) fail('Unknown canonical case ' + id);
    if (!Array.isArray(row.selected_skills) || row.selected_skills.some(x => typeof x !== 'string' || !x || x.length > 128) || new Set(row.selected_skills).size !== row.selected_skills.length) fail('Invalid selected_skills for ' + id);
    if (!runs.has(runId)) runs.set(runId, { model, revision, rows: new Map() });
    const run = runs.get(runId);
    if (run.model !== model || run.revision !== revision) fail('Mixed model/revision inside run ' + runId);
    if (run.rows.has(id)) fail('Duplicate observed case ' + id + ' in run ' + runId);
    run.rows.set(id, { chosen: row.selected_skills.includes(skill), evidence_ref: evidenceRef });
  }
  const output = [];
  const aggregate = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const [runId, run] of [...runs].sort(([a], [b]) => a.localeCompare(b))) {
    const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
    const misses = [], falseTriggers = [], missingCases = [];
    for (const [id, expected] of byId) {
      const actual = run.rows.get(id);
      if (!actual) { missingCases.push(id); continue; }
      if (expected && actual.chosen) counts.tp++;
      else if (expected) { counts.fn++; misses.push({ case_id: id, evidence_ref: actual.evidence_ref }); }
      else if (actual.chosen) { counts.fp++; falseTriggers.push({ case_id: id, evidence_ref: actual.evidence_ref }); }
      else counts.tn++;
    }
    const complete = missingCases.length === 0;
    if (complete) for (const key of Object.keys(aggregate)) aggregate[key] += counts[key];
    output.push({
      run_id: runId, model: run.model, revision: run.revision, status: complete ? 'COMPLETE' : 'INCOMPLETE',
      observed_cases: run.rows.size, expected_cases: byId.size, missing_cases: missingCases,
      metrics: complete ? metrics(counts) : null, observed_counts_only: complete ? null : counts,
      false_triggers: falseTriggers, misses,
    });
  }
  const completeRuns = output.filter(run => run.status === 'COMPLETE').length;
  return {
    status: completeRuns === 0 ? 'NO_COMPLETE_RUNS' : completeRuns === output.length ? 'DESCRIPTIVE_ONLY' : 'INCOMPLETE_RUNS_EXCLUDED',
    skill, canonical_cases: byId.size, run_count: output.length, complete_runs: completeRuns,
    summary: completeRuns ? metrics(aggregate) : null, runs: output,
    evidence_boundary: 'User-provided traces are not attested. Metrics describe supplied runs only. Not an independent model review, Skill Ratchet qualification, or release pass.',
  };
}
try {
  const opts = parseArgs(process.argv.slice(2));
  const result = summarize(path.resolve(opts['skill-root']), path.resolve(opts.observations));
  const plain = 'Skill: ' + result.skill + '\nStatus: ' + result.status + '\nComplete runs: ' + result.complete_runs + '/' + result.run_count + '\n' + (result.summary ? 'Observed accuracy: ' + result.summary.accuracy : 'No complete observations to score') + '\n';
  process.stdout.write(opts.json ? JSON.stringify(result, null, 2) + '\n' : plain);
} catch (error) {
  process.stderr.write('route-metrics: ' + error.message + '\n');
  process.exitCode = 2;
}
