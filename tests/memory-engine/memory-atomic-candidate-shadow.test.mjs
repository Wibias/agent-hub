import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  proposeAtomicCandidateShadows,
  summarizeAtomicCandidateShadows,
  ATOMIC_CANDIDATE_SHADOW_POLICY_VERSION,
} from '../../memory-engine/memory-atomic-candidate-shadow.mjs';

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

test('mixed temporary instructions preserve a separate future-scoped review suggestion', () => {
  const source = 'Add a rate limiter for the demo. In future UI reviews, always verify seeded data before declaring overlays broken. Test the bingo wheel tonight.';
  const result = proposeAtomicCandidateShadows(source);
  assert.equal(result.mode, 'shadow_only');
  assert.equal(result.policyVersion, ATOMIC_CANDIDATE_SHADOW_POLICY_VERSION);
  assert.equal(result.suggestions.length, 1);
  const found = result.suggestions[0];
  assert.equal(found.disposition, 'durable_review');
  assert.equal(found.reasonCode, 'explicit_future_scope');
  assert.equal(found.fragment, 'In future UI reviews, always verify seeded data before declaring overlays broken.');
  assert.equal(source.slice(found.start, found.end), found.fragment);
  assert.equal(found.fragmentHash, sha256(found.fragment));
  assert.equal(found.sourceHash, sha256(source));
  assert.equal(found.fragment.includes('rate limiter'), false);
  assert.equal(found.fragment.includes('bingo wheel'), false);
});

test('German user instruction retains an explicit durable-looking review span without task commands', () => {
  const source = 'Füge das Rate-Limit für den Test hinzu. Prüfe künftig alle OBS-Overlays mit gefüllten Testdaten. Teste danach Bingo.';
  const result = proposeAtomicCandidateShadows(source);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].disposition, 'durable_review');
  assert.equal(result.suggestions[0].fragment, 'Prüfe künftig alle OBS-Overlays mit gefüllten Testdaten.');
});

test('time-bounded project constraint remains a review suggestion, never a global rule', () => {
  const source = 'Until the migration ends, we must use the compatibility shim. Update the dashboard now.';
  const result = proposeAtomicCandidateShadows(source);
  assert.deepEqual(result.suggestions.map(s => s.disposition), ['bounded_review']);
});

test('complaints without an explicit long-term scope are ambiguous, not durable', () => {
  const source = 'You judged the overlay too quickly without testing real content. Fix the UI today.';
  const result = proposeAtomicCandidateShadows(source);
  assert.deepEqual(result.suggestions.map(s => s.disposition), ['ambiguous_review']);
  assert.equal(result.suggestions[0].fragment.includes('Fix the UI'), false);
});

test('strictly scoped read-only audit never becomes an always-read-only global policy', () => {
  const sources = [
    '# STRICT READ-ONLY audit\n\nAlways inspect code without modifying it.\n\nDo not implement anything.',
    'For this audit, do not change the code. Always verify all browser findings before submitting the audit report.',
    'For this audit, do not change the code, even if later paragraphs say always follow these rules.',
  ];
  for (const source of sources) {
    const result = proposeAtomicCandidateShadows(source);
    assert.equal(result.reason, 'scoped_audit_protocol');
    assert.equal(result.suggestions.length, 0);
  }
});

test('questions, tentative statements, one-off work and secrets never create memory proposals', () => {
  const cases = [
    'Please run the tests and fix the overlay.',
    'Should we always use Postgres?',
    'Maybe we should always review this way.',
    'Vielleicht könnten wir künftig Postgres verwenden.',
    'Password: supersecretpassword. In future, always check configs.',
    'We always use api_key=abcdefghijklmnop for deployment.',
    'For future work always check config, then edit ' + String.fromCharCode(96).repeat(3) + 'console.log("x")',
  ];
  for (const source of cases) {
    const result = proposeAtomicCandidateShadows(source);
    assert.equal(result.suggestions.length, 0, source);
  }
});

test('source authority and source size fail closed', () => {
  const value = 'In future releases, always verify regressions.';
  assert.equal(proposeAtomicCandidateShadows(value, { sourceAuthority: 'agent_inference' }).reason, 'non_user_authority');
  assert.equal(proposeAtomicCandidateShadows('   ').reason, 'empty');
  assert.equal(proposeAtomicCandidateShadows('x'.repeat(20_001)).reason, 'source_too_large');
  const longSource = new Array(30).fill('In future we must verify releases.').join(' ');
  assert.equal(proposeAtomicCandidateShadows(longSource).reason, 'too_many_segments');
});

test('UTF-16 offsets remain correct across accented and emoji text', () => {
  const source = 'Fix 🧩 today.\n\nPrüfe künftig immer alle Tests mit gültigen Daten.';
  const result = proposeAtomicCandidateShadows(source);
  assert.equal(result.suggestions.length, 1);
  const s = result.suggestions[0];
  assert.equal(source.slice(s.start,s.end), s.fragment);
  assert.equal(s.fragment, 'Prüfe künftig immer alle Tests mit gültigen Daten.');
});

test('default report has no candidate content; explicit local opt-in may show exact fragment', () => {
  const source = 'Test the dashboard today. Going forward, always verify that overlays contain test data.';
  const result = proposeAtomicCandidateShadows(source);
  const report = summarizeAtomicCandidateShadows(result);
  assert.equal(report.readOnly, true);
  assert.equal(report.promotionAllowed, false);
  assert.equal(report.mode, 'shadow_only');
  assert.equal(report.counts.durable_review, 1);
  assert.equal(JSON.stringify(report).includes('overlay'), false);
  assert.equal(JSON.stringify(report).includes('dashboard'), false);
  assert.equal(JSON.stringify(report).includes('test data'), false);
  assert.equal(report.suggestions[0].sourceHash, sha256(source));

  const explicit = summarizeAtomicCandidateShadows(result, { includeLocalText: true });
  assert.equal(explicit.suggestions[0].localSourceFragment, result.suggestions[0].fragment);
  assert.equal(explicit.suggestions[0].localSourceFragment.includes('dashboard'), false);
});
