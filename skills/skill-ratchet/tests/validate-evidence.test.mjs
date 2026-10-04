import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateSkill } from '../scripts/validate.mjs';

function caseRow(id, category, prompt) {
  return {
    id,
    category,
    invocation: id === 'D1' || /^A[1-5]$/.test(id) ? 'explicit' : 'implicit',
    prompt,
    expected_skill: /^N/.test(id) ? null : 'demo',
    expected_resources: /^N/.test(id) ? [] : ['SKILL.md'],
    unnecessary_resources: /^N/.test(id) ? ['demo'] : [],
    assertion_ids: [`${id.toLowerCase()}-ok`],
    scenario: `${id} scenario`,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-ratchet-validator-'));
  const skillRoot = path.join(root, 'demo');
  const evalDir = path.join(skillRoot, 'tests', 'evals');
  await mkdir(evalDir, { recursive: true });
  await writeFile(
    path.join(skillRoot, 'SKILL.md'),
    `---\nname: demo\ndescription: Validator fixture.\n---\n\n<!-- eval:references -->\n- tests/evals/cases.jsonl -- cases\n- tests/evals/regression-cases.jsonl -- regressions\n- tests/evals/regression-lock.json -- lock\n<!-- /eval:references -->\n`,
    'utf8',
  );

  const rows = [
    {
      id: 'model_config',
      category: 'config',
      invocation: 'n/a',
      prompt: 'Configuration row; do not execute as a case',
      expected_skill: null,
      expected_resources: [],
      unnecessary_resources: [],
      assertion_ids: ['model-matrix-configured'],
      scenario: 'config',
      strong_model_hint: 'strong',
      weaker_model_hint: 'weaker',
    },
    caseRow('D1', 'must-trigger', 'Use demo.'),
    caseRow('D2', 'must-trigger', 'Implicit demo two.'),
    caseRow('D3', 'must-trigger', 'Implicit demo three.'),
    caseRow('N1', 'must-not-trigger', 'Sibling one.'),
    caseRow('N2', 'must-not-trigger', 'Sibling two.'),
    caseRow('N3', 'must-not-trigger', 'Sibling three.'),
    caseRow('E1', 'routing', 'First organic task.'),
    caseRow('E2', 'routing', 'Second organic task.'),
    caseRow('A1', 'adversarial', 'Missing target.'),
    caseRow('A2', 'adversarial', 'Missing reference.'),
    caseRow('A3', 'adversarial', 'Failing script.'),
    caseRow('A4', 'adversarial', 'Denied write.'),
    caseRow('A5', 'adversarial', 'Competing skill.'),
    caseRow('A6', 'adversarial', 'Instruction injection.'),
  ];
  await writeFile(path.join(evalDir, 'cases.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

  const regression = { ...rows.find((row) => row.id === 'E1'), id: 'E1-regression', category: 'regression', added: '2026-09-12' };
  const regressionLine = JSON.stringify(regression);
  const hash = createHash('sha256').update(regressionLine, 'utf8').digest('hex');
  await writeFile(path.join(evalDir, 'regression-cases.jsonl'), `${regressionLine}\n`, 'utf8');
  await writeFile(path.join(evalDir, 'regression-lock.json'), `${JSON.stringify([{ id: regression.id, sha256: hash }], null, 2)}\n`, 'utf8');

  return { root, skillRoot, caseIds: rows.filter((row) => row.id !== 'model_config').map((row) => row.id) };
}

function receipt(slot, model, revision, skillDigest, caseIds) {
  return {
    skill: 'demo',
    slot,
    model,
    revision,
    skill_digest: skillDigest,
    result: 'pass',
    cases: caseIds.map((id) => ({
      id,
      result: 'pass',
      note: `${id} is supported by the reviewed skill contract and deterministic repository evidence.`,
    })),
    findings: [],
  };
}

async function evidenceDir(root, caseIds, options = {}) {
  const dir = path.join(root, options.name || 'reviews');
  await mkdir(dir, { recursive: true });
  const revision = '0123456789abcdef0123456789abcdef01234567';
  const structural = await validateSkill({ skillRoot: path.join(root, 'demo') });
  if (!structural.ok || !structural.skill_digest) {
    throw new Error(`fixture structural validation failed: ${structural.errors.join('\n')}`);
  }
  const skillDigest = structural.skill_digest;
  await writeFile(
    path.join(dir, 'strong.json'),
    `${JSON.stringify(receipt('strong', 'gpt-5.6-sol', revision, skillDigest, caseIds), null, 2)}\n`,
    'utf8',
  );

  if (!options.omitWeaker) {
    const weakerIds = options.omitCase ? caseIds.filter((id) => id !== options.omitCase) : caseIds;
    await writeFile(
      path.join(dir, 'weaker.json'),
      `${JSON.stringify(receipt(
        'weaker',
        'gpt-5.6-luna',
        options.weakerRevision || revision,
        skillDigest,
        weakerIds,
      ), null, 2)}\n`,
      'utf8',
    );
  }
  return dir;
}

test('structural validation allows zero retained regressions for a new skill', async () => {
  const { skillRoot } = await fixture();
  const evalDir = path.join(skillRoot, 'tests', 'evals');
  await writeFile(path.join(evalDir, 'regression-cases.jsonl'), '', 'utf8');
  await writeFile(path.join(evalDir, 'regression-lock.json'), '[]\n', 'utf8');

  const result = await validateSkill({ skillRoot });

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.regression_count, 0);
});

test('complete validation requires both independent review receipts', async () => {
  const { root, skillRoot, caseIds } = await fixture();
  const runEvidence = await evidenceDir(root, caseIds, { omitWeaker: true, name: 'missing-weaker' });
  const result = await validateSkill({ skillRoot, runEvidence });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("review receipt missing 'weaker.json'")));
});

test('complete validation requires every canonical case in each review receipt', async () => {
  const { root, skillRoot, caseIds } = await fixture();
  const runEvidence = await evidenceDir(root, caseIds, { omitCase: 'E2', name: 'missing-e2' });
  const result = await validateSkill({ skillRoot, runEvidence });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("weaker review missing case 'E2'")));
});

test('complete validation rejects review receipts from different revisions', async () => {
  const { root, skillRoot, caseIds } = await fixture();
  const runEvidence = await evidenceDir(root, caseIds, {
    weakerRevision: 'fedcba9876543210fedcba9876543210fedcba98',
    name: 'revision-mismatch',
  });
  const result = await validateSkill({ skillRoot, runEvidence });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('same committed revision')));
});

test('complete validation keeps receipts valid after unrelated repository content changes', async () => {
  const { root, skillRoot, caseIds } = await fixture();
  const runEvidence = await evidenceDir(root, caseIds, { name: 'unrelated-change' });
  await writeFile(path.join(root, 'unrelated-generated-index.json'), '{"changed":true}\n', 'utf8');

  const result = await validateSkill({ skillRoot, runEvidence });

  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('complete validation rejects receipts after target skill content changes', async () => {
  const { root, skillRoot, caseIds } = await fixture();
  const runEvidence = await evidenceDir(root, caseIds, { name: 'skill-change' });
  await writeFile(path.join(skillRoot, 'new-contract-note.md'), 'material skill change\n', 'utf8');

  const result = await validateSkill({ skillRoot, runEvidence });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('skill_digest does not match the current target skill')));
});

test('complete validation accepts two compact passing review receipts', async () => {
  const { root, skillRoot, caseIds } = await fixture();
  const runEvidence = await evidenceDir(root, caseIds, { name: 'complete' });
  const result = await validateSkill({ skillRoot, runEvidence });

  assert.equal(result.ok, true, result.errors.join('\n'));
});
