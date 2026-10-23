import { readFileSync, writeFileSync } from 'node:fs';

import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { validateRevalidationDecision } from '../../knowledge/design-references/scripts/revalidation-lib.mjs';

const VERIFIED_AT = '2026-10-23';
const VERIFIER = 'p4-source-analysis-audit-v1';
const CONCURRENCY = 10;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_BODY_CHARS = 2_000_000;

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlText(html) {
  return normalizeText(
    String(html ?? '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function significantTokens(value) {
  const stop = new Set([
    'homepage', 'home', 'page', 'product', 'website', 'web', 'app', 'platform',
    'public', 'authenticated', 'settings', 'design', 'system', 'mobile', 'responsive',
  ]);
  return [...new Set(normalizeText(value).split(' '))]
    .filter((token) => token.length >= 4 && !stop.has(token));
}

function analysisAnchors(record) {
  const anchors = [];
  for (const strength of Array.isArray(record.strengths) ? record.strengths : []) {
    const match = String(strength).match(/live capture available\s*\((.+?)\)/i);
    if (match?.[1]) anchors.push(match[1]);
  }

  const observed = String(record.topology ?? '').match(/observed:\s*(.+)$/i)?.[1] ?? '';
  for (const part of observed.split(/,\s+/)) {
    const trimmed = part.trim().replace(/[.]+$/g, '');
    if (trimmed.length >= 8) anchors.push(trimmed);
  }

  return [...new Set(anchors.map((value) => value.trim()).filter(Boolean))];
}

function anchorMatches(text, anchors) {
  const normalized = anchors.map((anchor) => ({ raw: anchor, normalized: normalizeText(anchor) }));
  return normalized
    .filter(({ normalized: value }) => value.length >= 6 && text.includes(value))
    .map(({ raw }) => raw);
}

function identityMatches(text, record) {
  const tokens = significantTokens([record.product, record.title, record.sourceFamily].join(' '));
  const matched = tokens.filter((token) => text.includes(token));
  return { tokens, matched };
}

function classifyAccess(status, prior) {
  if (status === 401 || status === 403 || status === 429) return 'BLOCKED';
  if (status === 402) return 'PAYWALLED';
  if (status >= 200 && status < 400) return prior === 'PAYWALLED' ? 'PAYWALLED' : 'AVAILABLE';
  return 'UNAVAILABLE';
}

async function fetchOnce(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; AgentHub-ReferenceGraph-P4/1.0; +https://github.com/Wibias/agent-hub)',
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
      'accept-language': 'en-US,en;q=0.9',
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  let body = '';
  if (/text|html|json|xml/i.test(contentType)) {
    body = (await response.text()).slice(0, MAX_BODY_CHARS);
  }
  return {
    status: response.status,
    ok: response.ok,
    url: response.url || url,
    contentType,
    body,
  };
}

async function inspectSource(record) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await fetchOnce(record.canonicalUrl);
      if ((result.status === 429 || result.status >= 500) && attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        continue;
      }
      return { ...result, attempts: attempt, error: null };
    } catch (error) {
      lastError = error;
      if (attempt === 1 && error?.name !== 'TimeoutError') {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      break;
    }
  }
  return {
    status: 0,
    ok: false,
    url: record.canonicalUrl,
    contentType: '',
    body: '',
    attempts: 2,
    error: lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : String(lastError),
  };
}

function decide(record, inspection) {
  const rightsPresent = typeof record.rightsNote === 'string' && record.rightsNote.trim().length >= 8;
  const storagePresent = typeof record.storagePolicy === 'string' && record.storagePolicy.trim().length > 0;
  const accessStatus = inspection.status === 0
    ? 'UNAVAILABLE'
    : classifyAccess(inspection.status, record.accessStatus);
  const text = htmlText(inspection.body);
  const anchors = analysisAnchors(record);
  const matchedAnchors = anchorMatches(text, anchors);
  const identity = identityMatches(text, record);
  const identityOkay = identity.tokens.length === 0 || identity.matched.length >= 1;
  const bodyUsable = text.length >= 120;
  const sourceReachable = inspection.status >= 200 && inspection.status < 400;
  const analysisSupported = sourceReachable
    && bodyUsable
    && identityOkay
    && anchors.length > 0
    && matchedAnchors.length > 0;

  let verdict = 'stale';
  let reason;

  if (!rightsPresent || !storagePresent) {
    reason = 'Existing rights/storage metadata is incomplete, so the analysis cannot be reconfirmed safely.';
  } else if (inspection.status === 0) {
    reason = `Current source could not be fetched (${inspection.error ?? 'network failure'}).`;
  } else if (inspection.status === 401 || inspection.status === 403 || inspection.status === 429) {
    reason = `Current source access is blocked with HTTP ${inspection.status}; committed analysis was reviewed but cannot be substantiated from current page evidence.`;
  } else if (inspection.status === 404 || inspection.status === 410) {
    reason = `Canonical source returned HTTP ${inspection.status}; committed analysis was reviewed but the current source is no longer available at that locator.`;
  } else if (inspection.status >= 500) {
    reason = `Canonical source returned HTTP ${inspection.status}; current evidence is unavailable, so prior analysis is not refreshed.`;
  } else if (!bodyUsable) {
    reason = `Canonical source returned HTTP ${inspection.status} but did not expose enough current textual evidence to substantiate the committed analysis.`;
  } else if (anchors.length === 0) {
    reason = `Canonical source returned HTTP ${inspection.status}, but this record has no concrete prior observed-text anchor suitable for conservative automatic reconfirmation.`;
  } else if (!identityOkay) {
    reason = `Canonical source returned HTTP ${inspection.status}, but current page text did not preserve a reliable product/title identity signal for the committed analysis.`;
  } else if (matchedAnchors.length === 0) {
    reason = `Canonical source returned HTTP ${inspection.status}; current page text was inspected, but none of the prior observed-text anchors still matched exactly.`;
  } else {
    verdict = 'confirm';
    reason = `Canonical source returned HTTP ${inspection.status}; current page text preserves ${matchedAnchors.length}/${anchors.length} prior observed-text anchor(s) plus product identity. Existing rights/storage note was reviewed; no page body is persisted.`;
  }

  return validateRevalidationDecision({
    id: record.id,
    verdict,
    verifiedAt: VERIFIED_AT,
    verifier: VERIFIER,
    sourceChecked: true,
    analysisChecked: true,
    rightsChecked: true,
    accessStatus,
    notes: reason,
  });
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

const planPath = process.argv[2];
if (!planPath) throw new Error('usage: node p4-revalidation-audit.mjs <plan.json>');
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const records = loadRecords();
const byId = new Map(records.map((record) => [record.id, record]));
const targetSet = new Set(plan.target_ids ?? []);
if (targetSet.size !== 598 || targetSet.size !== (plan.target_ids ?? []).length) {
  throw new Error(`expected frozen target population of 598 unique IDs, got ${targetSet.size}`);
}

const allDecisions = [];
const waveEvidence = [];
for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex += 1) {
  const ids = plan.waves[waveIndex];
  const started = Date.now();
  const rows = await mapLimit(ids, CONCURRENCY, async (id) => {
    const record = byId.get(id);
    if (!record) throw new Error(`frozen target missing from catalog: ${id}`);
    const inspection = await inspectSource(record);
    const decision = decide(record, inspection);
    return {
      decision,
      audit: {
        id,
        canonical_url: record.canonicalUrl,
        http_status: inspection.status,
        final_url: inspection.url,
        content_type: inspection.contentType,
        attempts: inspection.attempts,
        error: inspection.error,
        verdict: decision.verdict,
        access_status: decision.accessStatus,
        decision_hash: decision.decisionHash,
      },
    };
  });

  allDecisions.push(...rows.map((row) => row.decision));
  const counts = rows.reduce((acc, row) => {
    acc[row.decision.verdict] = (acc[row.decision.verdict] ?? 0) + 1;
    acc[row.decision.accessStatus] = (acc[row.decision.accessStatus] ?? 0) + 1;
    return acc;
  }, {});
  waveEvidence.push({
    wave: waveIndex + 1,
    target_count: ids.length,
    duration_ms: Date.now() - started,
    counts,
    audits: rows.map((row) => row.audit),
  });
  console.log(`wave ${waveIndex + 1}/${plan.waves.length}: ${JSON.stringify(counts)}`);
}

if (allDecisions.length !== 598) {
  throw new Error(`expected 598 terminal decisions, got ${allDecisions.length}`);
}
const decisionIds = new Set(allDecisions.map((decision) => decision.id));
if (decisionIds.size !== targetSet.size || [...targetSet].some((id) => !decisionIds.has(id))) {
  throw new Error('decision set does not exactly match frozen target set');
}

const summary = allDecisions.reduce((acc, decision) => {
  acc[decision.verdict] += 1;
  acc.access[decision.accessStatus] += 1;
  return acc;
}, {
  target_count: 598,
  terminal_decision_count: 598,
  confirm: 0,
  stale: 0,
  archive: 0,
  access: { AVAILABLE: 0, PAYWALLED: 0, BLOCKED: 0, UNAVAILABLE: 0 },
});
summary.complete = true;
summary.verifier = VERIFIER;
summary.verified_at = VERIFIED_AT;
summary.wave_count = plan.waves.length;

writeFileSync('p4-review-log.jsonl', `${allDecisions.map((row) => JSON.stringify(row)).join('\n')}\n`);
writeFileSync('p4-normalized-decisions.json', `${JSON.stringify(allDecisions, null, 2)}\n`);
writeFileSync('p4-wave-evidence.json', `${JSON.stringify(waveEvidence, null, 2)}\n`);
writeFileSync('p4-audit-summary.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
