import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  P19_PRODUCTION_PROJECT_REF,
  evaluateP19PromotionReadiness,
} from './p19-production-soak.mjs';

const P25_PINNED_SHA = '8bd9eeec1ab84ca816bb6238702d88ebba9cf0c9';
const MANIFEST_SCHEMA = 'reference-graph.p26-evidence-freeze-manifest.v1';
const DIAGNOSTICS_SCHEMA = 'reference-graph.p25-probe-diagnostics.v1';
const HEX64 = /^[a-f0-9]{64}$/;
const ALLOWED_FILES = [
  'p25-samples.jsonl',
  'p19-attestation.json',
  'p19-frozen-evaluation.json',
  'p25-earlier-evaluation.json',
];
const REQUIRED_FILES = ALLOWED_FILES.slice(0, 3);
const MANIFEST_KEYS = [
  'schema_version', 'frozen_at', 'repository_sha', 'production_target_ref',
  'observed_samples', 'healthy_samples', 'observed_window_hours',
  'observed_max_gap_minutes', 'attestation_exact', 'eligible',
  'blocker_count', 'files_sha256', 'repository_default_promotion_performed',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function canonicalUtc(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

// PowerShell Date.ToUniversalTime().ToString('o') writes seven fractional
// second digits, while JavaScript Date.toISOString() writes three.
function validP26FreezeTimestamp(value) {
  if (canonicalUtc(value)) return true;
  if (typeof value !== 'string'
      || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{7}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf())
    && parsed.toISOString() === value.slice(0, 23) + 'Z';
}

function parseJson(bytes, name) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error(`P26 ${name} is not valid JSON`);
  }
}

function parseJsonl(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  const values = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      throw new Error('P26 frozen samples JSONL is invalid');
    }
  }
  return values;
}

function requireP25Diagnostics(samples) {
  for (const sample of samples) {
    const diagnostics = sample?.diagnostics;
    if (!diagnostics || diagnostics.schema_version !== DIAGNOSTICS_SCHEMA
        || !Array.isArray(diagnostics.events)
        || diagnostics.events.length < 1 || diagnostics.events.length > 32
        || !canonicalUtc(sample.collector_node_process_started_at)
        || !Number.isFinite(sample.collector_start_to_sample_ms)
        || sample.collector_start_to_sample_ms < 0
        || !diagnostics.events.every((event) => event && typeof event === 'object'
          && ['p10-attempt', 'p11-route', 'p17-stage'].includes(event.phase))) {
      throw new Error('P26 frozen sample has missing or invalid P25 diagnostics');
    }
    if (sample.healthy !== true || sample.production_source !== 'reference-graph'
        || sample.quick_graph_enabled !== true
        || sample.repository_default_graph_enabled !== false
        || sample.routing?.quick?.authoritative_source !== 'reference-graph'
        || sample.routing?.quick?.record_exact !== true
        || sample.routing?.quick?.pattern_exact !== true
        || sample.routing?.standard?.authoritative_source !== 'legacy-control'
        || sample.routing?.deep?.authoritative_source !== 'legacy-control') {
      throw new Error('P26 frozen sample violates Quick-only routing boundaries');
    }
  }
}

/**
 * Independently rechecks a read-only P25 local archive against an externally
 * supplied manifest digest. Never writes evidence or touches activation state.
 * Returns aggregate values only; raw P19 receipts and sample data stay local.
 */
export async function verifyP26FrozenEvidence({
  archiveDir,
  expectedManifestSha256,
  readFileImpl = readFile,
} = {}) {
  if (typeof archiveDir !== 'string' || archiveDir.trim() === ''
      || typeof readFileImpl !== 'function'
      || typeof expectedManifestSha256 !== 'string'
      || !HEX64.test(expectedManifestSha256)) {
    throw new TypeError('P26 requires archiveDir and independent lowercase manifest SHA256');
  }

  const manifestBytes = await readFileImpl(join(archiveDir, 'manifest.json'));
  const manifestSha256 = sha256(manifestBytes);
  if (manifestSha256 !== expectedManifestSha256) {
    throw new Error('P26 manifest SHA256 mismatch');
  }

  const manifest = parseJson(manifestBytes, 'manifest');
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.schema_version !== MANIFEST_SCHEMA) {
    throw new Error('P26 manifest schema or key allowlist is invalid');
  }
  if (manifest.repository_sha !== P25_PINNED_SHA) {
    throw new Error('P26 repository SHA does not match pinned P25');
  }
  if (manifest.production_target_ref !== P19_PRODUCTION_PROJECT_REF
      || manifest.repository_default_promotion_performed !== false
      || !validP26FreezeTimestamp(manifest.frozen_at)) {
    throw new Error('P26 manifest contains invalid production binding or state');
  }
  if (!exactKeys(manifest.files_sha256, ALLOWED_FILES)) {
    throw new Error('P26 manifest file allowlist is invalid');
  }

  const content = new Map();
  for (const name of REQUIRED_FILES) {
    const expected = manifest.files_sha256[name];
    if (typeof expected !== 'string' || !HEX64.test(expected)) {
      throw new Error('P26 manifest file SHA256 is invalid');
    }
    const bytes = await readFileImpl(join(archiveDir, name));
    if (sha256(bytes) !== expected) {
      throw new Error('P26 archived file SHA256 mismatch');
    }
    content.set(name, bytes);
  }
  const optionalHash = manifest.files_sha256['p25-earlier-evaluation.json'];
  if (optionalHash !== null) {
    if (typeof optionalHash !== 'string' || !HEX64.test(optionalHash)) {
      throw new Error('P26 optional file SHA256 is invalid');
    }
    const optionalBytes = await readFileImpl(join(archiveDir, 'p25-earlier-evaluation.json'));
    if (sha256(optionalBytes) !== optionalHash) {
      throw new Error('P26 optional archived file SHA256 mismatch');
    }
  }

  const attestation = parseJson(content.get('p19-attestation.json'), 'attestation');
  const samples = parseJsonl(content.get('p25-samples.jsonl'));
  const frozenEvaluation = parseJson(content.get('p19-frozen-evaluation.json'), 'evaluation');

  if (samples.length < 25) throw new Error('P26 frozen sample count is insufficient');
  requireP25Diagnostics(samples);
  const reevaluated = evaluateP19PromotionReadiness({ attestation, samples });

  if (!isDeepStrictEqual(reevaluated, frozenEvaluation)) {
    throw new Error('P26 frozen evaluation does not match independent P19 evaluation');
  }
  if (reevaluated.eligible !== true || reevaluated.attestation_exact !== true
      || reevaluated.blockers.length !== 0
      || reevaluated.healthy_samples !== reevaluated.observed_samples) {
    throw new Error('P26 frozen evidence is not P19 eligible');
  }
  for (const [field, actual] of Object.entries({
    observed_samples: reevaluated.observed_samples,
    healthy_samples: reevaluated.healthy_samples,
    observed_window_hours: reevaluated.observed_window_hours,
    observed_max_gap_minutes: reevaluated.observed_max_gap_minutes,
    attestation_exact: reevaluated.attestation_exact,
    eligible: reevaluated.eligible,
    blocker_count: reevaluated.blockers.length,
  })) {
    if (manifest[field] !== actual) {
      throw new Error('P26 manifest aggregate does not match independent evaluation');
    }
  }

  return {
    schema_version: 'reference-graph.p26-frozen-evidence-verification.v1',
    verified: true,
    repository_sha: manifest.repository_sha,
    manifest_sha256: manifestSha256,
    observed_samples: reevaluated.observed_samples,
    healthy_samples: reevaluated.healthy_samples,
    diagnostics_samples: samples.length,
    observed_window_hours: reevaluated.observed_window_hours,
    observed_max_gap_minutes: reevaluated.observed_max_gap_minutes,
    attestation_exact: true,
    eligible: true,
    blocker_count: 0,
    repository_default_promotion_performed: false,
  };
}
