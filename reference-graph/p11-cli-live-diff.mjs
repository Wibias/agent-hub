import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const c = JSON.parse(fs.readFileSync(new URL('./shadow-cases.json', import.meta.url), 'utf8'))[0];
const queryCli = new URL('../knowledge/design-references/scripts/query.mjs', import.meta.url);
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();

function args() {
  return [
    queryCli.pathname,
    '--profile', c.profile,
    '--limit', String(c.limit),
    '--surface', c.surface,
    '--platform', c.platform,
    '--job', c.job,
    '--dimensions', c.dimensions,
    '--no-record-usage',
  ];
}

function run(envPatch) {
  const env = { ...process.env, ...envPatch };
  for (const key of ['REFERENCE_GRAPH_QUICK_RUNTIME', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']) {
    if (envPatch[key] === null) delete env[key];
  }
  const proc = spawnSync(process.execPath, args(), { env, encoding: 'utf8', timeout: 15000 });
  if (proc.error) throw proc.error;
  if (![0, 2].includes(proc.status)) throw new Error(proc.stderr || proc.stdout);
  return JSON.parse(proc.stdout);
}

function firstDiff(a, b, path = '$') {
  if (Object.is(a, b)) return null;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return { path, left: a, right: b };
    if (a.length !== b.length) return { path: `${path}.length`, left: a.length, right: b.length };
    for (let i = 0; i < a.length; i += 1) {
      const diff = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      if (!(key in a) || !(key in b)) return { path: `${path}.${key}`, left: a[key], right: b[key] };
      const diff = firstDiff(a[key], b[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  return { path, left: a, right: b };
}

const legacy = run({
  REFERENCE_GRAPH_QUICK_RUNTIME: null,
  SUPABASE_URL: null,
  SUPABASE_PUBLISHABLE_KEY: null,
});
const graph = run({
  REFERENCE_GRAPH_QUICK_RUNTIME: 'graph',
  SUPABASE_URL: supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
});

console.log(JSON.stringify({
  case_id: c.id,
  first_diff: firstDiff(legacy, graph),
  legacy_record_ids: legacy.records.map((row) => row.id),
  graph_record_ids: graph.records.map((row) => row.id),
  legacy_pattern_ids: legacy.patterns.map((row) => row.id),
  graph_pattern_ids: graph.patterns.map((row) => row.id),
  legacy_counts: legacy.countsByStratum,
  graph_counts: graph.countsByStratum,
  legacy_coverage: legacy.coverage,
  graph_coverage: graph.coverage,
}, null, 2));
