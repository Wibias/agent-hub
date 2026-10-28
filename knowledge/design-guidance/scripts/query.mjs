#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(here, '..', 'catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const domains = [...new Set(catalog.records.map((row) => row.domain))].sort();

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function score(queryTokens, row) {
  const title = tokenize(row.title);
  const keywords = row.keywords.flatMap(tokenize);
  const body = tokenize(`${row.guidance} ${row.avoid} ${row.accessibility}`);
  const titleSet = new Set(title);
  const keywordSet = new Set(keywords);
  const bodySet = new Set(body);
  let total = 0;
  for (const token of queryTokens) {
    if (keywordSet.has(token)) total += 4;
    else if (titleSet.has(token)) total += 3;
    else if (bodySet.has(token)) total += 1;
  }
  return total;
}

function parseUtcDate(text, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text))) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const value = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(value)) throw new Error(`${label} is not a valid date`);
  return value;
}

function freshnessFor(source) {
  const policy = source?.freshnessPolicy;
  if (!policy || !Number.isInteger(policy.reviewAfterDays) || !Number.isInteger(policy.hardExpireAfterDays)) {
    throw new Error('catalog source freshnessPolicy is missing or invalid');
  }
  if (policy.reviewAfterDays < 0 || policy.hardExpireAfterDays <= policy.reviewAfterDays) {
    throw new Error('catalog freshness windows are invalid');
  }

  const reviewedAtMs = parseUtcDate(source.reviewedAt, 'catalog source reviewedAt');
  const nowText = process.env.DESIGN_GUIDANCE_NOW || new Date().toISOString().slice(0, 10);
  const nowMs = parseUtcDate(nowText, 'DESIGN_GUIDANCE_NOW');
  const ageDays = Math.floor((nowMs - reviewedAtMs) / 86400000);
  if (ageDays < 0) throw new Error('catalog reviewedAt cannot be in the future');

  const status = ageDays > policy.hardExpireAfterDays
    ? 'expired'
    : ageDays > policy.reviewAfterDays
      ? 'review-due'
      : 'current';

  return {
    status,
    ageDays,
    reviewedAt: source.reviewedAt,
    reviewAfterDays: policy.reviewAfterDays,
    hardExpireAfterDays: policy.hardExpireAfterDays,
  };
}

function emit(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (payload.domains) {
    process.stdout.write(`${payload.domains.join('\n')}\n`);
    return;
  }
  process.stdout.write(`design-guidance: ${payload.domain} | ${payload.query}\n`);
  if (payload.freshness) {
    process.stdout.write(`freshness: ${payload.freshness.status} (${payload.freshness.ageDays}d since review)\n`);
  }
  if (payload.count === 0) {
    process.stdout.write(`${payload.message}\n`);
    return;
  }
  for (const row of payload.results) {
    process.stdout.write(`\n${row.id}: ${row.title}\n${row.guidance}\nAvoid: ${row.avoid}\nAccessibility: ${row.accessibility}\n`);
  }
}

const asJson = process.argv.includes('--json');
if (process.argv.includes('--list-domains')) {
  emit({ domains }, asJson);
  process.exit(0);
}

const domain = value('--domain');
const query = value('--query');
const rawMax = value('--max-results');
const maxResults = rawMax === null ? 3 : Number(rawMax);

if (!domain || !domains.includes(domain)) {
  process.stderr.write(`design-guidance: --domain must be one of ${domains.join(', ')}\n`);
  process.exit(64);
}
if (!query?.trim()) {
  process.stderr.write('design-guidance: --query is required\n');
  process.exit(64);
}
if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 5) {
  process.stderr.write('design-guidance: --max-results must be an integer from 1 to 5\n');
  process.exit(64);
}

let freshness;
try {
  freshness = freshnessFor(catalog.source);
} catch (error) {
  process.stderr.write(`design-guidance: ${error.message}\n`);
  process.exit(65);
}

if (freshness.status === 'expired') {
  emit({
    domain,
    query,
    count: 0,
    match: 'stale-catalog',
    message: 'Design guidance catalog is hard-expired. Refresh/review its upstream provenance before treating any result as verified guidance.',
    freshness,
    results: [],
  }, asJson);
  process.exit(3);
}

const queryTokens = tokenize(query);
const ranked = catalog.records
  .filter((row) => row.domain === domain)
  .map((row) => ({ row, score: score(queryTokens, row) }))
  .filter(({ score }) => score > 0)
  .sort((left, right) => right.score - left.score || left.row.id.localeCompare(right.row.id))
  .slice(0, maxResults)
  .map(({ row, score }) => ({
    ...row,
    score,
    provenance: {
      ...catalog.source,
      freshness,
      sourceType: 'heuristic-guidance',
    },
  }));

if (ranked.length === 0) {
  emit({
    domain,
    query,
    count: 0,
    match: 'none',
    message: 'No verified guidance match. Retry once with a narrower semantic query, then fall back explicitly without claiming a catalog match.',
    freshness,
    results: [],
  }, asJson);
  process.exit(2);
}

emit({ domain, query, count: ranked.length, match: 'catalog', freshness, results: ranked }, asJson);
