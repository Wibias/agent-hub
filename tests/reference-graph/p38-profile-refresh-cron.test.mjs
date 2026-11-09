import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const path = new URL('../../reference-graph/schema/015_reference_graph_profile_refresh_cron_p38.sql', import.meta.url);
const sql = readFileSync(path, 'utf8');

test('P38 schedules only P31 profile refresh every two UTC hours with 5-minute retry', () => {
  assert.match(sql, /cron\.schedule\s*\(\s*'reference-graph-p31-profile-refresh'\s*,\s*'0,5 \*\/2 \* \* \*'/i);
  assert.match(sql, /\$job\$select public\.reference_graph_refresh_profile_runtime_projection_p31\(\);\$job\$/i);
  assert.match(sql, /to_regclass\('public\.reference_graph_profile_runtime_projection_p30_v1'\)/i);
  assert.match(sql, /to_regprocedure\('public\.reference_graph_refresh_profile_runtime_projection_p31\(\)'\)/i);
  assert.match(sql, /cron\.job/i);
  assert.match(sql, /job already exists/i);
});

test('P38 never widens privileges or touches production routing, Quick, or network', () => {
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b|\btruncate\b|\bdelete\b|\bupdate\b|\bdrop\b|\bunschedule\b|\bcron\.alter_job\b/i);
  assert.doesNotMatch(sql, /reference_graph_quick_runtime_projection_p10|reference_graph_refresh_quick_runtime_projection_p10|p11-runtime|pg_net|https?:\/\//i);
  assert.doesNotMatch(sql, /service_role|sb_publishable_|SUPABASE_(?:SECRET|SERVICE|ANON)_KEY/i);
});
