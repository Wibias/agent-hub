import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  linkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const QUALITY_STATUSES = new Set([
  'fast_v1_match',
  'fast_v1_mismatch',
  'fast_v2_match',
  'fast_v2_mismatch',
  'fast_path_fallback',
]);

function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value.trim();
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

export function recallShadowCalibrationCandidateKey(claimId) {
  return createHash('sha256')
    .update(nonEmpty(claimId, 'claimId'), 'utf8')
    .digest('hex');
}

function candidateId(candidate) {
  return nonEmpty(candidate?.claim?.id, 'candidate claim id');
}

function keysFor(ids, candidateKeys, name) {
  if (!Array.isArray(ids)) throw new TypeError(name + ' must be an array');
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const normalized = nonEmpty(id, name + ' id');
    const key = candidateKeys.get(normalized);
    if (!key) throw new Error(name + ' contains id outside packet candidates');
    if (seen.has(key)) throw new Error(name + ' contains duplicate id');
    seen.add(key);
    out.push(key);
  }
  return out.sort();
}

export function buildRecallShadowCalibrationRecord({ packet, result } = {}) {
  if (!packet || typeof packet !== 'object') throw new TypeError('packet must be an object');
  if (!result || typeof result !== 'object') throw new TypeError('result must be an object');

  if (!QUALITY_STATUSES.has(result.status)) {
    return { status: 'skipped', reason: 'non_quality_status', record: null };
  }
  if (result.status === 'fast_path_fallback' && result.judgeCalled !== true) {
    return { status: 'skipped', reason: 'judge_not_called', record: null };
  }

  const diagnostics = packet.localFastPath?.diagnostics;
  if (!diagnostics || diagnostics.schema_version !== 1) {
    return { status: 'skipped', reason: 'legacy_without_exact_diagnostics', record: null };
  }

  const packetId = nonEmpty(packet.id, 'packet id');
  const candidates = Array.isArray(packet.candidates) ? packet.candidates : [];
  const candidateKeys = new Map(
    candidates.map((candidate) => {
      const id = candidateId(candidate);
      return [id, recallShadowCalibrationCandidateKey(id)];
    }),
  );

  if (!Array.isArray(diagnostics.candidates)) {
    throw new TypeError('diagnostics candidates must be an array');
  }

  const diagCandidates = diagnostics.candidates.map((candidate) => {
    const claimId = nonEmpty(candidate?.claim_id, 'diagnostic claim id');
    const candidateKey = candidateKeys.get(claimId);
    if (!candidateKey) throw new Error('diagnostic claim id outside packet candidates');
    return {
      candidate_key: candidateKey,
      similarity: Number(candidate.similarity),
      semantic_rank: candidate.semantic_rank ?? null,
      lexical_rank: candidate.lexical_rank ?? null,
      final_rank: candidate.final_rank ?? null,
      rrf_score: candidate.rrf_score ?? null,
      budget_retained: candidate.budget_retained ?? null,
      signal_votes: candidate.signal_votes ?? null,
    };
  });

  const record = {
    schemaVersion: 1,
    source: 'exact_runtime',
    packet_id: packetId,
    captured_at: typeof packet.createdAt === 'string' ? packet.createdAt : null,
    replay_status: result.status,
    policy_version: packet.localFastPath?.policy_version ?? null,
    local_route: packet.localFastPath?.route ?? null,
    local_decision: packet.localFastPath?.decision ?? null,
    candidate_count: candidates.length,
    local_selected_keys: keysFor(
      packet.localFastPath?.selected_ids ?? [],
      candidateKeys,
      'local selected ids',
    ),
    judge_selected_keys: keysFor(
      result.judgeSelectedIds ?? [],
      candidateKeys,
      'judge selected ids',
    ),
    diagnostics: {
      schema_version: 1,
      thresholds: jsonClone(diagnostics.thresholds ?? {}),
      candidates: diagCandidates,
      top_margin: diagnostics.top_margin ?? null,
    },
  };

  return { status: 'ready', reason: null, record };
}

export class RecallShadowCalibrationStore {
  constructor({ rootDir } = {}) {
    this.rootDir = nonEmpty(rootDir, 'rootDir');
    this.calibrationDir = join(this.rootDir, 'calibration');
  }

  file(packetId) {
    return join(this.calibrationDir, nonEmpty(packetId, 'packetId') + '.json');
  }

  record(record) {
    if (!record || typeof record !== 'object') throw new TypeError('record must be an object');
    const target = this.file(record.packet_id);
    const text = canonical(record);
    mkdirSync(this.calibrationDir, { recursive: true });

    if (existsSync(target)) {
      const existing = readFileSync(target, 'utf8');
      if (existing === text) return { status: 'existing', path: target };
      const error = new Error('conflicting calibration record for packet ' + record.packet_id);
      error.code = 'RECALL_SHADOW_CALIBRATION_CONFLICT';
      throw error;
    }

    const temp = target + '.' + process.pid + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
    try {
      linkSync(temp, target);
      unlinkSync(temp);
    } catch (error) {
      try { unlinkSync(temp); } catch {}
      if (existsSync(target)) {
        const existing = readFileSync(target, 'utf8');
        if (existing === text) return { status: 'existing', path: target };
        const conflict = new Error('conflicting calibration record for packet ' + record.packet_id);
        conflict.code = 'RECALL_SHADOW_CALIBRATION_CONFLICT';
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
