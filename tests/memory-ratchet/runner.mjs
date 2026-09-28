import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { buildFixture } from './fixture/build-fixture.mjs';

export const SYNTHETIC_SECRET = 'sk-test-MEMORYRATCHET-7Yv5K9n2Qp4Z000000000000';
const REDACTION = '[REDACTED_SYNTHETIC_SECRET]';

async function readText(name) {
  return readFile(new URL(name, import.meta.url), 'utf8');
}

function projectKeyForId(fixture, projectId) {
  const entry = Object.entries(fixture.projects).find(([, project]) => project.id === projectId);
  if (!entry) throw new Error(`Unknown fixture project_id: ${projectId}`);
  return entry[0];
}

function resolveEvent(fixture, event) {
  const projectKey = projectKeyForId(fixture, event.project_id);
  const revisionSha = fixture.revisions[projectKey]?.[event.revision];
  if (!revisionSha) {
    throw new Error(`Unknown revision ${event.revision} for ${event.project_id} in ${event.id}`);
  }
  return {
    ...event,
    revision_sha: revisionSha,
    repo_path: fixture.projects[projectKey].path,
  };
}

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
}

function noiseBase(casePlan, index, seed, type) {
  const next = generator(seed + index)();
  const day = 14 + Math.floor(index / 1440);
  const minuteOfDay = index % 1440;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const at = `2026-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
  const harnesses = ['codex', 'claude-code', 'opencode'];
  return {
    id: `EV-NOISE-${seed}-${String(index + 1).padStart(4, '0')}`,
    at,
    harness: harnesses[index % harnesses.length],
    session_id: `NOISE-S${String(index + 1).padStart(4, '0')}`,
    project_id: casePlan.project_id,
    branch: casePlan.branch,
    revision: casePlan.revision,
    trust: 'agent_inference',
    type,
    content: `Unrelated fixture note ${next % 100000}: component-${next % 97} uses marker-${next % 7919}.`,
    source: `noise:${seed}:${index + 1}`,
  };
}

function createNoise(casePlan, profile, config) {
  return Array.from({ length: config.count }, (_, index) =>
    noiseBase(casePlan, index, config.seed, profile === 'long_gap_sessions' ? 'noise_session' : 'noise_memory'));
}

export function computeFixtureRevision(repositoryRevision, assets) {
  const hash = createHash('sha256');
  hash.update(repositoryRevision);
  for (const asset of assets) {
    hash.update('\0');
    hash.update(asset);
  }
  return hash.digest('hex');
}

export function redactSyntheticSecret(value) {
  if (typeof value === 'string') return value.split(SYNTHETIC_SECRET).join(REDACTION);
  if (Array.isArray(value)) return value.map(redactSyntheticSecret);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSyntheticSecret(item)]));
  }
  return value;
}

export async function prepareCase(caseId, root) {
  const fixture = await buildFixture(root);
  const [planText, eventsText, eventSchemaText] = await Promise.all([
    readText('./fixture/case-fixtures.json'),
    readText('./fixture/events.jsonl'),
    readText('./fixture/event.schema.json'),
  ]);
  const plan = JSON.parse(planText);
  const corpus = eventsText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const fixtureRevision = computeFixtureRevision(
    fixture.repository_revision,
    [eventsText, planText, eventSchemaText],
  );
  const casePlan = plan.cases[caseId];
  if (!casePlan) throw new Error(`Unknown memory ratchet case: ${caseId}`);

  const corpusById = new Map(corpus.map((event) => [event.id, event]));
  const selected = casePlan.ingest.map((eventId) => {
    const event = corpusById.get(eventId);
    if (!event) throw new Error(`${caseId} references unknown event ${eventId}`);
    return event;
  });

  let ordered = selected;
  if (casePlan.noise) {
    const noiseConfig = plan.noise[casePlan.noise];
    if (!noiseConfig) throw new Error(`${caseId} references unknown noise profile ${casePlan.noise}`);
    const noise = createNoise(casePlan, casePlan.noise, noiseConfig);
    if (casePlan.noise === 'recall_distractors') {
      const midpoint = Math.floor(noise.length / 2);
      ordered = [...noise.slice(0, midpoint), ...selected, ...noise.slice(midpoint)];
    } else {
      ordered = [...selected, ...noise];
    }
  }

  const projectKey = projectKeyForId(fixture, casePlan.project_id);
  const revisionSha = fixture.revisions[projectKey]?.[casePlan.revision];
  if (!revisionSha) throw new Error(`${caseId} references unknown current revision ${casePlan.revision}`);

  return {
    case_id: caseId,
    fixture_revision: fixtureRevision,
    current: {
      project_id: casePlan.project_id,
      branch: casePlan.branch,
      revision: casePlan.revision,
      revision_sha: revisionSha,
      repo_path: fixture.projects[projectKey].path,
    },
    events: ordered.map((event) => resolveEvent(fixture, event)),
    query: casePlan.query,
    recall: {
      limit: caseId === 'M14' ? 10 : null,
    },
    source_harness: casePlan.source_harness ?? null,
    query_harness: casePlan.query_harness ?? null,
  };
}
