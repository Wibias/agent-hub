#!/usr/bin/env node
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runPreflight } from './preflight.mjs';
import { validateSkill } from './validate.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = { roots: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (['json', 'discovery-only', 'no-defaults'].includes(key)) {
      values[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    index += 1;
    if (key === 'root') values.roots.push(value);
    else values[key] = value;
  }
  return { command, values };
}

function help() {
  return `Skill Ratchet\n\nCommands:\n  preflight --query <text> [--root <path>] [--project-root <path>] [--threshold <0..1>] [--evidence <temp-path>] [--discovery-only] [--no-defaults] [--json]\n  validate --skill-root <path> [--run-evidence <temp-directory>] [--json]\n`;
}

function printPreflight(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Skill Ratchet preflight\nStatus: ${result.status}\nTop score: ${result.top_score}\n${result.rationale}\n`);
  for (const entry of result.ranked) process.stdout.write(`${entry.plausible ? '*' : '-'} ${entry.score.toFixed(4)} ${entry.path}\n`);
}

function buildStrongAgentPrompt(skillRoot, runDir) {
  const strongReceipt = path.join(runDir, 'strong.json');
  const weakerReceipt = path.join(runDir, 'weaker.json');
  return `Copy this prompt into the strong agent:\n\n---\nReview the Agent Skill at:\n\n${skillRoot}\n\nUse the Skill Ratchet contract in:\n\n- skills/skill-ratchet/SKILL.md\n- skills/skill-ratchet/references/evaluation-contract.md\n- ${path.join(skillRoot, 'tests', 'evals', 'cases.jsonl')}\n\nThis is the STRONG model review.\n\nDo one bounded review of the current committed revision. The canonical cases are acceptance criteria, not a benchmark harness.\n\nRequirements:\n\n- Record the full output of \`git rev-parse HEAD\`.\n- Read the target SKILL.md, its declared evaluation references, and the canonical cases. Open only additional repository files needed to support the review.\n- Review every declared non-config case once and decide \`pass\`, \`fail\`, or \`blocked\` from the skill contract, existing tests, deterministic command output, and inspectable repository state.\n- Do not execute the canonical cases one by one.\n- Do not run repeated trials.\n- Do not create fixtures, temporary skills, fake competing skills, or synthetic failure environments.\n- Do not launch or delegate to another model.\n- Do not modify the target skill, cases, regression files, or repository state to make the review pass.\n- You may run a small number of existing deterministic checks when they materially support the review, but do not turn this into a case-by-case execution suite.\n- A case passes only when the current repository evidence supports its intended behavior. If evidence is insufficient, mark it \`blocked\`; if behavior is contradicted, mark it \`fail\`.\n- Keep notes concise and evidence-based. Never use hidden chain-of-thought as evidence.\n- Do not commit, push, merge, or mark a PR ready.\n\nWrite exactly one JSON receipt to:\n\n${strongReceipt}\n\nCreate the parent directory if it does not already exist.\n\nReceipt shape:\n\n{\n  \"skill\": \"<target skill name from frontmatter>\",\n  \"slot\": \"<strong or weaker, matching the review label above>\",\n  \"model\": \"<concrete model identifier for this agent>\",\n  \"revision\": \"<full 40-character git revision>\",\n  \"result\": \"pass|fail|blocked\",\n  \"cases\": [\n    {\"id\": \"D1\", \"result\": \"pass|fail|blocked\", \"note\": \"<concise observable justification>\"}\n  ],\n  \"findings\": []\n}\n\nInclude every declared non-config case exactly once and no undeclared cases. Set the overall result to \`pass\` only if every case passes. Use the concrete model name exposed by your host; never write a placeholder.\n\nAt the end, report only: model, revision, overall result, any failing/blocked case IDs, findings count, and receipt path.\n---\n\nFor the weaker agent, use the exact same prompt and change only:\n\n1. This is the STRONG model review.\n   to This is the WEAKER model review.\n\n2. ${strongReceipt}\n   to ${weakerReceipt}\n\nEverything else stays the same.\n\nAfter both reviews finish, run:\n\nnode .\\scripts\\skill-ratchet.mjs validate --skill-root \"${skillRoot}\" --run-evidence \"${runDir}\"\n`;
}

function printValidation(result, json, options = {}) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Skill Ratchet ${result.mode} validation: ${result.ok ? 'PASS' : 'FAIL'}\n`);
  for (const error of result.errors) process.stdout.write(`ERROR: ${error}\n`);
  for (const warning of result.warnings) process.stdout.write(`WARN: ${warning}\n`);

  if (result.ok && result.mode === 'structural' && !options.runEvidence) {
    const skillRoot = path.resolve(result.skill_root);
    const runDir = path.join(tmpdir(), `skill-ratchet-${path.basename(skillRoot)}`);
    process.stdout.write(`\n${buildStrongAgentPrompt(skillRoot, runDir)}`);
  }
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || values.help) {
    process.stdout.write(help());
    return;
  }
  if (command === 'preflight') {
    const result = await runPreflight({
      query: values.query,
      roots: values.roots,
      projectRoot: values['project-root'],
      threshold: values.threshold === undefined ? undefined : Number(values.threshold),
      evidence: values.evidence,
      discoveryOnly: Boolean(values['discovery-only']),
      includeDefaults: !values['no-defaults'],
    });
    printPreflight(result, values.json);
    return;
  }
  if (command === 'validate') {
    if (!values['skill-root']) throw new Error('validate requires --skill-root');
    const result = await validateSkill({ skillRoot: values['skill-root'], runEvidence: values['run-evidence'] });
    printValidation(result, values.json, { runEvidence: values['run-evidence'] });
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown command '${command}'\n\n${help()}`);
}

main().catch((error) => {
  process.stderr.write(`Skill Ratchet error: ${error.message}\n`);
  process.exitCode = 1;
});
