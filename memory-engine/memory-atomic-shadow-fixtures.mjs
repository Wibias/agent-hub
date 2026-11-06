/**
 * Public, synthetic, hand-labeled evaluation suite.
 * These examples contain no private user content or source excerpts.
 * Expected labels represent desirable *review suggestions*, not promotions.
 */
export const ATOMIC_SHADOW_FIXTURES = Object.freeze([
  {
    id: 'mixed-en',
    source: 'Add a rate limiter for the demo. In future UI reviews, always verify seeded data before declaring overlays broken. Test Bingo tonight.',
    expected: [
      { fragment: 'In future UI reviews, always verify seeded data before declaring overlays broken.', disposition: 'durable_review' },
    ],
  },
  {
    id: 'mixed-de',
    source: 'Füge das Rate-Limit hinzu. Prüfe künftig immer Overlays mit gefüllten Testdaten. Teste das Rad danach.',
    expected: [
      { fragment: 'Prüfe künftig immer Overlays mit gefüllten Testdaten.', disposition: 'durable_review' },
    ],
  },
  {
    id: 'bounded-en',
    source: 'Until the migration ends, we must keep the compatibility shim. Update the dashboard today.',
    expected: [
      { fragment: 'Until the migration ends, we must keep the compatibility shim.', disposition: 'bounded_review' },
    ],
  },
  {
    id: 'bounded-de',
    source: 'Bis zum Release müssen wir die alte API behalten. Danach entfernen wir sie.',
    expected: [
      { fragment: 'Bis zum Release müssen wir die alte API behalten.', disposition: 'bounded_review' },
    ],
  },
  {
    id: 'feedback-en',
    source: 'You judged the UI too quickly without loading fixtures. Fix the overlay this afternoon.',
    expected: [
      { fragment: 'You judged the UI too quickly without loading fixtures.', disposition: 'ambiguous_review' },
    ],
  },
  {
    id: 'feedback-de',
    source: 'Du hast es zu schnell als defekt bewertet, ohne Testdaten zu laden. Prüfe Bingo jetzt.',
    expected: [
      { fragment: 'Du hast es zu schnell als defekt bewertet, ohne Testdaten zu laden.', disposition: 'ambiguous_review' },
    ],
  },
  {
    id: 'durable-single',
    source: 'Going forward, we must require real screenshots for UI regression reviews.',
    expected: [
      { fragment: 'Going forward, we must require real screenshots for UI regression reviews.', disposition: 'durable_review' },
    ],
  },
  {
    id: 'audit-protocol',
    source: '# STRICT READ-ONLY audit\n\nAlways inspect three UI screens. Do not change application code. Report your results.',
    expected: [],
  },
  {
    id: 'scoped-audit-short',
    source: 'For this audit, do not change the code. Always verify findings before reporting them.',
    expected: [],
  },
  {
    id: 'transient',
    source: 'Fix the lobby today. Run the tests. Upload the icon.',
    expected: [],
  },
  {
    id: 'tentative',
    source: 'Maybe we should always use the new visual checklist.',
    expected: [],
  },
  {
    id: 'question',
    source: 'Should we always use Postgres?',
    expected: [],
  },
  {
    id: 'sensitive',
    source: 'Password: supersecretpassword. Going forward, always verify credentials.',
    expected: [],
  },
  {
    id: 'code-block',
    source: 'Going forward, always check these code snippets.\n\n'
      + String.fromCharCode(96).repeat(3) + 'js\nconsole.log(123)\n' + String.fromCharCode(96).repeat(3),
    expected: [],
  },
]);
