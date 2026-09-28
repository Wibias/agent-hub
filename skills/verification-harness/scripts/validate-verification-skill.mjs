#!/usr/bin/env node
import { lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_SECTIONS = ['Launch', 'Doctor', 'Control surface', 'Drive', 'Evidence', 'Cleanup', 'Feature map'];
const SURFACES = new Set(['cli', 'web', 'desktop', 'api', 'mobile', 'library', 'tui']);
const RESULTS = new Set(['pass', 'fail', 'blocked']);

async function nonEmpty(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function helperFileState(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return 'not-regular';
    return info.size > 0 ? 'valid' : 'empty';
  } catch {
    return 'missing';
  }
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field) values[field[1]] = field[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return values;
}

function sectionBody(text, heading) {
  const headingPattern = heading.replace(' ', '\\s+');
  const match = new RegExp(`^##\\s+${headingPattern}\\s*$`, 'im').exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
}

function sectionField(body, name) {
  if (!body) return null;
  const match = new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'im').exec(body);
  return match?.[1]?.trim() || null;
}

async function validateControlSurface(root, text, errors) {
  const body = sectionBody(text, 'Control surface');
  if (!body) return;

  const mode = sectionField(body, 'Mode');
  const command = sectionField(body, 'Command');
  if (!['existing', 'helper'].includes(mode)) errors.push('Control surface Mode must be existing or helper');
  if (!command) errors.push('Control surface Command must name a reusable invocation');

  if (mode !== 'helper') return;
  const helper = sectionField(body, 'Helper');
  if (!helper) {
    errors.push('Control surface helper mode requires Helper: scripts/<path>');
    return;
  }

  const normalized = helper.replace(/\\/g, '/');
  if (path.isAbsolute(helper) || !normalized.startsWith('scripts/') || normalized.split('/').includes('..')) {
    errors.push('Control surface Helper must be a relative path under scripts/');
    return;
  }

  const state = await helperFileState(path.join(root, ...normalized.split('/')));
  if (state === 'missing' || state === 'empty') {
    errors.push(`Control surface helper missing or empty: ${helper}`);
  } else if (state !== 'valid') {
    errors.push(`Control surface Helper must be a non-empty regular verifier-owned file: ${helper}`);
  }
}

function validateReceipt(receipt, errors) {
  if (receipt.schema_version !== 1) errors.push('receipt schema_version must be 1');
  for (const key of ['run_id', 'repository', 'feature']) {
    if (typeof receipt[key] !== 'string' || !receipt[key].trim()) errors.push(`receipt ${key} must be a non-empty string`);
  }
  if (typeof receipt.head_sha !== 'string' || !/^[0-9a-f]{40}$/i.test(receipt.head_sha)) {
    errors.push('receipt head_sha must be a full 40-character git SHA');
  }
  if (!SURFACES.has(receipt.surface)) errors.push(`receipt surface must be one of: ${[...SURFACES].join(', ')}`);
  if (!RESULTS.has(receipt.result)) errors.push('receipt result must be pass, fail, or blocked');
  if (!RESULTS.has(receipt.cleanup)) errors.push('receipt cleanup must be pass, fail, or blocked');
  for (const key of ['checks', 'artifacts', 'side_effects', 'started_resources']) {
    if (!Array.isArray(receipt[key])) errors.push(`receipt ${key} must be an array`);
  }
  if (receipt.result === 'pass') {
    if (receipt.cleanup !== 'pass') errors.push('a passing receipt requires cleanup=pass');
    if (!Array.isArray(receipt.checks) || receipt.checks.length === 0) errors.push('a passing receipt requires at least one check');
    if (receipt.checks?.some((check) => check?.result !== 'pass')) errors.push('all checks in a passing receipt must pass');
  }
  if (receipt.result === 'blocked' && (typeof receipt.blocked_reason !== 'string' || !receipt.blocked_reason.trim())) {
    errors.push('a blocked receipt requires blocked_reason');
  }
}

async function main() {
  const [rootArg, ...rest] = process.argv.slice(2);
  if (!rootArg) throw new Error('usage: validate-verification-skill.mjs <skill-root> [--receipt <path>]');
  const receiptIndex = rest.indexOf('--receipt');
  const receiptPath = receiptIndex >= 0 ? rest[receiptIndex + 1] : null;
  if (receiptIndex >= 0 && !receiptPath) throw new Error('--receipt requires a path');

  const root = path.resolve(rootArg);
  const skillPath = path.join(root, 'SKILL.md');
  const featureMapPath = path.join(root, 'features', 'README.md');
  const errors = [];

  if (!(await nonEmpty(skillPath))) errors.push(`SKILL.md missing or empty: ${skillPath}`);
  if (!(await nonEmpty(featureMapPath))) errors.push(`features/README.md missing or empty: ${featureMapPath}`);

  if (await nonEmpty(skillPath)) {
    const text = await readFile(skillPath, 'utf8');
    const frontmatter = parseFrontmatter(text);
    if (!frontmatter.name || !/^verify-[a-z0-9][a-z0-9-]*$/.test(frontmatter.name)) {
      errors.push("frontmatter name must match 'verify-<app>' using lowercase letters, digits, and hyphens");
    }
    if (!frontmatter.description) errors.push('frontmatter description is required');
    for (const section of REQUIRED_SECTIONS) {
      if (!new RegExp(`^##\\s+${section.replace(' ', '\\s+')}\\s*$`, 'im').test(text)) errors.push(`required section missing: ${section}`);
    }
    if (/\.cursor[\\/]skills[\\/]/i.test(text)) errors.push('Cursor-specific .cursor/skills paths are not allowed in a portable project verifier');
    await validateControlSurface(root, text, errors);
  }

  if (receiptPath) {
    let receipt;
    try {
      receipt = JSON.parse(await readFile(path.resolve(receiptPath), 'utf8'));
    } catch (error) {
      errors.push(`receipt missing or invalid JSON: ${error.message}`);
    }
    if (receipt) validateReceipt(receipt, errors);
  }

  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`verification skill valid: ${root}${receiptPath ? ' with receipt' : ''}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
