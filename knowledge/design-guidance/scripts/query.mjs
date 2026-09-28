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
      sourceType: 'heuristic-guidance'
    }
  }));

if (ranked.length === 0) {
  emit({
    domain,
    query,
    count: 0,
    match: 'none',
    message: 'No verified guidance match. Retry once with a narrower semantic query, then fall back explicitly without claiming a catalog match.',
    results: []
  }, asJson);
  process.exit(2);
}

emit({ domain, query, count: ranked.length, match: 'catalog', results: ranked }, asJson);
