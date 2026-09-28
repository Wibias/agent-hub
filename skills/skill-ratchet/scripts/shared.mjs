import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'by', 'do', 'does',
  'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'the', 'this',
  'to', 'use', 'uses', 'using', 'when', 'with', 'your', 'you', 'any', 'all',
  'only', 'skill', 'skills',
]);

const EXCLUDED_SEGMENTS = new Set([
  'node_modules', '.git', '.sandbox-secrets', 'secret', 'secrets',
  'credential', 'credentials',
  '.github-delivery-backups', '.github-delivery-hotfix-backups',
]);

export function tokenize(text = '') {
  const result = new Set();
  for (const match of text.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    const token = match[0];
    if (token.length > 1 && !STOPWORDS.has(token)) result.add(token);
  }
  return result;
}

export function similarity(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

export function score(queryTokens, surfaceTokens) {
  if (!queryTokens.size || !surfaceTokens.size) return 0;
  let intersection = 0;
  for (const token of queryTokens) if (surfaceTokens.has(token)) intersection += 1;
  const recall = intersection / queryTokens.size;
  return Number(Math.max(similarity(queryTokens, surfaceTokens), recall * 0.85).toFixed(4));
}

export function parseFrontmatter(text = '') {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    const [, key, raw] = field;
    if (/^[>|][+-]?$/.test(raw.trim())) {
      const parts = [];
      for (let child = index + 1; child < lines.length; child += 1) {
        if (/^\S[^:]*:/.test(lines[child])) break;
        const value = lines[child].match(/^\s+(.*)$/);
        if (value) parts.push(value[1].trim());
      }
      result[key] = parts.join(' ').trim();
    } else {
      result[key] = raw.trim().replace(/^(?:"|')|(?:"|')$/g, '');
    }
  }
  return result;
}

export function isExcluded(filePath) {
  return path.resolve(filePath).split(path.sep).some((part) => EXCLUDED_SEGMENTS.has(part.toLowerCase()));
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readText(target, limit = Infinity) {
  try {
    const text = await readFile(target, 'utf8');
    return text.slice(0, limit);
  } catch {
    return '';
  }
}

export async function walkFiles(root) {
  const files = [];
  async function visit(current) {
    if (isExcluded(current)) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (isExcluded(full)) continue;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  await visit(root);
  return files;
}

export function isInside(parent, candidate) {
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeSlash(value) {
  return String(value).replaceAll('\\', '/');
}

export function parseJsonLines(text, label, errors) {
  const rows = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      errors.push(`${label} line ${index + 1}: invalid JSON (${error.message})`);
    }
  });
  return rows;
}
