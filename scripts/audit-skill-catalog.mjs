#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeSlash, parseFrontmatter, readText, score, similarity, tokenize, walkFiles,
} from '../skills/skill-ratchet/scripts/shared.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const options = {
    skillsRoot: path.join(repoRoot, 'skills'),
    cases: path.join(repoRoot, 'tests', 'skill-catalog', 'catalog-routing.jsonl'),
    json: false,
    strict: false,
    reviewPrompt: false,
    threshold: 0.4,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skills-root') options.skillsRoot = path.resolve(argv[++i]);
    else if (arg === '--cases') options.cases = path.resolve(argv[++i]);
    else if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--review-prompt') options.reviewPrompt = true;
    else if (arg === '--threshold') options.threshold = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!(options.threshold >= 0 && options.threshold <= 1)) throw new Error('--threshold must be between 0 and 1');
  return options;
}

function splitDiscovery(description) {
  const marker = description.match(/\b(?:do not use(?: merely)?(?: as (?:the )?entry[- ]?point)? (?:for|to)|not for)\s*:?\s*/i);
  if (!marker?.index && marker?.index !== 0) return { positive: description, negative: '' };
  return {
    positive: description.slice(0, marker.index).trim(),
    negative: description.slice(marker.index + marker[0].length).trim(),
  };
}

function classification(filePath, metadata, description) {
  const normalized = normalizeSlash(filePath).toLowerCase();
  const status = String(metadata.status ?? '').toLowerCase();
  if (['inactive', 'retired', 'disabled'].includes(status) || String(metadata.deprecated).toLowerCase() === 'true') return 'inactive';
  if (normalized.includes('/skills/superpowers/')) return 'vendored';
  if (/\bredirect\b/i.test(description)) return 'redirect';
  return 'active';
}

function exactAliasMention(prompt, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_-])${escaped}([^a-z0-9_-]|$)`, 'i').test(prompt);
}

function explicitActiveInvocation(prompt, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const negated = new RegExp(`\\b(?:do not|don't|never)\\s+(?:use|run|invoke|apply)\\s+/?${escaped}\\b`, 'i');
  if (negated.test(prompt)) return false;
  return [
    new RegExp(`\\b(?:use|run|invoke|apply)\\s+/?${escaped}\\b`, 'i'),
    new RegExp(`(?:^|\\s)/${escaped}\\b`, 'i'),
    new RegExp(`\\b${escaped}\\s+(?:skill|specialist|workflow)\\b`, 'i'),
  ].some((pattern) => pattern.test(prompt));
}

async function loadCatalog(skillsRoot) {
  const files = (await walkFiles(skillsRoot)).filter((file) => path.basename(file) === 'SKILL.md');
  const catalog = [];
  for (const file of files) {
    const text = await readText(file, 16384);
    const metadata = parseFrontmatter(text);
    const description = metadata.description ?? '';
    const name = metadata.name || path.basename(path.dirname(file));
    const split = splitDiscovery(description);
    catalog.push({
      name,
      path: normalizeSlash(path.relative(repoRoot, file) || file),
      root_relative: normalizeSlash(path.relative(skillsRoot, file)),
      description,
      classification: classification(file, metadata, description),
      positive_tokens: tokenize(`${name} ${name} ${name} ${split.positive}`),
      negative_tokens: tokenize(split.negative),
    });
  }

  const grouped = new Map();
  for (const entry of catalog) {
    const key = entry.name.toLowerCase();
    const group = grouped.get(key) ?? [];
    group.push(entry);
    grouped.set(key, group);
  }
  const deduped = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => {
      const aDepth = a.root_relative.split('/').length;
      const bDepth = b.root_relative.split('/').length;
      return aDepth - bDepth || a.root_relative.localeCompare(b.root_relative);
    });
    const [{ root_relative, ...canonical }, ...variants] = group;
    canonical.variant_count = variants.length;
    deduped.push(canonical);
  }
  deduped.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return deduped;
}

function workflowLeak(description) {
  return /\b(?:must|always)\s+(?:run|load|read|execute|call|invoke)\b/i.test(description)
    || /\b(?:do not|don't|never)\s+(?:run|load|read|execute|call|invoke)\b/i.test(description)
    || /(?:^|[\s`])(?:scripts\/|scripts\\)[^\s`]+/i.test(description)
    || /\bnode\s+[^.\s]+\.m?js\b/i.test(description);
}

function broadTrigger(description) {
  return /\buse when (?:working with|writing|building|fixing|debugging|testing|finishing|committing)\b/i.test(description);
}

function sharedTokenCount(left, right) {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function findingsFor(catalog) {
  const findings = [];
  for (const entry of catalog) {
    if (entry.classification === 'inactive') continue;
    if (workflowLeak(entry.description)) findings.push({
      code: 'WORKFLOW_LEAK', severity: 'warning', skill: entry.name,
      message: 'Discovery description contains execution procedure that belongs in the skill workflow.',
    });
    if (broadTrigger(entry.description)) findings.push({
      code: 'BROAD_TRIGGER', severity: 'warning', skill: entry.name,
      message: 'Discovery description uses a broad activity trigger that can absorb unrelated requests.',
    });
  }

  const routable = catalog.filter((entry) => entry.classification === 'active');
  for (let i = 0; i < routable.length; i += 1) {
    for (let j = i + 1; j < routable.length; j += 1) {
      const left = routable[i];
      const right = routable[j];
      const overlap = similarity(left.positive_tokens, right.positive_tokens);
      if (overlap < 0.42 || sharedTokenCount(left.positive_tokens, right.positive_tokens) < 4) continue;
      findings.push({
        code: 'DISCOVERY_OVERLAP', severity: 'info', skills: [left.name, right.name],
        score: Number(overlap.toFixed(4)),
        message: 'Active discovery surfaces overlap enough to merit semantic review.',
      });
    }
  }
  return findings;
}

async function loadCases(casesPath) {
  let text;
  try { text = await readFile(casesPath, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      const row = JSON.parse(line);
      if (!row.id || typeof row.prompt !== 'string' || !Object.hasOwn(row, 'expected_skill')) throw new Error('requires id, prompt, and expected_skill');
      if (row.expected_skill !== null && typeof row.expected_skill !== 'string') throw new Error('expected_skill must be string or null');
      return row;
    } catch (error) {
      throw new Error(`${casesPath}:${index + 1}: ${error.message}`);
    }
  });
}

function routeCase(row, catalog, threshold) {
  const queryTokens = tokenize(row.prompt);
  const candidates = [];
  for (const entry of catalog) {
    if (entry.classification === 'inactive' || entry.classification === 'vendored') continue;
    let candidateScore = score(queryTokens, entry.positive_tokens);
    const identityTokens = tokenize(entry.name);
    let negativeOverlap = 0;
    for (const token of queryTokens) {
      if (entry.negative_tokens.has(token) && !identityTokens.has(token)) negativeOverlap += 1;
    }
    if (negativeOverlap >= 2) candidateScore = 0;
    const explicitOnly = /\bexplicit(?:-only|\s+only)\b|\buse only when\b/i.test(entry.description);
    if (entry.classification === 'active' && explicitOnly) {
      if (explicitActiveInvocation(row.prompt, entry.name)) candidateScore = Math.max(candidateScore, 0.95);
      else candidateScore = Number((candidateScore * 0.35).toFixed(4));
    }
    if (entry.classification === 'redirect') {
      if (exactAliasMention(row.prompt, entry.name)) candidateScore = Math.max(candidateScore, 0.95);
      else candidateScore = Number((candidateScore * 0.35).toFixed(4));
    }
    candidates.push({ name: entry.name, classification: entry.classification, score: candidateScore });
  }
  candidates.sort((a, b) => b.score - a.score || (a.classification === 'active' ? -1 : 1) || a.name.localeCompare(b.name));
  const top = candidates[0];
  const second = candidates[1];
  const actualSkill = top && top.score >= threshold ? top.name : null;
  const ambiguous = actualSkill !== null && second?.score >= threshold && second.score >= top.score * 0.9;
  return {
    id: row.id,
    prompt: row.prompt,
    expected_skill: row.expected_skill,
    actual_skill: actualSkill,
    top_score: top?.score ?? 0,
    ambiguous: Boolean(ambiguous),
    candidates: candidates.slice(0, 5),
    pass: actualSkill === row.expected_skill && !ambiguous,
  };
}

function reviewPrompt(result) {
  const catalogLines = result.catalog
    .filter((entry) => entry.classification !== 'inactive')
    .map((entry) => `- ${entry.name} [${entry.classification}]: ${entry.description}`)
    .join('\n');
  const caseLines = result.cases.map((row) => `- ${row.id}: ${row.prompt} -> ${JSON.stringify(row.expected_skill)}`).join('\n');
  return `Review this Agent Skill discovery catalog as discovery metadata only.\n\nRules:\n- Judge routing from name + description first.\n- A generic request may correctly route to no skill.\n- Prefer canonical active owners over redirects unless the user explicitly invokes the redirect alias.\n- Open a full SKILL.md only when name + description remain genuinely ambiguous.\n- Report broad triggers, workflow leakage, and collisions. Do not rewrite skills in this review.\n\nCatalog:\n${catalogLines}\n\nCases:\n${caseLines}\n`;
}

export async function auditCatalog(options) {
  const catalog = await loadCatalog(options.skillsRoot);
  const rawCases = await loadCases(options.cases);
  const cases = rawCases.map((row) => routeCase(row, catalog, options.threshold));
  const findings = findingsFor(catalog);
  return {
    catalog: catalog.map(({ positive_tokens, negative_tokens, ...entry }) => entry),
    findings,
    cases,
    summary: {
      skills: catalog.length,
      active: catalog.filter((entry) => entry.classification === 'active').length,
      redirects: catalog.filter((entry) => entry.classification === 'redirect').length,
      vendored: catalog.filter((entry) => entry.classification === 'vendored').length,
      inactive: catalog.filter((entry) => entry.classification === 'inactive').length,
      findings: findings.length,
      case_failures: cases.filter((row) => !row.pass).length,
    },
  };
}

function help() {
  return `Usage: node scripts/audit-skill-catalog.mjs [options]\n\nOptions:\n  --skills-root <path>  Skill tree to inspect (default: skills/)\n  --cases <path>        JSONL routing cases\n  --threshold <0..1>    Minimum deterministic route score (default: 0.4)\n  --json                Emit machine-readable result\n  --review-prompt       Print bounded model-review prompt\n  --strict              Exit non-zero on routing-case failures\n`;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(help());
  process.exit(0);
}
const result = await auditCatalog(options);
if (options.reviewPrompt) process.stdout.write(reviewPrompt(result));
else if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  process.stdout.write(`Skill catalog audit: ${result.summary.skills} skills, ${result.summary.findings} finding(s), ${result.summary.case_failures} routing-case failure(s).\n`);
  for (const finding of result.findings) process.stdout.write(`- ${finding.code}: ${finding.skill ?? finding.skills?.join(' <-> ')}: ${finding.message}\n`);
  for (const row of result.cases.filter((entry) => !entry.pass)) process.stdout.write(`- ROUTING_CASE ${row.id}: expected ${JSON.stringify(row.expected_skill)}, got ${JSON.stringify(row.actual_skill)}${row.ambiguous ? ' (ambiguous)' : ''}\n`);
}
if (options.strict && result.cases.some((row) => !row.pass)) process.exitCode = 1;