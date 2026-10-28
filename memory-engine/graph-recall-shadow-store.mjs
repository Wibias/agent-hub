import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashedKeys(ids, name) {
  if (!Array.isArray(ids)) throw new TypeError(`${name} must be an array`);
  const keys = new Set();
  for (const id of ids) {
    keys.add(graphRecallShadowCandidateKey(nonEmpty(id, `${name} id`)));
  }
  return [...keys].sort();
}

function combinedKeys(left, right, name) {
  return hashedKeys([...(left ?? []), ...(right ?? [])], name);
}

function reportObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('report must be an object');
  }
  if (value.schemaVersion !== 1) {
    throw new TypeError('report schemaVersion must be 1');
  }
  return value;
}

export function graphRecallShadowCandidateKey(claimId) {
  return hashText(nonEmpty(claimId, 'claimId'));
}

export function buildGraphRecallShadowRecord({
  projectId,
  branch,
  query,
  observedAt,
  report,
} = {}) {
  const normalizedProjectId = nonEmpty(projectId, 'projectId');
  const normalizedBranch = nonEmpty(branch, 'branch');
  const normalizedQuery = typeof query === 'string' ? query : String(query ?? '');
  const normalizedObservedAt = nonEmpty(observedAt, 'observedAt');
  const shadow = reportObject(report);

  const sourceCandidateKeys = combinedKeys(
    shadow.sourceRetainedIds,
    shadow.sourcePrunedIds,
    'source candidate ids',
  );
  const graphCandidateKeys = hashedKeys(shadow.graphCandidateIds ?? [], 'graph candidate ids');
  const authoritativeSelectedKeys = hashedKeys(
    shadow.authoritativeSelectedIds ?? [],
    'authoritative selected ids',
  );
  const queryDigest = hashText(normalizedQuery);

  const observationIdentity = {
    schemaVersion: 1,
    project_id: normalizedProjectId,
    branch: normalizedBranch,
    observed_at: normalizedObservedAt,
    query_digest: queryDigest,
    policy_version: shadow.policyVersion ?? null,
    source_candidate_keys: sourceCandidateKeys,
    graph_candidate_keys: graphCandidateKeys,
    authoritative_selected_keys: authoritativeSelectedKeys,
  };
  const observationId = hashText(JSON.stringify(observationIdentity));

  return {
    schemaVersion: 1,
    source: 'exact_runtime',
    observation_id: observationId,
    observed_at: normalizedObservedAt,
    project_id: normalizedProjectId,
    branch: normalizedBranch,
    query_digest: queryDigest,
    policy_version: shadow.policyVersion ?? null,
    quality_eligible: shadow.qualityEligible === true,
    judge_called: shadow.judgeCalled === true,
    judge_available: shadow.judgeAvailable === true,
    source_candidate_keys: sourceCandidateKeys,
    graph_candidate_keys: graphCandidateKeys,
    anchor_keys: hashedKeys(shadow.anchorIds ?? [], 'anchor ids'),
    missing_anchor_keys: hashedKeys(shadow.missingAnchorIds ?? [], 'missing anchor ids'),
    source_retained_keys: hashedKeys(shadow.sourceRetainedIds ?? [], 'source retained ids'),
    source_pruned_keys: hashedKeys(shadow.sourcePrunedIds ?? [], 'source pruned ids'),
    novel_graph_keys: hashedKeys(shadow.novelGraphIds ?? [], 'novel graph ids'),
    authoritative_selected_keys: authoritativeSelectedKeys,
    authoritative_hit_keys: hashedKeys(
      shadow.authoritativeHitIds ?? [],
      'authoritative hit ids',
    ),
    false_negative_keys: hashedKeys(shadow.falseNegativeIds ?? [], 'false negative ids'),
    metrics: jsonClone(shadow.metrics ?? {}),
  };
}

export class GraphRecallShadowStore {
  constructor({ rootDir } = {}) {
    this.rootDir = nonEmpty(rootDir, 'rootDir');
    this.calibrationDir = join(this.rootDir, 'graph-calibration');
  }

  file(observationId) {
    return join(
      this.calibrationDir,
      `${nonEmpty(observationId, 'observationId')}.json`,
    );
  }

  record(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('record must be an object');
    }
    const observationId = nonEmpty(record.observation_id, 'record observation_id');
    if (!/^[a-f0-9]{64}$/.test(observationId)) {
      throw new TypeError('record observation_id must be a SHA-256 hex digest');
    }

    const target = this.file(observationId);
    const text = canonical(record);
    mkdirSync(this.calibrationDir, { recursive: true });

    if (existsSync(target)) {
      const existing = readFileSync(target, 'utf8');
      if (existing === text) return { status: 'existing', path: target };
      const error = new Error(`conflicting graph recall shadow record for observation ${observationId}`);
      error.code = 'GRAPH_RECALL_SHADOW_CONFLICT';
      throw error;
    }

    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
    try {
      linkSync(temp, target);
      unlinkSync(temp);
    } catch (error) {
      try { unlinkSync(temp); } catch {}
      if (existsSync(target)) {
        const existing = readFileSync(target, 'utf8');
        if (existing === text) return { status: 'existing', path: target };
        const conflict = new Error(`conflicting graph recall shadow record for observation ${observationId}`);
        conflict.code = 'GRAPH_RECALL_SHADOW_CONFLICT';
        throw conflict;
      }
      throw error;
    }

    return { status: 'recorded', path: target };
  }

  list() {
    if (!existsSync(this.calibrationDir)) return [];
    return readdirSync(this.calibrationDir)
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(this.calibrationDir, name), 'utf8')));
  }

  count() {
    return this.list().length;
  }
}
