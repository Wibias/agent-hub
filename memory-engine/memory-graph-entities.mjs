import { createHash } from 'node:crypto';

export const ENTITY_PROJECTION_VERSION = 'entity-projection-v2';
const MAX_ENTITIES_PER_CLAIM = 5;

const STOPWORDS = new Set(`
  der die das den dem des ein eine einer eines einem einen und oder aber wenn dann als auch nur nicht kein keine keinen jeder jede jedes alle allen dieser diese dieses beim thema bereich kontext fuer für mit ohne nach vor aus auf bei ist sind war waren werden wird wurde muss müssen soll sollen darf dürfen kann können hat haben the a an and or but if then as also only not no every all this that these those with without from for to of in on at is are was were must should can could will would has have user project memory claim evidence value state active current correction decision constraint known issue rejected approach nutzer nutzerin kunde kundin team system agent modell prozess fall beispiel problem frage antwort lösung loesung its their our your there here wants needs uses makes keeps shows means allows requires includes provides becomes appears seems does goes says works runs stays remains contains offers stores holds reads writes creates updates deletes returns exposes applies connects links serves
`.trim().split(/\s+/u));

const KNOWN_ENTITIES = [
  ['Windows x64', /\bWindows\s+x64\b/iu, 'technology'],
  ['Windows Hello', /\bWindows\s+Hello\b/iu, 'technology'],
  ['Windows', /\bWindows\b/iu, 'technology'],
  ['x64', /\bx64\b/iu, 'technology'],
  ['SQLite', /\bSQLite3?\b/iu, 'technology'],
  ['Postgres', /\bPostgre(?:s|SQL)\b/iu, 'technology'],
  ['MySQL', /\bMySQL\b/iu, 'technology'],
  ['Node.js', /\bNode(?:\.js)?\b/iu, 'technology'],
  ['Codex', /\bCodex\b/iu, 'technology'],
  ['Playwright', /\bPlaywright\b/iu, 'technology'],
  ['PowerShell', /\b(?:PowerShell|pwsh)\b/iu, 'technology'],
  ['Git', /\bGit\b/iu, 'technology'],
  ['MCP', /\bMCP\b/iu, 'technology'],
  ['JSON', /\bJSON\b/iu, 'technology'],
  ['YAML', /\bYAML\b/iu, 'technology'],
  ['FTS5', /\bFTS5?\b/iu, 'technology'],
  ['E5', /\bE5\b/iu, 'technology'],
  ['AgentHub', /\bAgentHub\b/iu, 'product'],
  ['CLI', /\bCLI\b/iu, 'interface'],
  ['Desktop', /\bDesktop\b/iu, 'interface'],
  ['SQLite FTS5', /\bSQLite\s+FTS5?\b/iu, 'technology'],
];

// Preserve explicit module paths; a basename is not an entity identity.
const MODULE_MENTION = /(?:[A-Za-z]:)?[\w./\\-]+\.(?:mjs|js|ts|tsx|jsx|json|md|css|html|yml|yaml|sql|ps1|cs|py)\b/giu;
const MODULE_PATH = /^(?:[A-Za-z]:)?[\w./\\-]+\.(?:mjs|js|ts|tsx|jsx|json|md|css|html|yml|yaml|sql|ps1|cs|py)$/iu;

function moduleLabel(value) {
  return value.replaceAll('\\', '/').replace(/^(?:\.\/)+/u, '');
}

function normalizedKey(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function stripQuoted(value) {
  return String(value)
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/"[^"]{1,240}"/gu, ' ')
    .replace(/[“”][^“”]{1,240}[“”]/gu, ' ');
}

const ABSTRACT_NOUN = /(?:ung|heit|keit|schaft|tion|sion|tät|ismus|ness|ment|ance|ence)$/iu;

/** Score a concept from its literal surface form, not from inferred meaning. */
function conceptScore(source, index, label) {
  let score = 3;
  const before = source.slice(Math.max(0, index - 4), index);
  if (index === 0 || /[.!?;:]\s*$/u.test(before)) score += 1;
  if (ABSTRACT_NOUN.test(label)) score -= 1;
  return score;
}

function entityRef(key) {
  return 'E:' + createHash('sha256').update(key).digest('hex').slice(0, 10);
}

function pushCandidate(map, label, kind, score) {
  if (kind === 'module') label = moduleLabel(label);
  const key = kind === 'module' ? 'module:' + label : normalizedKey(label);
  if (!key || key.length < 2) return;
  if (kind !== 'module') {
    const lowerTokens = key.split('-');
    if (lowerTokens.some((token) => STOPWORDS.has(token))) return;
    if (STOPWORDS.has(key)) return;
  }
  const current = map.get(key);
  if (!current) {
    map.set(key, { key, label, kind, score });
    return;
  }
  if (score > current.score) {
    current.label = label;
    current.kind = kind;
    current.score = score;
  }
}

/** Deterministic, source-bound entities. Never a model claim or authority. */
export function extractClaimEntities(value) {
  const source = stripQuoted(value);
  const candidates = new Map();

  for (const match of source.matchAll(/`([^`]{2,120})`/gu)) {
    const label = match[1].trim();
    pushCandidate(candidates, label, MODULE_PATH.test(label) ? 'module' : 'code', 9);
  }
  for (const match of source.matchAll(MODULE_MENTION)) {
    pushCandidate(candidates, match[0], 'module', 8);
  }
  for (const match of source.matchAll(/\bports?\s+\d{2,5}(?:\/\d{2,5})?\b/giu)) {
    pushCandidate(candidates, match[0].replace(/\s+/gu, ' '), 'port', 7);
  }
  for (const [label, pattern, kind] of KNOWN_ENTITIES) {
    if (pattern.test(source)) pushCandidate(candidates, label, kind, 10);
  }

  const capitalized = [...source.matchAll(/\b[A-ZÄÖÜ][\p{L}\p{N}-]*\b/gu)];
  for (let index = 0; index < capitalized.length; index += 1) {
    const token = capitalized[index];
    const tokenKey = normalizedKey(token[0]);
    if (STOPWORDS.has(tokenKey) || token[0].length < 4) continue;
    pushCandidate(candidates, token[0], 'concept', conceptScore(source, token.index, token[0]));
    const next = capitalized[index + 1];
    if (!next) continue;
    const gap = source.slice(
      token.index + token[0].length,
      next.index,
    );
    const nextKey = normalizedKey(next[0]);
    if (
      /^\s+$/u.test(gap)
      && !STOPWORDS.has(nextKey)
      && next[0].length >= 2
    ) {
      pushCandidate(candidates, token[0] + ' ' + next[0], 'concept', 6);
    }
  }

  // English claims often keep nouns lowercase. Extract only literal noun
  // phrases after determiners, coordinated nouns, and plural nouns; these are
  // surface-bound candidates, never inferred topics.
  for (const match of source.matchAll(/\b(?:the|a|an|this|that|these|those|its|their|our|your)[ \t]+(?:[a-zäöüß][a-zäöüß-]*[ \t]+){0,2}([a-zäöüß][a-zäöüß-]{3,})\b/giu)) {
    const label = match[1];
    pushCandidate(candidates, label, 'concept', conceptScore(source, match.index + match[0].lastIndexOf(label), label));
  }
  for (const match of source.matchAll(/\b([a-zäöüß][a-zäöüß-]{3,})[ \t]+(?:and|or)[ \t]+([a-zäöüß][a-zäöüß-]{3,})\b/giu)) {
    for (const label of [match[1], match[2]]) {
      pushCandidate(candidates, label, 'concept', 3);
    }
  }
  // German nouns are capitalized; lowercase words around und/oder are
  // usually adjectives or verbs and must not become entities.
  for (const match of source.matchAll(/\b([A-ZÄÖÜ][\p{L}\p{N}-]{3,})[ \t]+(?:und|oder)[ \t]+([A-ZÄÖÜ][\p{L}\p{N}-]{3,})\b/gu)) {
    for (const label of [match[1], match[2]]) {
      pushCandidate(candidates, label, 'concept', 3);
    }
  }
  for (const match of source.matchAll(/\b([a-zäöüß][a-zäöüß-]{4,}s)\b/giu)) {
    pushCandidate(candidates, match[1], 'concept', 2);
  }

  const values = [...candidates.values()];
  const withoutNestedSingles = values.filter((candidate) => {
    if (candidate.kind === 'module' || candidate.key.includes('-')) return true;
    return !values.some((other) => (
      other !== candidate
      && other.score > candidate.score
      && other.key !== candidate.key
      && other.key.includes(candidate.key)
    ));
  });
  const pruned = withoutNestedSingles.filter((candidate) => {
    if (candidate.kind !== 'technology') return true;
    return !withoutNestedSingles.some((other) => (
      other !== candidate
      && other.kind === 'technology'
      && other.score >= candidate.score
      && normalizedKey(other.label).includes(candidate.key)
      && normalizedKey(other.label) !== candidate.key
    ));
  });
  return pruned
    .sort((left, right) => right.score - left.score
      || right.label.length - left.label.length
      || left.key.localeCompare(right.key, 'en'))
    .slice(0, MAX_ENTITIES_PER_CLAIM);
}

function zeroUsage() {
  return {
    retrievalCount: 0,
    retainedCount: 0,
    contextCount: 0,
    lastRetainedAt: null,
    lastContextAt: null,
  };
}

/** Add read-only entity nodes and entity-membership edges to a claim graph. */
export function projectClaimEntities(graph, {
  projectId,
  branch = null,
  maxEntityNodes = 240,
  maxEntityEdges = 2000,
  maxEntitiesPerClaim = 3,
} = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('graph must contain nodes and edges');
  }
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new TypeError('projectId is required');
  }
  for (const [name, value] of [
    ['maxEntityNodes', maxEntityNodes],
    ['maxEntityEdges', maxEntityEdges],
    ['maxEntitiesPerClaim', maxEntitiesPerClaim],
  ]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(name + ' must be a non-negative integer');
    }
  }
  const claimNodes = graph.nodes.filter((node) => node?.nodeType !== 'entity');
  const byKey = new Map();
  const claimEntityKeys = new Map();
  for (const claim of claimNodes) {
    const entities = extractClaimEntities(claim.value);
    claimEntityKeys.set(claim.id, entities.map((entity) => entity.key));
    for (const entity of entities) {
      const current = byKey.get(entity.key) ?? {
        ...entity,
        claimIds: new Set(),
        branches: new Set(),
        evidenceIds: new Set(),
      };
      current.claimIds.add(claim.id);
      if (claim.branch) current.branches.add(claim.branch);
      if (claim.provenance?.evidenceId) current.evidenceIds.add(claim.provenance.evidenceId);
      byKey.set(entity.key, current);
    }
  }

  const orderedEntities = [...byKey.values()].sort((left, right) => (
    right.claimIds.size - left.claimIds.size
    || left.key.localeCompare(right.key, 'en')
  ));
  const selectedEntities = orderedEntities.slice(0, maxEntityNodes);
  const omittedEntities = orderedEntities.length - selectedEntities.length;
  const entityNodes = [];
  const entityIdByKey = new Map();
  const entityKindByKey = new Map();
  for (const entity of selectedEntities) {
    const id = 'entity:' + projectId + ':' + entity.key;
    const ref = entityRef(entity.key);
    entityNodes.push({
      id,
      ref,
      nodeType: 'entity',
      entityKey: entity.key,
      entityKind: entity.kind,
      value: entity.label,
      label: entity.label,
      subject: 'entity',
      predicate: 'appears_in',
      kind: 'entity',
      state: 'derived',
      authority: 'derived',
      group: 'entity',
      groupLabel: 'Derived entity',
      lifecycleStatus: 'derived',
      branch: branch ?? null,
      branches: [...entity.branches].sort(),
      createdAt: null,
      validFrom: null,
      validUntil: null,
      semanticIndexed: false,
      embeddingModels: [],
      usage: zeroUsage(),
      freshness: {
        status: 'not_repository',
        revisionSha: null,
        explanation: 'Derived from claim text; Git freshness does not apply',
      },
      provenance: {
        label: 'Derived from claim text',
        sourceKind: 'entity_projection',
        sourceRef: 'entity:' + entity.key,
        authorityClass: 'derived',
        evidenceIds: [...entity.evidenceIds].sort(),
        path: null,
        blobOid: null,
        commitSha: null,
      },
      claimIds: [...entity.claimIds].sort(),
      entityProjectionVersion: ENTITY_PROJECTION_VERSION,
    });
    entityIdByKey.set(entity.key, id);
    entityKindByKey.set(entity.key, entity.kind);
  }

  // Link claims first so a few high-frequency entities cannot exhaust the
  // edge budget and leave later claims visually isolated. The entity nodes
  // still retain their full source-bound claimIds; only drawn edges are bounded.
  const selectedKeys = new Set(entityIdByKey.keys());
  const entityEdges = [];
  let entityEdgesOmitted = 0;
  for (const claim of claimNodes) {
    let linked = 0;
    for (const key of claimEntityKeys.get(claim.id) ?? []) {
      if (!selectedKeys.has(key)) {
        entityEdgesOmitted += 1;
        continue;
      }
      if (linked >= maxEntitiesPerClaim || entityEdges.length >= maxEntityEdges) {
        entityEdgesOmitted += 1;
        continue;
      }
      entityEdges.push({
        id: 'derived:entity:' + key + ':' + claim.id,
        from: entityIdByKey.get(key),
        to: claim.id,
        relation: 'entity_membership',
        origin: 'derived',
        source: 'entity_projection',
        current: true,
        weight: 1,
        entityKey: key,
        entityKind: entityKindByKey.get(key),
        provenance: {
          sourceKind: 'entity_projection',
          authorityClass: 'derived',
        },
      });
      linked += 1;
    }
  }
  const groups = [...(graph.groups ?? [])];
  if (entityNodes.length > 0) {
    groups.push({ id: 'entity', label: 'Derived entity', count: entityNodes.length });
  }
  return {
    ...graph,
    nodes: [...claimNodes, ...entityNodes],
    edges: [...graph.edges, ...entityEdges],
    groups,
    entityProjection: {
      version: ENTITY_PROJECTION_VERSION,
      entityNodes: entityNodes.length,
      entityEdges: entityEdges.length,
      entityEdgesOmitted,
      claimsWithEntities: new Set(entityEdges.map((edge) => edge.to)).size,
      entityNodesOmitted: omittedEntities,
    },
    stats: {
      ...(graph.stats ?? {}),
      entityNodes: entityNodes.length,
      entityEdges: entityEdges.length,
      entityEdgesOmitted,
      claimsWithEntities: new Set(entityEdges.map((edge) => edge.to)).size,
      entityNodesOmitted: omittedEntities,
      nodeCount: graph.nodes.length + entityNodes.length,
      edgeCount: graph.edges.length + entityEdges.length,
    },
  };
}
