import { createHash } from 'node:crypto';

import {
  auditP33PinnedProfileParity, P33PinnedProfileParityError,
} from './p33-pinned-profile-parity.mjs';
import {
  auditP34PatternPublicOutputParity, P34PublicOutputParityError,
} from './p34-pattern-public-output-parity.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const INPUTS = Object.freeze([
  ['templatesJson', 'templatesSha256', 200_000],
  ['baselineJson', 'baselineSha256', 2_000_000],
  ['recordsJson', 'recordsSha256', 16_000_000],
  ['patternsJson', 'patternsSha256', 4_000_000],
  ['publicBaselineJson', 'publicBaselineSha256', 100_000],
]);

export class P37SingleSnapshotAuditError extends Error {
  constructor(category) {
    super('P37 single-snapshot audit rejected: ' + category);
    this.name = 'P37SingleSnapshotAuditError';
    this.category = category;
  }
}

function reject(category) {
  throw new P37SingleSnapshotAuditError(category);
}

function hash(raw) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function verifyInputs(input) {
  if (typeof input.expectedP33ReportSha256 !== 'string'
    || !SHA256.test(input.expectedP33ReportSha256)) {
    reject('p33-report-pin');
  }
  // Validate every separately archived P34 input before HTTP. Rehashing the
  // exact bytes proves only equality to the supplied pins; the operator must
  // establish the pins' independent origin outside this process.
  for (const [rawName, shaName, maxBytes] of INPUTS) {
    const raw = input[rawName];
    const sha = input[shaName];
    if (typeof raw !== 'string' || raw.length === 0
      || Buffer.byteLength(raw, 'utf8') > maxBytes
      || typeof sha !== 'string' || !SHA256.test(sha)
      || hash(raw) !== sha) {
      reject('offline-input-pin');
    }
  }
}

/**
 * An operator-only, read-only composition of P33 and P34 on the EXACT
 * validated P30 candidate population. No raw rows, fetch envelopes or keys
 * leave this function. P33 obtains its own separately pinned P31 receipt.
 *
 * The externally supplied expectedP33ReportSha256 is a strict additional
 * trust gate. NEVER generate it here from the just-fetched response and
 * call that independent approval. Tests use synthetic local pins only.
 *
 * This does NOT authorize Graph routing, migration or deployment.
 */
export async function auditP37SingleSnapshotPublicParity(input = {}) {
  verifyInputs(input);
  const {
    fetchImpl = globalThis.fetch,
    supabaseUrl, publishableKey, asOf,
    serviceKey, accessMode,
    baselineJson, baselineSha256,
    templatesJson, templatesSha256,
    sourceReceiptJson, sourceReceiptSha256,
    recordsJson, recordsSha256,
    patternsJson, patternsSha256,
    publicBaselineJson, publicBaselineSha256,
    expectedP33ReportSha256,
    timeoutMs = 1500,
  } = input;

  // The wrapper observes only what P33's P30 transport consumes, retaining
  // transient rows in memory. It does NOT make a second HTTP request.
  // No candidate array is exposed to the caller, logged, written or cached.
  const pages = [];
  let httpRequestCount = 0;
  const observedFetch = async (url, options) => {
    httpRequestCount++;
    const response = await fetchImpl(url, options);
    return {
      ok: response?.ok,
      status: response?.status,
      headers: response?.headers,
      async json() {
        const payload = await response.json();
        if (Array.isArray(payload)) pages.push(payload);
        return payload;
      },
    };
  };

  let p33;
  try {
    p33 = await auditP33PinnedProfileParity({
      supabaseUrl, publishableKey, asOf,
      serviceKey, accessMode,
      baselineJson, baselineSha256, templatesJson, templatesSha256,
      sourceReceiptJson, sourceReceiptSha256,
      fetchImpl: observedFetch, timeoutMs,
    });
  } catch (error) {
    if (error instanceof P33PinnedProfileParityError) {
      reject(error.category.startsWith('transport-')
        ? 'p33-transport' : 'p33-evidence');
    }
    reject('p33-unexpected');
  }

  // A generated digest is NOT a new pin. Compare only to a value established
  // separately by an independent, trusted review of the prior P33 receipt.
  const p33ReportJson = JSON.stringify(p33);
  if (hash(p33ReportJson) !== expectedP33ReportSha256) {
    reject('p33-report-pin');
  }

  const candidates = pages.flat().map(raw => {
    // P33 already verified strict P30 projection fields, count, asset order,
    // candidate ID set and common refreshed_at instant. Strip transport-only
    // fields before comparing with the P33 v2 content digest in P34 v2.
    const { projection_version, snapshot_date, refreshed_at, ...candidate } = raw;
    return candidate;
  });

  let p34;
  try {
    p34 = auditP34PatternPublicOutputParity({
      templatesJson, templatesSha256, baselineJson, baselineSha256,
      recordsJson, recordsSha256, patternsJson, patternsSha256,
      publicBaselineJson, publicBaselineSha256,
      p33ReportJson, p33ReportSha256: expectedP33ReportSha256,
      candidates,
    });
  } catch (error) {
    if (error instanceof P34PublicOutputParityError) {
      reject('p34-' + error.category);
    }
    reject('p34-unexpected');
  }

  // Both artifacts contain only aggregate fields and hashes. Even perfect
  // 48/48 results remain non-authorizing in a true external production audit.
  return {
    schema_version: 'reference-graph.p37-single-snapshot-public-audit.v1',
    reference_date: p33.reference_date,
    http_request_count: httpRequestCount,
    p33_report_pin_matched: true,
    p33,
    p34,
    live_graph_parity_verified: false,
    deployment_authorized: false,
    activation_authorized: false,
    eligible_for_activation: false,
    repository_default_graph_enabled: false,
  };
}
