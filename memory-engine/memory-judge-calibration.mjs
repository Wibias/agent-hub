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

function freezeImportanceCase({
  id,
  language,
  type,
  value,
  decision,
  tags = [],
}) {
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
    expected: Object.freeze({
      decision,
    }),
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

export const IMPORTANCE_JUDGE_CALIBRATION_CASES = Object.freeze([
  freezeImportanceCase({
    id: 'importance-promote-production-database-en',
    language: 'en',
    type: 'decision',
    value: 'We decided to use Postgres as the production database for all services.',
    decision: 'promote',
    tags: ['durable', 'architecture'],
  }),
  freezeImportanceCase({
    id: 'importance-promote-free-tier-de',
    language: 'de',
    type: 'constraint',
    value: 'Wir müssen für dieses Projekt im GitHub-Free-Tier bleiben; CI darf keine kostenpflichtigen Runner voraussetzen.',
    decision: 'promote',
    tags: ['durable', 'constraint'],
  }),
  freezeImportanceCase({
    id: 'importance-promote-ui-preference-en',
    language: 'en',
    type: 'preference',
    value: 'For future UI work in this product, avoid gradients and oversized decorative icons.',
    decision: 'promote',
    tags: ['durable', 'preference'],
  }),
  freezeImportanceCase({
    id: 'importance-promote-exporter-issue-de',
    language: 'de',
    type: 'known_issue',
    value: 'Bekanntes dauerhaftes Problem: Der Legacy-Exporter verliert Zeitzoneninformationen; bis zur Migration müssen Exporte UTC erzwingen.',
    decision: 'promote',
    tags: ['durable', 'known_issue'],
  }),

  freezeImportanceCase({
    id: 'importance-ignore-one-run-port-en',
    language: 'en',
    type: 'decision',
    value: 'For this one test run, use port 4317.',
    decision: 'ignore',
    tags: ['transient'],
  }),
  freezeImportanceCase({
    id: 'importance-ignore-today-branch-de',
    language: 'de',
    type: 'decision',
    value: 'Heute teste ich nur den Branch feat/login-retry und gehe danach zurück auf main.',
    decision: 'ignore',
    tags: ['transient'],
  }),
  freezeImportanceCase({
    id: 'importance-ignore-reconstructible-version-en',
    language: 'en',
    type: 'known_issue',
    value: 'The package.json currently contains version 2.4.1.',
    decision: 'ignore',
    tags: ['reconstructible_from_repo'],
  }),
  freezeImportanceCase({
    id: 'importance-ignore-current-ci-failure-de',
    language: 'de',
    type: 'known_issue',
    value: 'Der aktuelle CI-Lauf ist rot, weil Test 17 gerade fehlschlägt.',
    decision: 'ignore',
    tags: ['transient'],
  }),

  freezeImportanceCase({
    id: 'importance-keep-pnpm-en',
    language: 'en',
    type: 'decision',
    value: 'We may standardize on pnpm later if the migration stays simple.',
    decision: 'keep_candidate',
    tags: ['tentative'],
  }),
  freezeImportanceCase({
    id: 'importance-keep-player-limit-de',
    language: 'de',
    type: 'constraint',
    value: 'Vielleicht sollten neue Spielmodule künftig maximal sechs Spieler unterstützen.',
    decision: 'keep_candidate',
    tags: ['tentative'],
  }),
  freezeImportanceCase({
    id: 'importance-keep-log-preference-en',
    language: 'en',
    type: 'preference',
    value: 'I usually prefer terse logs, but I am not sure this project should enforce that.',
    decision: 'keep_candidate',
    tags: ['tentative', 'scope_unclear'],
  }),
  freezeImportanceCase({
    id: 'importance-keep-enterprise-retention-de',
    language: 'de',
    type: 'decision',
    value: 'Eventuell brauchen wir für große Kunden später 90 Tage Audit-Logs.',
    decision: 'keep_candidate',
    tags: ['tentative'],
  }),

  freezeImportanceCase({
    id: 'importance-confirm-postgres-scope-en',
    language: 'en',
    type: 'decision',
    value: 'Use Postgres.',
    decision: 'needs_confirmation',
    tags: ['scope_unclear'],
  }),
  freezeImportanceCase({
    id: 'importance-confirm-log-scope-de',
    language: 'de',
    type: 'constraint',
    value: 'Wir behalten Logs 30 Tage.',
    decision: 'needs_confirmation',
    tags: ['scope_unclear'],
  }),
  freezeImportanceCase({
    id: 'importance-confirm-sensitive-token-en',
    language: 'en',
    type: 'known_issue',
    value: 'The production API token is sk_live_example_secret_value and we need it for deploys.',
    decision: 'needs_confirmation',
    tags: ['sensitive'],
  }),
  freezeImportanceCase({
    id: 'importance-confirm-global-retention-de',
    language: 'de',
    type: 'constraint',
    value: 'Wir sollten Audit-Daten niemals löschen.',
    decision: 'needs_confirmation',
    tags: ['scope_unclear', 'high_impact'],
  }),
]);

export const RELATION_JUDGE_CALIBRATION_CASES = Object.freeze([
  freezeRelationCase({
    id: 'relation-same-production-db-en',
    language: 'en',
    type: 'decision',
    originalValue: 'We decided that production uses Postgres.',
    canonicalFact: 'The production database is Postgres.',
    memories: [
      memory('@0000000001', 'The production database uses Postgres.'),
      memory('@0000000002', 'Redis is used for ephemeral caching.'),
      memory('@0000000003', 'Security audit logs are retained for 30 days.'),
    ],
    relation: 'same',
    targetRef: '@0000000001',
    tags: ['paraphrase'],
  }),
  freezeRelationCase({
    id: 'relation-same-ui-gradients-de',
    language: 'de',
    type: 'preference',
    originalValue: 'Bei der Produktoberfläche bitte keine Gradients verwenden.',
    canonicalFact: 'Die Produktoberfläche soll keine Gradients verwenden.',
    memories: [
      memory('@0000000011', 'Für die Produktoberfläche sind Gradients zu vermeiden.'),
      memory('@0000000012', 'Große dekorative Icons sollen vermieden werden.'),
      memory('@0000000013', 'Das Backend verwendet strukturierte JSON-Logs.'),
    ],
    relation: 'same',
    targetRef: '@0000000011',
    tags: ['paraphrase'],
  }),
  freezeRelationCase({
    id: 'relation-same-security-retention-en',
    language: 'en',
    type: 'constraint',
    originalValue: 'Keep security audit records for thirty days.',
    canonicalFact: 'Security audit records are retained for 30 days.',
    memories: [
      memory('@0000000021', 'Security event audit logs are retained for 30 days.'),
      memory('@0000000022', 'Product analytics events are retained for 30 days.'),
      memory('@0000000023', 'Database backups are retained for 14 days.'),
    ],
    relation: 'same',
    targetRef: '@0000000021',
    tags: ['domain_distractor'],
  }),
  freezeRelationCase({
    id: 'relation-same-node-version-de',
    language: 'de',
    type: 'constraint',
    originalValue: 'Lokale Entwicklung und CI müssen Node 24 verwenden.',
    canonicalFact: 'Das Projekt benötigt Node.js 24 für lokale Entwicklung und CI.',
    memories: [
      memory('@0000000031', 'Für Entwicklung und CI ist Node.js 24 vorgeschrieben.'),
      memory('@0000000032', 'Das Projekt verwendet npm 11.'),
      memory('@0000000033', 'Die Python-Hilfsskripte benötigen Python 3.13.'),
    ],
    relation: 'same',
    targetRef: '@0000000031',
    tags: ['paraphrase'],
  }),

  freezeRelationCase({
    id: 'relation-update-production-db-en',
    language: 'en',
    type: 'correction',
    originalValue: 'We now use MySQL for production instead of Postgres.',
    canonicalFact: 'The production database changed from Postgres to MySQL.',
    memories: [
      memory('@0000000041', 'The production database is Postgres.'),
      memory('@0000000042', 'The staging database is Postgres.'),
      memory('@0000000043', 'Redis is used for cache storage.'),
    ],
    relation: 'update',
    targetRef: '@0000000041',
    tags: ['explicit_replacement', 'scope_distractor'],
  }),
  freezeRelationCase({
    id: 'relation-update-retention-de',
    language: 'de',
    type: 'correction',
    originalValue: 'Security-Audit-Logs werden ab jetzt 60 statt 30 Tage aufbewahrt.',
    canonicalFact: 'Die Aufbewahrung von Security-Audit-Logs wurde von 30 auf 60 Tage geändert.',
    memories: [
      memory('@0000000051', 'Security-Audit-Logs werden 30 Tage aufbewahrt.'),
      memory('@0000000052', 'Produktanalyse-Events werden 30 Tage aufbewahrt.'),
      memory('@0000000053', 'Backups werden 60 Tage aufbewahrt.'),
    ],
    relation: 'update',
    targetRef: '@0000000051',
    tags: ['explicit_replacement', 'domain_distractor'],
  }),
  freezeRelationCase({
    id: 'relation-update-package-manager-en',
    language: 'en',
    type: 'correction',
    originalValue: 'We switched the project package manager from npm to pnpm.',
    canonicalFact: 'The project now uses pnpm instead of npm.',
    memories: [
      memory('@0000000061', 'The project package manager is npm.'),
      memory('@0000000062', 'CI runs npm audit for dependency checks.'),
      memory('@0000000063', 'Node.js 24 is required.'),
    ],
    relation: 'update',
    targetRef: '@0000000061',
    tags: ['explicit_replacement'],
  }),
  freezeRelationCase({
    id: 'relation-update-region-de',
    language: 'de',
    type: 'correction',
    originalValue: 'Die Produktionsregion wurde von Frankfurt auf Nürnberg umgestellt.',
    canonicalFact: 'Produktion läuft jetzt in Nürnberg statt Frankfurt.',
    memories: [
      memory('@0000000071', 'Die Produktionsregion ist Frankfurt.'),
      memory('@0000000072', 'Die Staging-Region ist Frankfurt.'),
      memory('@0000000073', 'Backups werden in Berlin gespiegelt.'),
    ],
    relation: 'update',
    targetRef: '@0000000071',
    tags: ['explicit_replacement', 'scope_distractor'],
  }),

  freezeRelationCase({
    id: 'relation-contradict-production-db-en',
    language: 'en',
    type: 'constraint',
    originalValue: 'The production database must use MySQL.',
    canonicalFact: 'Production must use MySQL as its database.',
    memories: [
      memory('@0000000081', 'The production database must use Postgres.'),
      memory('@0000000082', 'The staging database uses MySQL.'),
      memory('@0000000083', 'Redis is used for caching.'),
    ],
    relation: 'contradict',
    targetRef: '@0000000081',
    tags: ['incompatible', 'no_replacement_intent'],
  }),
  freezeRelationCase({
    id: 'relation-contradict-retention-en',
    language: 'en',
    type: 'constraint',
    originalValue: 'Security audit logs must be retained for 90 days.',
    canonicalFact: 'Security audit logs require 90-day retention.',
    memories: [
      memory('@0000000091', 'Security audit logs must be retained for 30 days.'),
      memory('@0000000092', 'Product analytics are retained for 90 days.'),
      memory('@0000000093', 'Backups are retained for 30 days.'),
    ],
    relation: 'contradict',
    targetRef: '@0000000091',
    tags: ['incompatible', 'domain_distractor'],
  }),
  freezeRelationCase({
    id: 'relation-contradict-gradients-de',
    language: 'de',
    type: 'constraint',
    originalValue: 'Die Produktoberfläche darf Gradients verwenden.',
    canonicalFact: 'Gradients sind in der Produktoberfläche erlaubt.',
    memories: [
      memory('@00000000a1', 'Gradients sind in der Produktoberfläche nicht erlaubt.'),
      memory('@00000000a2', 'Große dekorative Icons sind nicht erlaubt.'),
      memory('@00000000a3', 'Das Marketing darf Gradients in Kampagnen verwenden.'),
    ],
    relation: 'contradict',
    targetRef: '@00000000a1',
    tags: ['incompatible', 'scope_distractor'],
  }),
  freezeRelationCase({
    id: 'relation-contradict-api-en',
    language: 'en',
    type: 'constraint',
    originalValue: 'The public API must use REST.',
    canonicalFact: 'The public API is required to use REST.',
    memories: [
      memory('@00000000b1', 'The public API must use GraphQL.'),
      memory('@00000000b2', 'Internal health endpoints use REST.'),
      memory('@00000000b3', 'Public API authentication uses OAuth 2.1.'),
    ],
    relation: 'contradict',
    targetRef: '@00000000b1',
    tags: ['incompatible', 'scope_distractor'],
  }),

  freezeRelationCase({
    id: 'relation-unrelated-db-scope-en',
    language: 'en',
    type: 'decision',
    originalValue: 'Staging uses Postgres.',
    canonicalFact: 'The staging database is Postgres.',
    memories: [
      memory('@00000000c1', 'The production database is Postgres.'),
      memory('@00000000c2', 'Staging deploys automatically from main.'),
      memory('@00000000c3', 'Production backups run every six hours.'),
    ],
    relation: 'unrelated',
    targetRef: null,
    tags: ['hard_negative', 'scope_distractor'],
  }),
  freezeRelationCase({
    id: 'relation-unrelated-cost-domain-de',
    language: 'de',
    type: 'constraint',
    originalValue: 'CI muss im GitHub-Free-Tier bleiben.',
    canonicalFact: 'CI darf keine Kosten außerhalb des GitHub-Free-Tiers verursachen.',
    memories: [
      memory('@00000000d1', 'Das Produktionsserver-Budget beträgt maximal 100 Euro im Monat.'),
      memory('@00000000d2', 'CI verwendet Linux-Runner.'),
      memory('@00000000d3', 'Kostenberichte werden monatlich exportiert.'),
    ],
    relation: 'unrelated',
    targetRef: null,
    tags: ['hard_negative', 'domain_distractor'],
  }),
  freezeRelationCase({
    id: 'relation-unrelated-retention-domain-en',
    language: 'en',
    type: 'constraint',
    originalValue: 'Product analytics events are retained for 30 days.',
    canonicalFact: 'Product analytics retention is 30 days.',
    memories: [
      memory('@00000000e1', 'Security audit logs are retained for 30 days.'),
      memory('@00000000e2', 'Product analytics are stored in ClickHouse.'),
      memory('@00000000e3', 'Security audit logs are immutable.'),
    ],
    relation: 'unrelated',
    targetRef: null,
    tags: ['hard_negative', 'domain_distractor'],
  }),
  freezeRelationCase({
    id: 'relation-unrelated-camera-ui-de',
    language: 'de',
    type: 'constraint',
    originalValue: 'Spielerkameras verwenden ein Seitenverhältnis von 16:9.',
    canonicalFact: 'Spielerkameras müssen 16:9 verwenden.',
    memories: [
      memory('@00000000f1', 'Die Host-Kamera soll kleiner als die Spielerkameras sein.'),
      memory('@00000000f2', 'Spielerkameras zeigen den Spielernamen unter dem Bild.'),
      memory('@00000000f3', 'Das Board hat im Spiel die höchste visuelle Priorität.'),
    ],
    relation: 'unrelated',
    targetRef: null,
    tags: ['hard_negative', 'domain_distractor'],
  }),
]);

function safeRatio(numerator, denominator) {
  if (denominator === 0) return null;
  return numerator / denominator;
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

function scoreImportance(predictions) {
  const indexed = indexPredictions(predictions);
  const confusion = Object.fromEntries(
    IMPORTANCE_DECISIONS.map((expected) => [
      expected,
      Object.fromEntries(
        [...IMPORTANCE_DECISIONS, 'invalid'].map((actual) => [actual, 0]),
      ),
    ]),
  );

  let exactCorrect = 0;
  let invalid = indexed.duplicates;
  let expectedPromotions = 0;
  let predictedPromotions = 0;
  let truePromotions = 0;
  let falsePromotions = 0;

  for (const caseSpec of IMPORTANCE_JUDGE_CALIBRATION_CASES) {
    const expected = caseSpec.expected.decision;
    if (expected === 'promote') expectedPromotions += 1;

    const prediction = indexed.byId.get(caseSpec.id);
    const actual = (
      prediction?.ok === true
      && IMPORTANCE_DECISIONS.includes(prediction.decision)
    )
      ? prediction.decision
      : 'invalid';

    confusion[expected][actual] += 1;
    if (actual === 'invalid') {
      invalid += 1;
      continue;
    }

    if (actual === expected) exactCorrect += 1;
    if (actual === 'promote') {
      predictedPromotions += 1;
      if (expected === 'promote') truePromotions += 1;
      else falsePromotions += 1;
    }
  }

  return {
    total: IMPORTANCE_JUDGE_CALIBRATION_CASES.length,
    exact_correct: exactCorrect,
    exact_accuracy: safeRatio(
      exactCorrect,
      IMPORTANCE_JUDGE_CALIBRATION_CASES.length,
    ),
    expected_promotions: expectedPromotions,
    predicted_promotions: predictedPromotions,
    true_promotions: truePromotions,
    false_promotions: falsePromotions,
    promote_precision: safeRatio(truePromotions, predictedPromotions),
    promote_recall: safeRatio(truePromotions, expectedPromotions),
    invalid_outputs: invalid,
    confusion,
  };
}

function scoreRelation(predictions) {
  const indexed = indexPredictions(predictions);
  const confusion = Object.fromEntries(
    RELATIONS.map((expected) => [
      expected,
      Object.fromEntries(
        [...RELATIONS, 'invalid'].map((actual) => [actual, 0]),
      ),
    ]),
  );

  let exactCorrect = 0;
  let invalid = indexed.duplicates;
  let highConfidenceWrong = 0;
  let targetCorrect = 0;
  let targetErrors = 0;
  let relatedExpected = 0;

  for (const caseSpec of RELATION_JUDGE_CALIBRATION_CASES) {
    const expected = caseSpec.expected;
    if (expected.relation !== 'unrelated') relatedExpected += 1;

    const prediction = indexed.byId.get(caseSpec.id);
    const valid = (
      prediction?.ok === true
      && RELATIONS.includes(prediction.relation)
      && (
        prediction.target_ref === null
        || (
          typeof prediction.target_ref === 'string'
          && /^@[0-9a-f]{10}$/u.test(prediction.target_ref)
        )
      )
    );
    const actualRelation = valid ? prediction.relation : 'invalid';

    confusion[expected.relation][actualRelation] += 1;
    if (!valid) {
      invalid += 1;
      continue;
    }

    const exact = (
      prediction.relation === expected.relation
      && prediction.target_ref === expected.target_ref
    );
    if (exact) exactCorrect += 1;
    else if (prediction.confidence === 'high') highConfidenceWrong += 1;

    if (expected.relation !== 'unrelated') {
      if (prediction.target_ref === expected.target_ref) targetCorrect += 1;
      else targetErrors += 1;
    }
  }

  return {
    total: RELATION_JUDGE_CALIBRATION_CASES.length,
    exact_correct: exactCorrect,
    exact_accuracy: safeRatio(
      exactCorrect,
      RELATION_JUDGE_CALIBRATION_CASES.length,
    ),
    related_expected: relatedExpected,
    target_correct: targetCorrect,
    target_errors: targetErrors,
    target_accuracy: safeRatio(targetCorrect, relatedExpected),
    high_confidence_wrong: highConfidenceWrong,
    invalid_outputs: invalid,
    confusion,
  };
}

export function scoreMemoryJudgeCalibration({
  importancePredictions,
  relationPredictions,
} = {}) {
  const importance = scoreImportance(importancePredictions);
  const relation = scoreRelation(relationPredictions);
  const invalidOutputs = (
    importance.invalid_outputs
    + relation.invalid_outputs
  );

  const failures = [];
  if (invalidOutputs > 0) failures.push('invalid_outputs');
  if (importance.false_promotions > 0) {
    failures.push('importance_false_promotions');
  }
  if (relation.high_confidence_wrong > 0) {
    failures.push('relation_high_confidence_wrong');
  }

  return {
    fixture: {
      importance_cases: IMPORTANCE_JUDGE_CALIBRATION_CASES.length,
      relation_cases: RELATION_JUDGE_CALIBRATION_CASES.length,
      total_cases: (
        IMPORTANCE_JUDGE_CALIBRATION_CASES.length
        + RELATION_JUDGE_CALIBRATION_CASES.length
      ),
    },
    importance,
    relation,
    invalid_outputs: invalidOutputs,
    quality_gate: {
      pass: failures.length === 0,
      failures,
    },
  };
}
