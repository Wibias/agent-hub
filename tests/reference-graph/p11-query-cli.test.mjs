import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { selectPatterns } from '../../knowledge/design-references/scripts/pattern-selection.mjs';
import { selectRecords } from '../../knowledge/design-references/scripts/selection.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const queryPath = path.join(root, 'knowledge/design-references/scripts/query.mjs');
const querySource = readFileSync(queryPath, 'utf8');
const cases = JSON.parse(readFileSync(path.join(root, 'reference-graph/shadow-cases.json'), 'utf8'));
const quickCase = cases.find((row) => row.profile === 'quick');

function argsFor(row, profile = row.profile, limit = row.limit) {
  return [
    '--profile', profile,
    '--limit', String(limit),
    '--surface', row.surface,
    '--platform', row.platform,
    '--job', row.job,
    '--dimensions', row.dimensions,
    '--no-record-usage',
  ];
}

function runQuery(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.REFERENCE_GRAPH_QUICK_RUNTIME;
  delete env.SUPABASE_URL;
  delete env.SUPABASE_PUBLISHABLE_KEY;
  Object.assign(env, extraEnv);
  const stdout = execFileSync(process.execPath, [queryPath, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

function ids(rows) {
  return rows.map((row) => row.id);
}

test('production query delegates runtime authority and usage to P11 router', () => {
  assert.match(querySource, /runP11RuntimeQuery/);
  assert.match(querySource, /fetchP10QuickCandidatePool/);
  assert.doesNotMatch(querySource, /import\s*\{[^}]*\bselectRecords\b[^}]*\}/s);
  assert.doesNotMatch(querySource, /import\s*\{[^}]*\brecordUsage\b[^}]*\}/s);
  assert.doesNotMatch(querySource, /\bselectRecords\s*\(/);
  assert.doesNotMatch(querySource, /\brecordUsage\s*\(/);
});

test('default-off quick CLI remains public-output equivalent to direct legacy selection', () => {
  const output = runQuery(argsFor(quickCase));
  const request = {
    profile: quickCase.profile,
    limit: quickCase.limit,
    surface: quickCase.surface,
    platform: quickCase.platform,
    job: quickCase.job,
    dimensions: quickCase.dimensions,
  };
  const selection = selectRecords(loadRecords(), request);
  const patternRows = selectPatterns(loadPatterns(), selection.selected, request);

  assert.deepEqual(ids(output.records), ids(selection.selected));
  assert.deepEqual(ids(output.patterns), ids(patternRows));
  assert.deepEqual(Object.keys(output).sort(), [
    'profile', 'requested', 'countsByStratum', 'coverage', 'coverageGaps',
    'requiresTargetedResearch', 'usageWarning', 'records', 'patterns',
  ].sort());
  assert.equal('routing' in output, false);
  assert.equal('production_source' in output, false);
});

test('production query activation is exact quick graph mode with publishable config only', () => {
  assert.match(querySource, /REFERENCE_GRAPH_QUICK_RUNTIME/);
  assert.match(querySource, /SUPABASE_URL/);
  assert.match(querySource, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(querySource, /request\.profile\s*===\s*['"]quick['"]/);
  assert.match(querySource, /graphMode\s*===\s*['"]graph['"]/);
  assert.match(querySource, /timeoutMs\s*:\s*1500/);
  assert.match(querySource, /expectedDate/);
  assert.doesNotMatch(querySource, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});

test('standard and deep public CLI remain legacy-only with graph env present', () => {
  for (const [profile, limit] of [['standard', 8], ['deep', 20]]) {
    const output = runQuery(argsFor(quickCase, profile, limit), {
      REFERENCE_GRAPH_QUICK_RUNTIME: 'graph',
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-test-only',
    });
    assert.equal(output.profile, profile);
    assert.equal('routing' in output, false);
    assert.ok(output.records.length > 0);
  }
});

test('query source prints only router result and derives exit semantics from returned coverage gaps', () => {
  assert.match(querySource, /JSON\.stringify\(result/);
  assert.match(querySource, /result\.coverageGaps\.length/);
  assert.doesNotMatch(querySource, /JSON\.stringify\([^\n]*(?:routing|authoritative_source)/);
});
