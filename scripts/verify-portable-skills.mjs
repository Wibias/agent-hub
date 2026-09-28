#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORTABLE_TOP_LEVEL_KEYS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

const REASONING = new Set(['inherit', 'low', 'medium', 'high', 'xhigh']);
const ISOLATION = new Set(['inherit', 'none', 'prefer', 'required']);
const MUTATION = new Set(['inherit', 'read-only', 'writes-with-authority']);

const slash = (value) => value.split(sep).join('/');

export function parseTopLevelFrontmatterKeys(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return [];
  const keys = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') break;
    if (/^\s/.test(line)) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

function parseTopLevelScalar(text, wantedKey) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') break;
    if (/^\s/.test(line)) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match || match[1] !== wantedKey) continue;
    const raw = match[2];
    if (!raw || raw === '>' || raw === '>-' || raw === '|' || raw === '|-') return null;
    return raw.replace(/^['"]|['"]$/g, '');
  }
  return null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function topLevelSkills(root) {
  const skillsDir = join(root, 'skills');
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    try {
      if (!(await stat(skillPath)).isFile()) continue;
    } catch {
      continue;
    }
    const text = await readFile(skillPath, 'utf8');
    skills.push({
      path: slash(relative(root, skillPath)),
      name: parseTopLevelScalar(text, 'name'),
      keys: parseTopLevelFrontmatterKeys(text),
    });
  }
  return skills.sort((a, b) => a.path.localeCompare(b.path));
}

function validateHintField(errors, skillName, field, value, allowed) {
  if (value === undefined) return;
  if (!allowed.has(value)) errors.push(`runtime hint ${skillName}: invalid ${field} value ${JSON.stringify(value)}`);
}

export async function validateRepositoryRuntimePolicy(root = process.cwd()) {
  const resolvedRoot = resolve(root);
  const errors = [];
  const skills = await topLevelSkills(resolvedRoot);
  const exceptionsPath = join(resolvedRoot, 'agent-runtime', 'portable-skill-exceptions.json');
  const runtimePath = join(resolvedRoot, 'agent-runtime', 'skill-runtime.json');

  let exceptions = {};
  let runtime = null;
  try {
    exceptions = await readJson(exceptionsPath);
  } catch (error) {
    errors.push(`cannot read ${slash(relative(resolvedRoot, exceptionsPath))}: ${error.message}`);
  }
  try {
    runtime = await readJson(runtimePath);
  } catch (error) {
    errors.push(`cannot read ${slash(relative(resolvedRoot, runtimePath))}: ${error.message}`);
  }

  const byPath = new Map(skills.map((skill) => [skill.path, skill]));
  const byName = new Map();
  for (const skill of skills) {
    if (!skill.name) {
      errors.push(`${skill.path}: missing simple top-level name`);
      continue;
    }
    if (byName.has(skill.name)) {
      errors.push(`duplicate top-level skill name ${skill.name}: ${byName.get(skill.name).path} and ${skill.path}`);
    } else {
      byName.set(skill.name, skill);
    }
    const permitted = new Set(exceptions?.[skill.path] ?? []);
    for (const key of skill.keys) {
      if (!PORTABLE_TOP_LEVEL_KEYS.has(key) && !permitted.has(key)) {
        errors.push(`${skill.path}: nonportable top-level field ${key} is not documented as an exception`);
      }
    }
  }

  if (exceptions && typeof exceptions === 'object' && !Array.isArray(exceptions)) {
    for (const [path, keys] of Object.entries(exceptions)) {
      const skill = byPath.get(path);
      if (!skill) {
        errors.push(`portable exception references missing top-level skill ${path}`);
        continue;
      }
      if (!Array.isArray(keys)) {
        errors.push(`portable exception ${path} must be an array of field names`);
        continue;
      }
      for (const key of keys) {
        if (!skill.keys.includes(key)) errors.push(`portable exception ${path}: stale field ${key} is not present`);
        if (PORTABLE_TOP_LEVEL_KEYS.has(key)) errors.push(`portable exception ${path}: ${key} is already portable and must not be excepted`);
      }
    }
  }

  if (runtime) {
    if (runtime.version !== 1) errors.push(`skill-runtime.json: unsupported version ${JSON.stringify(runtime.version)}`);
    const defaults = runtime.defaults ?? {};
    validateHintField(errors, 'defaults', 'reasoning', defaults.reasoning, REASONING);
    validateHintField(errors, 'defaults', 'isolation', defaults.isolation, ISOLATION);
    validateHintField(errors, 'defaults', 'mutation', defaults.mutation, MUTATION);

    if (!runtime.skills || typeof runtime.skills !== 'object' || Array.isArray(runtime.skills)) {
      errors.push('skill-runtime.json: skills must be an object');
    } else {
      for (const [skillName, hint] of Object.entries(runtime.skills)) {
        if (!byName.has(skillName)) errors.push(`runtime hint references unknown skill ${skillName}`);
        if (!hint || typeof hint !== 'object' || Array.isArray(hint)) {
          errors.push(`runtime hint ${skillName}: value must be an object`);
          continue;
        }
        const unknownFields = Object.keys(hint).filter((key) => !['reasoning', 'isolation', 'mutation'].includes(key));
        for (const field of unknownFields) errors.push(`runtime hint ${skillName}: unknown field ${field}`);
        validateHintField(errors, skillName, 'reasoning', hint.reasoning, REASONING);
        validateHintField(errors, skillName, 'isolation', hint.isolation, ISOLATION);
        validateHintField(errors, skillName, 'mutation', hint.mutation, MUTATION);
      }
    }
  }

  return { errors, skills };
}

export async function main(argv = process.argv.slice(2)) {
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : process.cwd();
  if (rootIndex >= 0 && !root) {
    console.error('verify-portable-skills: --root requires a path');
    return 2;
  }
  try {
    const result = await validateRepositoryRuntimePolicy(root);
    if (result.errors.length) {
      console.error(`verify-portable-skills: ${result.errors.length} error(s)`);
      for (const error of result.errors) console.error(`- ${error}`);
      return 1;
    }
    console.log(`verify-portable-skills: PASS (${result.skills.length} top-level skills)`);
    return 0;
  } catch (error) {
    console.error(`verify-portable-skills: blocked: ${error.message}`);
    return 2;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
