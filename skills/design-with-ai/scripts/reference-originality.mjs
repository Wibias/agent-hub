#!/usr/bin/env node
// Bounded, read-only evidence for exact file and long-copy overlaps.
// A match is a review lead, never an automated plagiarism or legal verdict.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP = new Set(['.git', '.cache', 'node_modules', 'package-lock.json', 'pnpm-lock.yaml']);
const TEXT = new Set(['.html', '.htm', '.md', '.txt', '.css', '.scss', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.json', '.svg']);
const MAX_FILES = 300;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SIGNALS = 80;

function argsFrom(argv) {
  const out = { candidate: null, references: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--candidate' && argv[i + 1]) out.candidate = argv[++i];
    else if (argv[i] === '--reference' && argv[i + 1]) out.references.push(argv[++i]);
    else if (argv[i] === '--json') { /* already JSON-only */ }
    else throw new Error('Usage: node reference-originality.mjs --candidate PATH --reference PATH [--reference PATH] [--json]');
  }
  if (!out.candidate || !out.references.length || out.references.length > 5) {
    throw new Error('One candidate and 1..5 explicit local references required');
  }
  return out;
}

function digest(data) {
  return createHash('sha256').update(data).digest('hex');
}

function textBlocks(source, extension) {
  let text = source;
  if (extension === '.html' || extension === '.htm' || extension === '.svg') {
    text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(?:p|li|h[1-6]|section|div)\s*>/gi, '\n\n')
      .replace(/<[^>]*>/g, ' ');
  }
  return [...new Set(text.split(/\n\s*\n+/g)
    .map(p => p.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(p => p.length >= 160 && p.split(/\s+/).length >= 20)
    .map(p => digest(p)))];
}

function collect(source) {
  const root = path.resolve(source);
  const st = lstatSync(root);
  if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) {
    throw new Error('Input must be a regular file or directory, not a symlink');
  }
  const paths = [];
  const visit = (p) => {
    const stat = lstatSync(p);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      const children = readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (!SKIP.has(child.name) && !child.name.startsWith('.')) visit(path.join(p, child.name));
      }
    } else if (stat.isFile()) {
      if (stat.size > MAX_FILE_BYTES) return;
      paths.push(p);
      if (paths.length > MAX_FILES) throw new Error('Too many files; narrow the inspected scope');
    }
  };
  visit(root);
  const rootReal = realpathSync(root);
  return paths.map(file => {
    const bytes = readFileSync(file);
    const extension = path.extname(file).toLowerCase();
    const relative = st.isFile() ? path.basename(file) : path.relative(root, file).replaceAll(path.sep, '/');
    const content = TEXT.has(extension) ? bytes.toString('utf8') : null;
    return {
      relative,
      sha256: digest(bytes),
      textDigests: content === null ? [] : textBlocks(content, extension),
      bytes: bytes.length,
    };
  });
}

export function compareOriginality(candidateFiles, referenceGroups) {
  const originals = new Map();
  const paragraphs = new Map();
  for (const group of referenceGroups) {
    for (const file of group.files) {
      const row = { source: group.name, file: file.relative };
      const exact = originals.get(file.sha256) ?? [];
      exact.push(row);
      originals.set(file.sha256, exact);
      for (const block of file.textDigests) {
        const rows = paragraphs.get(block) ?? [];
        rows.push(row);
        paragraphs.set(block, rows);
      }
    }
  }
  const signals = [];
  let omitted = 0;
  const push = signal => { if (signals.length < MAX_SIGNALS) signals.push(signal); else omitted++; };
  for (const file of candidateFiles) {
    for (const ref of originals.get(file.sha256) ?? []) {
      push({ type: 'EXACT_BYTES', candidate: file.relative, reference: ref,
        sha256: file.sha256, bytes: file.bytes });
    }
    const seen = new Set();
    for (const digest of file.textDigests) {
      for (const ref of paragraphs.get(digest) ?? []) {
        const key = ref.source + '\u0000' + ref.file;
        if (seen.has(key)) continue;
        seen.add(key);
        if ((originals.get(file.sha256) ?? []).some(match =>
          match.source === ref.source && match.file === ref.file)) continue;
        push({ type: 'EXACT_LONG_TEXT_BLOCK', candidate: file.relative, reference: ref,
          sha256: digest });
      }
    }
  }
  return {
    status: signals.length || omitted ? 'REVIEW_REQUIRED' : 'NO_EXACT_OVERLAPS_DETECTED',
    checkedCandidateFiles: candidateFiles.length,
    checkedReferenceFiles: referenceGroups.reduce((n, g) => n + g.files.length, 0),
    signals,
    omitted,
    interpretation: 'Signals establish identical bytes or normalized long text blocks, not infringement, intent, or originality clearance.',
    notChecked: ['Visual similarity and derivative imagery', 'Translated or paraphrased copy',
      'Motion or interaction similarity', 'Commit history', 'Licenses, fair use, and attribution status'],
  };
}

function main() {
  try {
    const args = argsFrom(process.argv.slice(2));
    const candidate = collect(args.candidate);
    const groups = args.references.map((name, i) => ({
      name: 'reference-' + (i + 1), files: collect(name),
    }));
    const result = compareOriginality(candidate, groups);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('Reference originality: ' + error.message + '\n');
    process.exitCode = 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
