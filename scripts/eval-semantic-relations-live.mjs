#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateSemanticRelationShadowCases } from '../memory-engine/semantic-relation-shadow.mjs';
import { SEMANTIC_RELATION_POLICY_VERSION } from '../memory-engine/semantic-relation-judge.mjs';
import { createIsolatedCodexJsonJudge } from './codex-isolated-memory-judge.mjs';

export function prepareSyntheticRelationCases(fixture) {
  if (fixture?.format !== 'agent-hub-semantic-relation-live-fixture'
    || fixture.version !== 1 || fixture.humanValidated !== false
    || !Array.isArray(fixture.cases) || fixture.cases.length < 1 || fixture.cases.length > 16) {
    throw new TypeError('Expected a bounded, explicitly unvalidated synthetic fixture');
  }
  const fingerprints = new Set();
  return fixture.cases.map(item => {
    const { id, source, targets, expectedRelations } = item;
    if (typeof id !== 'string' || !id.trim() || typeof source !== 'string' || !source.trim()
      || !Array.isArray(targets) || targets.length < 1 || targets.length > 12
      || targets.some(target => typeof target?.id !== 'string' || !target.id.trim()
        || typeof target.value !== 'string' || !target.value.trim())) {
      throw new TypeError('Invalid synthetic case');
    }
    const fingerprint = JSON.stringify([source, targets.map(target => target.value).sort()]);
    if (fingerprints.has(fingerprint)) throw new Error('Duplicate synthetic relation context');
    fingerprints.add(fingerprint);
    const projectId = 'synthetic:' + id;
    const branch = 'main';
    const sourceClaimId = 'source';
    const records = [{ id: sourceClaimId, value: source }, ...targets];
    const canonical = {
      claims: records.map(record => ({
        id: record.id, project_id: projectId, branch_scope: branch,
        state: 'active', kind: 'user_direct', value_text: record.value,
        created_from_evidence_id: 'e-' + record.id,
      })),
      evidence: records.map(record => ({
        id: 'e-' + record.id, project_id: projectId, branch, authority_class: 'user_direct',
      })),
    };
    return {
      id, projectId, branch, sourceClaimId,
      targetClaimIds: targets.map(target => target.id),
      expectedRelations, memory: { exportCanonical: () => structuredClone(canonical) },
      at: '2026-11-27T00:00:00.000Z',
    };
  });
}

// The shadow evaluator's token contract excludes Codex's cache/reasoning
// breakdowns. Preserve the provider's aggregate input and output counts.
export function shadowUsageFromCodex(usage) {
  if (usage == null) return null;
  const { input_tokens, output_tokens } = usage;
  for (const value of [input_tokens, output_tokens]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid Codex aggregate usage');
  }
  return { input_tokens, output_tokens };
}

// Cache and reasoning counters are provider breakdowns, not additive usage.
export function summarizeCodexBreakdowns(samples) {
  const fields = ['cached_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens'];
  const totals = Object.fromEntries(fields.map(field => [field, null]));
  const reportedFieldCases = Object.fromEntries(fields.map(field => [field, 0]));
  for (const sample of samples) {
    if (sample == null) continue;
    for (const field of fields) {
      const value = sample[field];
      if (value == null) continue;
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid Codex breakdown');
      const sum = (totals[field] ?? 0) + value;
      if (!Number.isSafeInteger(sum)) throw new TypeError('Codex breakdown overflow');
      totals[field] = sum;
      reportedFieldCases[field]++;
    }
  }
  return { totals, reportedFieldCases };
}

async function main(args) {
  if (args[0] !== '--judge' || (args.length !== 1 && !(args.length === 2 && args[1] === '--holdout'))) {
    throw new Error('Usage: node scripts/eval-semantic-relations-live.mjs --judge [--holdout]');
  }
  // Only fixed synthetic fixtures are used. No production store is opened.
  const dataset = args.length === 2 ? 'semantic-relation-holdout-v1' : 'semantic-relation-live-v1';
  const fixture = JSON.parse(await readFile(
    new URL('../tests/fixtures/' + dataset + '.json', import.meta.url), 'utf8',
  ));
  const cases = prepareSyntheticRelationCases(fixture);
  const judge = await createIsolatedCodexJsonJudge({
    workspaceLabel: 'typed-relation-synthetic-live', policyVersion: SEMANTIC_RELATION_POLICY_VERSION,
    reasoningEffort: 'low', timeoutMs: 60000,
  });
  try {
    const samples = [];
    const report = await evaluateSemanticRelationShadowCases({
      cases, judge: async ({ prompt }) => {
        const text = await judge.judge(prompt);
        const usage = judge.lastUsage();
        samples.push(usage);
        return { text, usage: shadowUsageFromCodex(usage) };
      },
    });
    console.log(JSON.stringify({
      dataset, humanValidated: false,
      evaluatorId: judge.evaluatorId, ...report,
      codexUsageBreakdown: summarizeCodexBreakdowns(samples),
    }, null, 2));
    if (!report.complete) process.exitCode = 1;
  } finally {
    await judge.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Synthetic relation evaluation failed or --judge was not specified. No memory writes requested.');
    process.exitCode = 1;
  });
}
