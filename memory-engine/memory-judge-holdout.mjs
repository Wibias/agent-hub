const IMPORTANCE_DECISIONS = Object.freeze([
  'promote',
  'ignore',
  'keep_candidate',
  'needs_confirmation',
]);

const RELATIONS = Object.freeze([
  'same',
  'update',
  'contradict',
  'unrelated',
]);

function freezeImportanceCase({ id, language, type, value, decision, tags = [] }) {
  return Object.freeze({
    id,
    language,
    tags: Object.freeze([...tags]),
    candidate: Object.freeze({
      proposed_type: type,
      source_authority: 'user_direct',
      policy_version: 'capture-v1',
      proposed_value: value,
    }),
    expected: Object.freeze({ decision }),
  });
}

function memory(ref, value) {
  return Object.freeze({
    ref,
    value,
    authority: 'user_direct',
    state: 'active',
  });
}

function freezeRelationCase({
  id,
  language,
  type,
  originalValue,
  canonicalFact,
  memories,
  relation,
  targetRef,
  tags = [],
}) {
  return Object.freeze({
    id,
    language,
    tags: Object.freeze([...tags]),
    candidate: Object.freeze({
      proposed_type: type,
      source_authority: 'user_direct',
      proposed_value: originalValue,
      canonical_fact: canonicalFact,
    }),
    memories: Object.freeze(memories.map((item) => Object.freeze({ ...item }))),
    expected: Object.freeze({
      relation,
      target_ref: targetRef,
    }),
  });
}

export const IMPORTANCE_JUDGE_HOLDOUT_CASES = Object.freeze([
  freezeImportanceCase({
    id: 'holdout-importance-a1',
    language: 'en',
    type: 'decision',
    value: 'The API gateway stays on Fly.io, and new services go behind it too.',
    decision: 'promote',
    tags: ['implicit_durable', 'architecture'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-a2',
    language: 'de',
    type: 'constraint',
    value: "Im Backend bleibt's bei UTC; lokale Zeiten machen wir erst am Rand.",
    decision: 'promote',
    tags: ['implicit_durable', 'colloquial', 'partial_scope'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-a3',
    language: 'en',
    type: 'constraint',
    value: 'Deployments must use the credential alias PROD_DEPLOY, never raw tokens.',
    decision: 'promote',
    tags: ['sensitive_looking_non_secret', 'security'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-a4',
    language: 'de',
    type: 'preference',
    value: 'Bei Reviews wollen wir lieber einen klaren Fehlalarm als still falsche Freigaben.',
    decision: 'promote',
    tags: ['implicit_durable', 'colloquial', 'preference'],
  }),

  freezeImportanceCase({
    id: 'holdout-importance-b1',
    language: 'en',
    type: 'constraint',
    value: "Until tonight's incident is over, disable write traffic to region B.",
    decision: 'ignore',
    tags: ['transient', 'important_sounding'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-b2',
    language: 'en',
    type: 'decision',
    value: 'We decided the package version is 4.8.2 in package.json.',
    decision: 'ignore',
    tags: ['reconstructible_from_repo', 'decision_wording'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-b3',
    language: 'de',
    type: 'constraint',
    value: 'Bis einschließlich 15. Oktober 2026 bleibt das Beta-Banner immer an.',
    decision: 'ignore',
    tags: ['expiry_bounded', 'transient'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-b4',
    language: 'de',
    type: 'constraint',
    value: 'Das ist keine Dauerregel: nur für die heutige Demo begrenzen wir Räume auf vier Leute.',
    decision: 'ignore',
    tags: ['negated_durability', 'transient', 'colloquial'],
  }),

  freezeImportanceCase({
    id: 'holdout-importance-c1',
    language: 'en',
    type: 'decision',
    value: 'During the offline-first pilot, backend services use SQLite.',
    decision: 'keep_candidate',
    tags: ['medium_horizon', 'partial_scope'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-c2',
    language: 'de',
    type: 'constraint',
    value: 'Während der Migration laufen Schreibzugriffe im Dual-Write, bis der Cutover durch ist.',
    decision: 'keep_candidate',
    tags: ['medium_horizon', 'migration'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-c3',
    language: 'en',
    type: 'preference',
    value: "For this migration stretch, let's stick with pnpm.",
    decision: 'keep_candidate',
    tags: ['medium_horizon', 'colloquial'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-c4',
    language: 'de',
    type: 'decision',
    value: 'Für den laufenden Beta-Pilot speichern wir Session-Replays, bis die Pilot-Auswertung fertig ist.',
    decision: 'keep_candidate',
    tags: ['medium_horizon', 'bounded_but_useful'],
  }),

  freezeImportanceCase({
    id: 'holdout-importance-d1',
    language: 'en',
    type: 'constraint',
    value: 'That one should stay read-only from now on.',
    decision: 'needs_confirmation',
    tags: ['scope_unclear', 'missing_referent'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-d2',
    language: 'de',
    type: 'correction',
    value: 'Das benutzen wir nicht mehr.',
    decision: 'needs_confirmation',
    tags: ['negation', 'scope_unclear', 'missing_referent'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-d3',
    language: 'en',
    type: 'constraint',
    value: "Audit logs stay encrypted at rest; today I'm only checking the export job.",
    decision: 'needs_confirmation',
    tags: ['mixed_durable_transient', 'split_needed'],
  }),
  freezeImportanceCase({
    id: 'holdout-importance-d4',
    language: 'de',
    type: 'constraint',
    value: 'Vielleicht sollten wir Produktions-Uploads grundsätzlich nie löschen.',
    decision: 'needs_confirmation',
    tags: ['tentative', 'high_impact'],
  }),
]);

export const RELATION_JUDGE_HOLDOUT_CASES = Object.freeze([
  freezeRelationCase({
    id: 'holdout-relation-a1',
    language: 'en',
    type: 'constraint',
    originalValue: 'Only backend services require Node 24; the frontend does not.',
    canonicalFact: 'Backend services require Node 24, but the frontend does not.',
    memories: [
      memory('@1111111111', 'Backend services require Node 24, while the frontend remains on Node 22.'),
      memory('@1111111112', 'The whole project requires Node 24.'),
      memory('@1111111113', 'Backend services use ESM modules.'),
    ],
    relation: 'same',
    targetRef: '@1111111111',
    tags: ['scope_precision', 'broader_distractor'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-a2',
    language: 'de',
    type: 'preference',
    originalValue: 'Im Admin-UI bitte weiterhin keine Animationen.',
    canonicalFact: 'Das Admin-UI soll keine Animationen verwenden.',
    memories: [
      memory('@2222222221', 'Im Admin-UI sind Animationen zu vermeiden.'),
      memory('@2222222222', 'Im Marketing dürfen Animationen verwendet werden.'),
      memory('@2222222223', 'Das Admin-UI verwendet kompakte Tabellen.'),
    ],
    relation: 'same',
    targetRef: '@2222222221',
    tags: ['colloquial', 'scope_distractor'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-a3',
    language: 'en',
    type: 'constraint',
    originalValue: 'Production backups remain encrypted with customer-managed keys.',
    canonicalFact: 'Production backups use customer-managed encryption keys.',
    memories: [
      memory('@3333333331', 'Production backups are encrypted using customer-managed keys.'),
      memory('@3333333332', 'Staging backups use provider-managed keys.'),
      memory('@3333333333', 'Production database connections require TLS.'),
    ],
    relation: 'same',
    targetRef: '@3333333331',
    tags: ['paraphrase', 'domain_distractor'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-a4',
    language: 'de',
    type: 'decision',
    originalValue: 'Für den öffentlichen API-Zugang bleibt OAuth 2.1 Pflicht.',
    canonicalFact: 'Die öffentliche API erfordert OAuth 2.1.',
    memories: [
      memory('@4444444441', 'Für die öffentliche API ist OAuth 2.1 vorgeschrieben.'),
      memory('@4444444442', 'Interne Health-Endpunkte verwenden keine Authentifizierung.'),
      memory('@4444444443', 'OAuth-Tokens laufen nach 15 Minuten ab.'),
    ],
    relation: 'same',
    targetRef: '@4444444441',
    tags: ['paraphrase'],
  }),

  freezeRelationCase({
    id: 'holdout-relation-b1',
    language: 'en',
    type: 'correction',
    originalValue: 'Production is on MySQL now.',
    canonicalFact: 'The production database is now MySQL.',
    memories: [
      memory('@5555555551', 'The production database is Postgres.'),
      memory('@5555555552', 'The staging database is MySQL.'),
      memory('@5555555553', 'Production uses Redis for caching.'),
    ],
    relation: 'update',
    targetRef: '@5555555551',
    tags: ['implicit_update', 'scope_distractor'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-b2',
    language: 'de',
    type: 'correction',
    originalValue: 'Ab dieser Woche laufen Deployments über GitHub Actions.',
    canonicalFact: 'Deployments laufen jetzt über GitHub Actions.',
    memories: [
      memory('@6666666661', 'Deployments laufen über Jenkins.'),
      memory('@6666666662', 'GitHub Actions führt die Lint-Jobs aus.'),
      memory('@6666666663', 'Jenkins archiviert alte Build-Logs.'),
    ],
    relation: 'update',
    targetRef: '@6666666661',
    tags: ['implicit_update', 'indirect_supersession'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-b3',
    language: 'en',
    type: 'correction',
    originalValue: 'The backend is on pnpm now.',
    canonicalFact: 'The backend now uses pnpm.',
    memories: [
      memory('@7777777771', 'The project package manager is npm.'),
      memory('@7777777772', 'The backend package manager is npm.'),
      memory('@7777777773', 'The frontend package manager is pnpm.'),
      memory('@7777777774', 'CI runs dependency audits with npm.'),
    ],
    relation: 'update',
    targetRef: '@7777777772',
    tags: ['multiple_targets', 'narrow_scope'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-b4',
    language: 'de',
    type: 'correction',
    originalValue: 'Für neue Kunden gilt jetzt 45 Tage Aufbewahrung.',
    canonicalFact: 'Für neue Kunden beträgt die Aufbewahrung jetzt 45 Tage.',
    memories: [
      memory('@8888888881', 'Für neue Kunden beträgt die Aufbewahrung 30 Tage.'),
      memory('@8888888882', 'Für Bestandskunden beträgt die Aufbewahrung 45 Tage.'),
      memory('@8888888883', 'Backups werden 45 Tage aufbewahrt.'),
    ],
    relation: 'update',
    targetRef: '@8888888881',
    tags: ['implicit_update', 'scope_distractor'],
  }),

  freezeRelationCase({
    id: 'holdout-relation-c1',
    language: 'en',
    type: 'constraint',
    originalValue: 'The production database must use MySQL.',
    canonicalFact: 'Production must use MySQL as its database.',
    memories: [
      memory('@9999999991', 'The production database must use Postgres.'),
      memory('@9999999992', 'The staging database uses MySQL.'),
      memory('@9999999993', 'Production cache storage uses Redis.'),
    ],
    relation: 'contradict',
    targetRef: '@9999999991',
    tags: ['same_scope_different_value', 'no_replacement_intent'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-c2',
    language: 'en',
    type: 'constraint',
    originalValue: 'The public API must not allow password authentication.',
    canonicalFact: 'Password authentication is forbidden on the public API.',
    memories: [
      memory('@aaaaaaaaa1', 'The public API allows password authentication.'),
      memory('@aaaaaaaaa2', 'The admin console requires MFA.'),
      memory('@aaaaaaaaa3', 'Public API access tokens expire after 15 minutes.'),
    ],
    relation: 'contradict',
    targetRef: '@aaaaaaaaa1',
    tags: ['negation', 'incompatible'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-c3',
    language: 'de',
    type: 'constraint',
    originalValue: 'Alle Services müssen UTC verwenden.',
    canonicalFact: 'Alle Services müssen UTC verwenden.',
    memories: [
      memory('@bbbbbbbbb1', 'Backend-Services müssen lokale Serverzeit verwenden.'),
      memory('@bbbbbbbbb2', 'Frontend-Zeitstempel werden in UTC gespeichert.'),
      memory('@bbbbbbbbb3', 'Alle Services verwenden strukturierte Logs.'),
    ],
    relation: 'contradict',
    targetRef: '@bbbbbbbbb1',
    tags: ['broader_scope', 'partial_overlap'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-c4',
    language: 'de',
    type: 'constraint',
    originalValue: 'Security-Audit-Logs dürfen niemals länger als 14 Tage liegen bleiben.',
    canonicalFact: 'Security-Audit-Logs dürfen höchstens 14 Tage aufbewahrt werden.',
    memories: [
      memory('@ccccccccc1', 'Security-Audit-Logs müssen 30 Tage aufbewahrt werden.'),
      memory('@ccccccccc2', 'Produktanalyse-Daten werden 14 Tage aufbewahrt.'),
      memory('@ccccccccc3', 'Security-Audit-Logs sind unveränderlich.'),
    ],
    relation: 'contradict',
    targetRef: '@ccccccccc1',
    tags: ['contradicts_one', 'domain_distractors'],
  }),

  freezeRelationCase({
    id: 'holdout-relation-d1',
    language: 'en',
    type: 'decision',
    originalValue: 'Staging uses Redis for session storage.',
    canonicalFact: 'Staging session storage uses Redis.',
    memories: [
      memory('@ddddddddd1', 'Production session storage uses Redis.'),
      memory('@ddddddddd2', 'Staging uses Postgres for its database.'),
      memory('@ddddddddd3', 'Redis keys expire after 24 hours in production.'),
    ],
    relation: 'unrelated',
    targetRef: null,
    tags: ['same_value_different_scope', 'hard_negative'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-d2',
    language: 'en',
    type: 'constraint',
    originalValue: 'For releases from 2027 onward, audit logs are retained for 60 days.',
    canonicalFact: 'Audit logs for releases from 2027 onward are retained for 60 days.',
    memories: [
      memory('@eeeeeeeee1', 'For releases through 2026, audit logs are retained for 30 days.'),
      memory('@eeeeeeeee2', 'Backups are retained for 60 days.'),
      memory('@eeeeeeeee3', 'Audit logs are encrypted at rest.'),
    ],
    relation: 'unrelated',
    targetRef: null,
    tags: ['disjoint_time_scope', 'hard_negative'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-d3',
    language: 'de',
    type: 'constraint',
    originalValue: 'Die Lockfile-Datei muss eingecheckt bleiben.',
    canonicalFact: 'Die Lockfile-Datei muss im Repository eingecheckt sein.',
    memories: [
      memory('@fffffffff1', 'Der Package Manager ist pnpm.'),
      memory('@fffffffff2', 'CI installiert Abhängigkeiten mit --frozen-lockfile.'),
      memory('@fffffffff3', 'Node.js 24 ist erforderlich.'),
    ],
    relation: 'unrelated',
    targetRef: null,
    tags: ['semantic_neighbour', 'hard_negative'],
  }),
  freezeRelationCase({
    id: 'holdout-relation-d4',
    language: 'de',
    type: 'constraint',
    originalValue: 'Das Backend braucht Node 24.',
    canonicalFact: 'Das Backend benötigt Node 24.',
    memories: [
      memory('@abcdeabc01', 'Das Frontend benötigt Node 24.'),
      memory('@abcdeabc02', 'Das Backend verwendet ESM.'),
      memory('@abcdeabc03', 'Node-Abhängigkeiten werden wöchentlich aktualisiert.'),
    ],
    relation: 'unrelated',
    targetRef: null,
    tags: ['same_value_different_scope', 'hard_negative'],
  }),
]);

function safeRatio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function indexPredictions(predictions) {
  if (!Array.isArray(predictions)) {
    throw new TypeError('predictions must be an array');
  }
  const byId = new Map();
  let duplicates = 0;
  for (const prediction of predictions) {
    if (
      !prediction
      || typeof prediction !== 'object'
      || Array.isArray(prediction)
      || typeof prediction.id !== 'string'
      || prediction.id.length === 0
    ) {
      continue;
    }
    if (byId.has(prediction.id)) duplicates += 1;
    else byId.set(prediction.id, prediction);
  }
  return { byId, duplicates };
}

function scoreImportance(predictions, cases) {
  const indexed = indexPredictions(predictions);
  const confusion = Object.fromEntries(
    IMPORTANCE_DECISIONS.map((expected) => [
      expected,
      Object.fromEntries([...IMPORTANCE_DECISIONS, 'invalid'].map((actual) => [actual, 0])),
    ]),
  );

  let exactCorrect = 0;
  let invalid = indexed.duplicates;
  let expectedPromotions = 0;
  let predictedPromotions = 0;
  let truePromotions = 0;
  let falsePromotions = 0;
  let highConfidenceWrong = 0;
  const caseFailures = [];

  for (const caseSpec of cases) {
    const expected = caseSpec.expected.decision;
    if (expected === 'promote') expectedPromotions += 1;
    const prediction = indexed.byId.get(caseSpec.id);
    const actual = prediction?.ok === true && IMPORTANCE_DECISIONS.includes(prediction.decision)
      ? prediction.decision
      : 'invalid';

    confusion[expected][actual] += 1;
    if (actual === 'invalid') {
      invalid += 1;
      caseFailures.push({ id: caseSpec.id, expected, actual: 'invalid', confidence: prediction?.confidence ?? null });
      continue;
    }

    if (actual === expected) exactCorrect += 1;
    else {
      if (prediction.confidence === 'high') highConfidenceWrong += 1;
      caseFailures.push({ id: caseSpec.id, expected, actual, confidence: prediction.confidence ?? null });
    }

    if (actual === 'promote') {
      predictedPromotions += 1;
      if (expected === 'promote') truePromotions += 1;
      else falsePromotions += 1;
    }
  }

  return {
    total: cases.length,
    exact_correct: exactCorrect,
    exact_accuracy: safeRatio(exactCorrect, cases.length),
    expected_promotions: expectedPromotions,
    predicted_promotions: predictedPromotions,
    true_promotions: truePromotions,
    false_promotions: falsePromotions,
    promote_precision: safeRatio(truePromotions, predictedPromotions),
    promote_recall: safeRatio(truePromotions, expectedPromotions),
    high_confidence_wrong: highConfidenceWrong,
    invalid_outputs: invalid,
    confusion,
    case_failures: caseFailures,
  };
}

function scoreRelation(predictions, cases) {
  const indexed = indexPredictions(predictions);
  const confusion = Object.fromEntries(
    RELATIONS.map((expected) => [
      expected,
      Object.fromEntries([...RELATIONS, 'invalid'].map((actual) => [actual, 0])),
    ]),
  );

  let exactCorrect = 0;
  let invalid = indexed.duplicates;
  let highConfidenceWrong = 0;
  let relatedExpected = 0;
  let targetCorrect = 0;
  let targetErrors = 0;
  const caseFailures = [];

  for (const caseSpec of cases) {
    const expected = caseSpec.expected;
    if (expected.relation !== 'unrelated') relatedExpected += 1;
    const prediction = indexed.byId.get(caseSpec.id);
    const valid = (
      prediction?.ok === true
      && RELATIONS.includes(prediction.relation)
      && (
        prediction.target_ref === null
        || (typeof prediction.target_ref === 'string' && /^@[0-9a-f]{10}$/u.test(prediction.target_ref))
      )
    );
    const actual = valid ? prediction.relation : 'invalid';
    confusion[expected.relation][actual] += 1;

    if (!valid) {
      invalid += 1;
      caseFailures.push({
        id: caseSpec.id,
        expected_relation: expected.relation,
        expected_target_ref: expected.target_ref,
        actual_relation: 'invalid',
        actual_target_ref: prediction?.target_ref ?? null,
        confidence: prediction?.confidence ?? null,
      });
      continue;
    }

    const exact = prediction.relation === expected.relation && prediction.target_ref === expected.target_ref;
    if (exact) exactCorrect += 1;
    else {
      if (prediction.confidence === 'high') highConfidenceWrong += 1;
      caseFailures.push({
        id: caseSpec.id,
        expected_relation: expected.relation,
        expected_target_ref: expected.target_ref,
        actual_relation: prediction.relation,
        actual_target_ref: prediction.target_ref,
        confidence: prediction.confidence ?? null,
      });
    }

    if (expected.relation !== 'unrelated') {
      if (prediction.target_ref === expected.target_ref) targetCorrect += 1;
      else targetErrors += 1;
    }
  }

  return {
    total: cases.length,
    exact_correct: exactCorrect,
    exact_accuracy: safeRatio(exactCorrect, cases.length),
    related_expected: relatedExpected,
    target_correct: targetCorrect,
    target_errors: targetErrors,
    target_accuracy: safeRatio(targetCorrect, relatedExpected),
    high_confidence_wrong: highConfidenceWrong,
    invalid_outputs: invalid,
    confusion,
    case_failures: caseFailures,
  };
}

export function scoreMemoryJudgeHoldout({
  importancePredictions,
  relationPredictions,
  importanceCases = IMPORTANCE_JUDGE_HOLDOUT_CASES,
  relationCases = RELATION_JUDGE_HOLDOUT_CASES,
} = {}) {
  if (!Array.isArray(importanceCases) || importanceCases.length === 0) {
    throw new TypeError('importanceCases must be a non-empty array');
  }
  if (!Array.isArray(relationCases) || relationCases.length === 0) {
    throw new TypeError('relationCases must be a non-empty array');
  }

  const importance = scoreImportance(importancePredictions, importanceCases);
  const relation = scoreRelation(relationPredictions, relationCases);
  const invalidOutputs = importance.invalid_outputs + relation.invalid_outputs;
  const failures = [];
  if (invalidOutputs > 0) failures.push('invalid_outputs');
  if (importance.false_promotions > 0) failures.push('importance_false_promotions');
  if (importance.high_confidence_wrong > 0) failures.push('importance_high_confidence_wrong');
  if (relation.high_confidence_wrong > 0) failures.push('relation_high_confidence_wrong');

  return {
    fixture: {
      importance_cases: importanceCases.length,
      relation_cases: relationCases.length,
      total_cases: importanceCases.length + relationCases.length,
    },
    importance,
    relation,
    invalid_outputs: invalidOutputs,
    case_failures: [...importance.case_failures, ...relation.case_failures],
    quality_gate: {
      pass: failures.length === 0,
      failures,
    },
  };
}
