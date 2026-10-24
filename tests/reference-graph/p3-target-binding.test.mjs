import assert from 'node:assert/strict';
import test from 'node:test';

const VALID = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'abcdefghijklmnopqrst',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};

test('P3 target binding validates the dedicated Reference Graph identity', async () => {
  const { validateTargetBinding } = await import('../../reference-graph/target-binding.mjs');

  assert.deepEqual(validateTargetBinding(VALID), VALID);
  assert.throws(
    () => validateTargetBinding({ ...VALID, purpose: 'something-else' }),
    /purpose/i,
  );
  assert.throws(
    () => validateTargetBinding({ ...VALID, project_ref: 'bad_ref' }),
    /project ref/i,
  );
  assert.throws(
    () => validateTargetBinding({ ...VALID, project_name: '' }),
    /project name/i,
  );
  assert.throws(
    () => validateTargetBinding({ ...VALID, region: '' }),
    /region/i,
  );
});

test('P3 target binding accepts only the exact hosted Supabase URL for the bound ref', async () => {
  const { assertBoundSupabaseUrl } = await import('../../reference-graph/target-binding.mjs');

  assert.deepEqual(
    assertBoundSupabaseUrl({
      binding: VALID,
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co/',
    }),
    VALID,
  );
  assert.throws(
    () => assertBoundSupabaseUrl({
      binding: VALID,
      supabaseUrl: 'https://wrongref.supabase.co',
    }),
    /project ref/i,
  );
  assert.throws(
    () => assertBoundSupabaseUrl({
      binding: VALID,
      supabaseUrl: 'http://abcdefghijklmnopqrst.supabase.co',
    }),
    /https/i,
  );
  assert.throws(
    () => assertBoundSupabaseUrl({
      binding: VALID,
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co.evil.example',
    }),
    /supabase|host|project ref/i,
  );
});

test('P3 diagnostics redact supplied secret values recursively', async () => {
  const { redactDiagnostics } = await import('../../reference-graph/target-binding.mjs');

  assert.equal(
    redactDiagnostics('Bearer secret-value', ['secret-value']),
    'Bearer [redacted]',
  );
  assert.equal(
    redactDiagnostics({ message: 'failed with secret-value', nested: ['secret-value'] }, ['secret-value']),
    '{"message":"failed with [redacted]","nested":["[redacted]"]}',
  );
});
