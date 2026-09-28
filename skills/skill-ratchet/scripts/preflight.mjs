import { homedir, tmpdir } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isExcluded, isInside, parseFrontmatter, pathExists, readText, score,
  similarity, tokenize, walkFiles,
} from './shared.mjs';

function addRoot(roots, label, candidatePath, kind, priority, caller = false) {
  if (!candidatePath) return;
  if (!path.isAbsolute(candidatePath)) {
    if (caller) roots.warnings.push(`Relative root skipped: ${candidatePath}`);
    return;
  }
  roots.items.push({ label, path: path.resolve(candidatePath), kind, priority, caller });
}

async function candidateFromFile(filePath, source, kind, priority, discoveryOnly) {
  if (isExcluded(filePath)) return null;
  if (kind === 'skill') {
    const text = await readText(filePath, 8192);
    const metadata = parseFrontmatter(text);
    const name = metadata.name || path.basename(path.dirname(filePath));
    const description = metadata.description || '';
    let surface;
    let negative = '';
    const negativeMatch = description.match(/^([\s\S]*?)\bdo not use for:\s*([\s\S]*)$/i);
    if (discoveryOnly && negativeMatch) {
      surface = `${name} ${name} ${name} ${negativeMatch[1]}`;
      negative = negativeMatch[2];
    } else {
      surface = discoveryOnly
        ? `${name} ${name} ${name} ${description}`
        : `${name} ${name} ${name} ${description} ${text}`;
    }
    return {
      path: filePath,
      source_root: source,
      kind,
      priority,
      canonical: name.toLowerCase(),
      tokens: tokenize(surface),
      negative_tokens: tokenize(negative),
      security_flags: [
        /ignore (?:all )?(?:previous|prior) instructions/i.test(text) && 'instruction-override',
        /(?:reveal|print|output|expose).{0,40}system prompt/i.test(text) && 'system-prompt-exfiltration',
        /(?:send|upload|exfiltrat).{0,60}(?:secret|token|credential|environment)/i.test(text) && 'potential-secret-exfiltration',
      ].filter(Boolean),
    };
  }

  const limit = kind === 'rule' ? 900 : 1800;
  const text = await readText(filePath, limit);
  const surface = kind === 'rule' ? `${path.basename(filePath, path.extname(filePath))} ${text}` : text;
  return {
    path: filePath,
    source_root: source,
    kind,
    priority,
    canonical: '',
    tokens: tokenize(surface),
    negative_tokens: new Set(),
  };
}

export async function runPreflight(options) {
  const started = Date.now();
  const threshold = options.threshold ?? 0.4;
  if (!options.query?.trim()) throw new Error('preflight requires a non-empty query');
  if (threshold < 0 || threshold > 1) throw new Error('threshold must be between 0 and 1');

  const roots = { items: [], warnings: [] };
  const agentsHome = process.env.AGENTS_HOME || path.join(homedir(), '.agents');
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  if (options.includeDefaults !== false) {
    addRoot(roots, 'user-skills', path.join(agentsHome, 'skills'), 'skills', 0);
    addRoot(roots, 'agents-rules', path.join(agentsHome, 'rules'), 'rules', 0);
    addRoot(roots, 'agents-hub', path.join(agentsHome, 'AGENTS.md'), 'agents-file', 0);
    addRoot(roots, 'codex-system-skills', path.join(codexHome, 'skills', '.system'), 'skills', 2);
    addRoot(roots, 'codex-plugin-cache', path.join(codexHome, 'plugins', 'cache'), 'skills', 3);
  }

  if (options.projectRoot) {
    if (!path.isAbsolute(options.projectRoot)) roots.warnings.push(`Relative project root skipped: ${options.projectRoot}`);
    else {
      const project = path.resolve(options.projectRoot);
      addRoot(roots, 'project-agents-hub', path.join(project, 'AGENTS.md'), 'agents-file', 1);
      addRoot(roots, 'project-rules:.agents/rules', path.join(project, '.agents', 'rules'), 'rules', 1);
      addRoot(roots, 'project-rules:agent-rules', path.join(project, 'agent-rules'), 'rules', 1);
      addRoot(roots, 'project-rules:.cursor/rules', path.join(project, '.cursor', 'rules'), 'rules', 1);
      addRoot(roots, 'project-skills:.agents', path.join(project, '.agents', 'skills'), 'skills', 1);
      addRoot(roots, 'project-skills:.codex', path.join(project, '.codex', 'skills'), 'skills', 1);
      addRoot(roots, 'project-skills:.github', path.join(project, '.github', 'skills'), 'skills', 1);
    }
  }
  (options.skillRoots || []).forEach((root, index) => addRoot(roots, `skill-root:${index + 1}`, root, 'skills', 4, true));
  (options.roots || []).forEach((root, index) => addRoot(roots, `extra:${index + 1}`, root, 'mixed', 4, true));

  const seen = new Set();
  const uniqueRoots = roots.items.filter((root) => {
    const key = process.platform === 'win32' ? root.path.toLowerCase() : root.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rootsChecked = [];
  const candidates = [];
  for (const root of uniqueRoots) {
    const exists = await pathExists(root.path);
    rootsChecked.push({ label: root.label, path: root.path, kind: root.kind, exists });
    if (!exists) {
      if (root.caller) roots.warnings.push(`Root not found, skipped: ${root.path}`);
      continue;
    }
    if (root.kind === 'agents-file') {
      const candidate = await candidateFromFile(root.path, root.label, 'agents', root.priority, options.discoveryOnly);
      if (candidate) candidates.push(candidate);
      continue;
    }
    const files = await walkFiles(root.path);
    for (const file of files) {
      if ((root.kind === 'skills' || root.kind === 'mixed') && path.basename(file) === 'SKILL.md') {
        const candidate = await candidateFromFile(file, root.label, 'skill', root.priority, options.discoveryOnly);
        if (candidate) candidates.push(candidate);
      }
      if ((root.kind === 'rules' || root.kind === 'mixed') && path.basename(file) !== 'SKILL.md' && ['.md', '.mdc'].includes(path.extname(file))) {
        const candidate = await candidateFromFile(file, root.label, 'rule', root.priority, options.discoveryOnly);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  const queryTokens = tokenize(options.query);
  const scored = candidates.map((candidate) => {
    let candidateScore = score(queryTokens, candidate.tokens);
    if (options.discoveryOnly && candidate.kind === 'skill') {
      let overlap = 0;
      for (const token of queryTokens) if (candidate.negative_tokens.has(token)) overlap += 1;
      if (overlap >= 2) candidateScore = 0;
    }
    return { ...candidate, score: candidateScore };
  });

  const grouped = new Map();
  for (const candidate of scored) {
    const key = candidate.kind === 'skill' ? `skill:${candidate.canonical}` : `path:${candidate.path}`;
    const group = grouped.get(key) || [];
    group.push(candidate);
    grouped.set(key, group);
  }
  const deduped = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));
    const canonical = group[0];
    deduped.push(canonical);
    for (const candidate of group.slice(1)) {
      if (candidate.kind !== 'skill' || similarity(canonical.tokens, candidate.tokens) < 0.8) {
        deduped.push({ ...candidate, variant_note: `Routing surface differs from higher-priority '${canonical.source_root}' copy.` });
      }
    }
  }
  deduped.sort((a, b) => b.score - a.score || a.priority - b.priority || a.path.localeCompare(b.path));
  const topScore = deduped[0]?.score || 0;
  const plausibleCutoff = Math.max(threshold, Number((topScore * 0.75).toFixed(4)));
  const ranked = deduped.slice(0, 10).map((candidate, index) => {
    const result = {
      path: candidate.path,
      source_root: candidate.source_root,
      kind: candidate.kind,
      score: candidate.score,
      plausible: candidate.score >= plausibleCutoff && index < 5,
    };
    if (candidate.variant_note) result.variant_note = candidate.variant_note;
    if (candidate.security_flags?.length) result.security_flags = candidate.security_flags;
    return result;
  });
  const plausibleCount = ranked.filter((entry) => entry.plausible).length;
  const status = topScore >= threshold ? 'REVIEW_MATCHES' : 'NO_MATCHES';
  const result = {
    query: options.query,
    timestamp: new Date().toISOString(),
    status,
    rationale: status === 'REVIEW_MATCHES'
      ? `${plausibleCount} bounded plausible candidate(s) scored >= ${plausibleCutoff}. Read each plausible candidate, then record REUSE, EXTEND, MERGE, or CREATE with evidence.`
      : `No candidate scored >= ${threshold}. Review at most the top 3 near-matches before considering CREATE.`,
    threshold,
    plausible_cutoff: plausibleCutoff,
    top_score: topScore,
    ranked,
    roots_checked: rootsChecked,
    warnings: roots.warnings,
    elapsed_ms: Date.now() - started,
  };

  if (options.evidence) {
    const evidence = path.resolve(options.evidence);
    if (!isInside(tmpdir(), evidence)) throw new Error(`Refusing evidence path outside OS temp: ${evidence}`);
    await mkdir(path.dirname(evidence), { recursive: true });
    await writeFile(evidence, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  return result;
}
