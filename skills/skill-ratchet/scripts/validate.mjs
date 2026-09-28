import { tmpdir } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  isInside, normalizeSlash, parseFrontmatter, parseJsonLines, sha256,
} from './shared.mjs';

const REQUIRED_CASES = ['D1', 'D2', 'D3', 'N1', 'N2', 'N3', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
const REQUIRED_EDGE = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
const REQUIRED_FIELDS = [
  'id', 'category', 'invocation', 'prompt', 'expected_skill',
  'expected_resources', 'unnecessary_resources', 'assertion_ids', 'scenario',
];

async function nonEmpty(target) {
  try {
    return (await stat(target)).size > 0;
  } catch {
    return false;
  }
}

async function fileExists(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

function validateCase(row, label, errors, includeAdded = false) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in row)) errors.push(`${label} '${row.id || '<no id>'}' missing '${field}'`);
  }
  for (const field of ['id', 'category', 'invocation', 'prompt', 'scenario']) {
    if (typeof row[field] !== 'string' || !row[field].trim()) errors.push(`${label} '${row.id || '<no id>'}' has invalid '${field}'`);
  }
  for (const field of ['expected_resources', 'unnecessary_resources', 'assertion_ids']) {
    if (!Array.isArray(row[field])) errors.push(`${label} '${row.id || '<no id>'}' '${field}' must be an array`);
  }
  if (!row.assertion_ids?.length) errors.push(`${label} '${row.id || '<no id>'}' requires at least one assertion ID`);
  if (includeAdded && (typeof row.added !== 'string' || !row.added.trim())) errors.push(`${label} '${row.id || '<no id>'}' missing 'added'`);
  const categories = ['config', 'must-trigger', 'must-not-trigger', 'explicit-invocation', 'implicit-invocation', 'routing', 'adversarial', 'regression'];
  if (!categories.includes(row.category)) errors.push(`${label} '${row.id}' has invalid category '${row.category}'`);
  if (!['n/a', 'explicit', 'implicit'].includes(row.invocation)) errors.push(`${label} '${row.id}' has invalid invocation '${row.invocation}'`);

  if ('trials' in row) {
    if (!Number.isInteger(row.trials) || row.trials < 1) errors.push(`${label} '${row.id}' trials must be a positive integer`);
    const threshold = row.pass_threshold ?? row.trials;
    if (!Number.isInteger(threshold) || threshold < 1) errors.push(`${label} '${row.id}' pass_threshold must be a positive integer`);
    if (Number.isInteger(row.trials) && Number.isInteger(threshold) && threshold > row.trials) errors.push(`${label} '${row.id}' pass_threshold cannot exceed trials`);
  } else if ('pass_threshold' in row) {
    errors.push(`${label} '${row.id}' pass_threshold requires trials`);
  }
}

function resultMap(rows = []) {
  return new Map(rows.map((row) => [row.id, row]));
}

async function readReceipt(runDir, filename, errors) {
  const target = path.join(runDir, filename);
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    return JSON.parse(await readFile(target, 'utf8'));
  } catch (error) {
    errors.push(`review receipt missing '${filename}': ${error.message}`);
    return null;
  }
}

function validateReceipt(receipt, slotName, metadata, dataCases, errors) {
  if (!receipt) return;
  if (receipt.skill !== metadata.name) errors.push(`${slotName} review skill '${receipt.skill}' does not match '${metadata.name}'`);
  if (receipt.slot !== slotName) errors.push(`${slotName} review has slot '${receipt.slot}', expected '${slotName}'`);
  if (!receipt.model || /^(?:unknown|placeholder|model[-_ ]?[ab12]?)$/i.test(receipt.model)) {
    errors.push(`${slotName} review lacks a concrete model`);
  }
  if (typeof receipt.revision !== 'string' || !/^[0-9a-f]{40}$/i.test(receipt.revision)) {
    errors.push(`${slotName} review requires the full 40-character Git revision`);
  }
  if (receipt.result !== 'pass') errors.push(`${slotName} review is '${receipt.result}', expected pass`);
  if (!Array.isArray(receipt.findings)) errors.push(`${slotName} review findings must be an array`);

  const rows = Array.isArray(receipt.cases) ? receipt.cases : [];
  if (!Array.isArray(receipt.cases)) errors.push(`${slotName} review cases must be an array`);
  const ids = rows.map((row) => row?.id).filter(Boolean);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of [...new Set(duplicateIds)]) errors.push(`${slotName} review has duplicate case '${id}'`);

  const expectedIds = dataCases.map((row) => row.id);
  const expected = new Set(expectedIds);
  const reviewed = resultMap(rows);
  for (const id of expectedIds) {
    const row = reviewed.get(id);
    if (!row) {
      errors.push(`${slotName} review missing case '${id}'`);
      continue;
    }
    if (row.result !== 'pass') errors.push(`${slotName} review case '${id}' is '${row.result}', expected pass`);
    if (typeof row.note !== 'string' || !row.note.trim()) errors.push(`${slotName} review case '${id}' requires a concise evidence note`);
  }
  for (const id of ids) if (!expected.has(id)) errors.push(`${slotName} review contains undeclared case '${id}'`);
}

export async function validateSkill(options) {
  const errors = [];
  const warnings = [];
  const skillRoot = path.resolve(options.skillRoot || '');
  const skillMdPath = path.join(skillRoot, 'SKILL.md');
  if (!(await nonEmpty(skillMdPath))) {
    return { ok: false, mode: options.runEvidence ? 'complete' : 'structural', skill_root: skillRoot, errors: [`SKILL.md missing or empty: ${skillMdPath}`], warnings };
  }

  const skillText = await readFile(skillMdPath, 'utf8');
  const metadata = parseFrontmatter(skillText);
  if (!metadata.name) errors.push('SKILL.md frontmatter missing name');
  if (!metadata.description) errors.push('SKILL.md frontmatter missing description');
  if (metadata.name && metadata.name !== path.basename(skillRoot)) errors.push(`Skill name '${metadata.name}' does not match folder '${path.basename(skillRoot)}'`);

  const referenceMatch = skillText.match(/<!--\s*eval:references\s*-->([\s\S]*?)<!--\s*\/eval:references\s*-->/);
  const declaredRefs = [];
  if (!referenceMatch) errors.push('SKILL.md missing eval:references block');
  else {
    for (const line of referenceMatch[1].split(/\r?\n/)) {
      const match = line.trim().match(/^-\s+((?:references\/[^\s]+)|(?:tests\/evals\/[^\s]+))/);
      if (match) declaredRefs.push(match[1]);
    }
    if (!declaredRefs.length) errors.push('eval:references block is empty');
  }
  for (const reference of declaredRefs) {
    const parts = normalizeSlash(reference).split('/');
    const validDepth = (parts[0] === 'references' && parts.length === 2)
      || (parts[0] === 'tests' && parts[1] === 'evals' && parts.length === 3);
    if (!validDepth) errors.push(`Declared path has invalid depth: ${reference}`);
    const target = path.join(skillRoot, reference);
    const mayBeEmpty = normalizeSlash(reference) === 'tests/evals/regression-cases.jsonl';
    if (mayBeEmpty ? !(await fileExists(target)) : !(await nonEmpty(target))) {
      errors.push(`Declared path missing or empty: ${reference}`);
    }
  }

  const casesPath = path.join(skillRoot, 'tests', 'evals', 'cases.jsonl');
  const regressionPath = path.join(skillRoot, 'tests', 'evals', 'regression-cases.jsonl');
  const lockPath = path.join(skillRoot, 'tests', 'evals', 'regression-lock.json');
  const caseText = (await nonEmpty(casesPath)) ? await readFile(casesPath, 'utf8') : '';
  if (!caseText) errors.push('tests/evals/cases.jsonl missing or empty');
  const cases = parseJsonLines(caseText, 'cases.jsonl', errors);
  const configRows = cases.filter((row) => row.id === 'model_config');
  if (configRows.length !== 1) errors.push('cases.jsonl must contain exactly one model_config row');
  else {
    const config = configRows[0];
    if (config.category !== 'config' || !config.strong_model_hint || !config.weaker_model_hint) errors.push('model_config is incomplete');
  }
  const dataCases = cases.filter((row) => row.id !== 'model_config');
  const byId = resultMap(dataCases);
  for (const required of REQUIRED_CASES) if (!byId.has(required)) errors.push(`cases.jsonl missing required ID '${required}'`);
  if (!dataCases.some((row) => /^E\d+$/.test(row.id))) errors.push('cases.jsonl requires at least one E* case');
  for (const row of dataCases) {
    validateCase(row, 'cases.jsonl', errors);
    if (/^A\d+$/.test(row.id) && !REQUIRED_EDGE.includes(row.id)) errors.push(`Reserved adversarial ID not allowed: ${row.id}`);
    if (/^ADV/.test(row.id)) errors.push(`Reserved ADV prefix not allowed: ${row.id}`);
  }
  const dCases = dataCases.filter((row) => /^D[1-3]$/.test(row.id));
  if (!dCases.some((row) => row.invocation === 'explicit')) errors.push('D-series lacks explicit invocation');
  if (!dCases.some((row) => row.invocation === 'implicit')) errors.push('D-series lacks implicit invocation');

  const hasRegressionFile = await fileExists(regressionPath);
  if (!hasRegressionFile) errors.push('regression-cases.jsonl missing');
  const regressionText = hasRegressionFile ? await readFile(regressionPath, 'utf8') : '';
  const regressions = regressionText.trim() ? parseJsonLines(regressionText, 'regression-cases.jsonl', errors) : [];
  for (const row of regressions) validateCase(row, 'regression-cases.jsonl', errors, true);
  let lock = [];
  try {
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!Array.isArray(lock)) throw new Error('root must be an array');
  } catch (error) {
    errors.push(`regression-lock.json invalid: ${error.message}`);
  }
  const rawRegressionLines = regressionText.split(/\r?\n/).filter((line) => line.trim());
  if (lock.length !== rawRegressionLines.length) errors.push('regression lock count differs from retained cases');
  for (const line of rawRegressionLines) {
    try {
      const row = JSON.parse(line);
      const entry = lock.find((candidate) => candidate.id === row.id);
      if (!entry) errors.push(`regression lock missing '${row.id}'`);
      else if (entry.sha256 !== sha256(line)) errors.push(`retained regression '${row.id}' was mutated`);
    } catch (error) {
      errors.push(`regression-cases.jsonl invalid: ${error.message}`);
    }
  }

  if (options.runEvidence) {
    const runDir = path.resolve(options.runEvidence);
    if (!isInside(tmpdir(), runDir)) errors.push(`Run evidence must be inside OS temp: ${runDir}`);
    try {
      if (!(await stat(runDir)).isDirectory()) errors.push(`Run evidence must be a directory containing strong.json and weaker.json: ${runDir}`);
    } catch (error) {
      errors.push(`Run evidence directory missing: ${error.message}`);
    }

    const strong = await readReceipt(runDir, 'strong.json', errors);
    const weaker = await readReceipt(runDir, 'weaker.json', errors);
    validateReceipt(strong, 'strong', metadata, dataCases, errors);
    validateReceipt(weaker, 'weaker', metadata, dataCases, errors);

    if (strong?.model && weaker?.model && strong.model.toLowerCase() === weaker.model.toLowerCase()) {
      errors.push('strong and weaker reviews must use distinct concrete models');
    }
    if (strong?.revision && weaker?.revision && strong.revision !== weaker.revision) {
      errors.push('strong and weaker reviews must cover the same committed revision');
    }
  }

  return {
    ok: errors.length === 0,
    mode: options.runEvidence ? 'complete' : 'structural',
    skill_root: skillRoot,
    declared_references: declaredRefs.length,
    case_count: dataCases.length,
    regression_count: regressions.length,
    errors,
    warnings,
  };
}
