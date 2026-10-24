import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SQL = readFileSync(
  new URL('../../reference-graph/schema/010_reference_graph_activation_grant_consumption.sql', import.meta.url),
  'utf8',
);

test('P16 migration creates a minimal private one-shot activation grant ledger', () => {
  assert.match(SQL, /create table if not exists reference_graph\.activation_grant_consumptions_p16/i);
  assert.match(SQL, /nonce\s+text\s+primary key/i);
  assert.match(SQL, /consumption_id\s+uuid\s+not null\s+unique\s+default\s+gen_random_uuid\(\)/i);
  assert.match(SQL, /grant_payload_hash\s+text\s+not null/i);
  assert.match(SQL, /request_hash\s+text\s+not null/i);
  assert.match(SQL, /authority_hash\s+text\s+not null/i);
  assert.match(SQL, /consumed_at\s+timestamptz\s+not null\s+default\s+clock_timestamp\(\)/i);

  for (const column of ['nonce', 'grant_payload_hash', 'request_hash', 'authority_hash']) {
    assert.match(SQL, new RegExp(`check\\s*\\(\\s*${column}\\s*~\\s*'\\^\\[0-9a-f\\]\\{64\\}\\$'\\s*\\)`, 'i'));
  }

  const tableDefinition = SQL.match(/create table if not exists reference_graph\.activation_grant_consumptions_p16\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';
  assert.doesNotMatch(
    tableDefinition,
    /^\s*(?:signature|signature_base64|private_key|public_key|raw_grant|grant_json|authorization|activation_authorized)\s+/im,
  );
});

test('P16 consume RPC is atomic, replay-safe, and does not disclose old consumption data', () => {
  assert.match(SQL, /create or replace function public\.reference_graph_consume_activation_grant_nonce_p16\s*\(/i);
  assert.match(SQL, /p_nonce\s+text/i);
  assert.match(SQL, /p_grant_payload_hash\s+text/i);
  assert.match(SQL, /p_request_hash\s+text/i);
  assert.match(SQL, /p_authority_hash\s+text/i);
  assert.match(SQL, /returns\s+jsonb/i);
  assert.match(SQL, /security definer/i);
  assert.match(SQL, /set search_path\s*=\s*pg_catalog,\s*reference_graph/i);
  assert.match(SQL, /set statement_timeout\s*=\s*'5s'/i);

  for (const input of ['p_nonce', 'p_grant_payload_hash', 'p_request_hash', 'p_authority_hash']) {
    assert.match(SQL, new RegExp(`${input}\\s*!~\\s*'\\^\\[0-9a-f\\]\\{64\\}\\$'`, 'i'));
  }

  assert.match(SQL, /insert into reference_graph\.activation_grant_consumptions_p16/i);
  assert.match(SQL, /on conflict\s*\(nonce\)\s*do nothing/i);
  assert.match(SQL, /returning\s+consumption_id/i);
  assert.match(SQL, /jsonb_build_object\(\s*'consumed',\s*true,\s*'consumption_id',\s*v_consumption_id::text\s*\)/i);
  assert.match(SQL, /jsonb_build_object\(\s*'consumed',\s*false,\s*'consumption_id',\s*null\s*\)/i);
});

test('P16 ledger and RPC expose no unprivileged authority', () => {
  assert.match(SQL, /revoke all on table reference_graph\.activation_grant_consumptions_p16\s+from public, anon, authenticated, service_role/i);
  assert.match(SQL, /revoke all on function public\.reference_graph_consume_activation_grant_nonce_p16\(text, text, text, text\)\s+from public, anon, authenticated, service_role/i);
  assert.match(SQL, /grant execute on function public\.reference_graph_consume_activation_grant_nonce_p16\(text, text, text, text\)\s+to service_role/i);
  assert.doesNotMatch(SQL, /grant\s+(?:select|insert|update|delete|all).*activation_grant_consumptions_p16.*(?:anon|authenticated)/i);
});
