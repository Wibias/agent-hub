import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}

test('P3 live lexical migration uses partial token overlap instead of all-term web search', () => {
  const sql = read('reference-graph/schema/004_reference_graph_lexical_overlap.sql');

  assert.match(sql, /create or replace function public\.reference_graph_lexical_candidates\b/i);
  assert.match(sql, /regexp_split_to_table\s*\(/i);
  assert.match(sql, /count\s*\(\s*distinct\s+qt\.token\s*\)/i);
  assert.match(sql, /plainto_tsquery\s*\(\s*'simple'\s*,\s*qt\.token\s*\)/i);
  assert.doesNotMatch(sql, /websearch_to_tsquery/i);
  assert.match(sql, /grant execute on function public\.reference_graph_lexical_candidates.*service_role/is);
  assert.match(sql, /revoke all on function public\.reference_graph_lexical_candidates.*anon.*authenticated/is);
});
