#!/usr/bin/env node
// Process-generated evidence that the existing iteration validator was run.
// Not a cryptographic attestation or proof that the browser behavior is correct.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverProjectLedger } from "./findings-ledger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const validator = resolve(here, "verify-iteration-receipt.mjs");
const ledgerValidator = resolve(here, "findings-ledger.mjs");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const populated = (v) => typeof v === "string" && v.trim().length > 0;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function argsOf(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  const options = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--receipt", "--baseline", "--ledger", "--proof", "--check-proof"].includes(argv[i]) ||
        !populated(argv[i + 1]) || argv[i + 1].startsWith("--") ||
        options.has(argv[i])) {
      throw new Error("Usage: node run-iteration-gate.mjs --receipt <json> [--baseline <json>] [--ledger <project-ledger.json>] --proof <out.json> OR --receipt <json> [--baseline <json>] [--ledger <project-ledger.json>] --check-proof <proof.json>");
    }
    options.set(argv[i], resolve(argv[i + 1]));
  }
  if (!options.has("--receipt") || options.has("--proof") === options.has("--check-proof")) {
    throw new Error("Specify --receipt and exactly one of --proof or --check-proof");
  }
  return {
    receipt: options.get("--receipt"),
    baseline: options.get("--baseline") ?? null,
    ledger: options.get("--ledger") ?? null,
    proof: options.get("--proof") ?? null,
    checkProof: options.get("--check-proof") ?? null,
  };
}

function inputHash(path) {
  return path === null ? null : { path, sha256: hash(path) };
}

export function runGate({ receipt, baseline = null, ledger = null, proof, workspaceCwd = process.cwd() }) {
  if (!populated(proof)) throw new Error("--proof output path is required");
  const discovered = discoverProjectLedger(workspaceCwd);
  if (discovered && ledger === null) throw new Error("Project findings ledger exists; pass --ledger for durable coverage");
  if (ledger !== null && baseline === null) throw new Error("Durable findings ledger requires --baseline");
  const outputPath = resolve(proof);
  const protectedPaths = [receipt, baseline, ledger, validator, ledgerValidator].filter(Boolean).map((item) => resolve(item));
  if (protectedPaths.includes(outputPath)) throw new Error("Proof output must not overwrite the receipt, baseline, or validator");
  if (existsSync(outputPath)) throw new Error("Proof file already exists; use a fresh path per execution");
  const receiptInput = inputHash(resolve(receipt));
  const baselineInput = inputHash(baseline === null ? null : resolve(baseline));
  const scriptInput = inputHash(validator);
  const ledgerInput = inputHash(ledger === null ? null : resolve(ledger));
  const ledgerScriptInput = inputHash(ledgerInput ? ledgerValidator : null);
  const command = [process.execPath, validator, "--receipt", receiptInput.path,
    ...(baselineInput ? ["--baseline", baselineInput.path] : []),
    ...(ledgerInput ? ["--ledger", ledgerInput.path] : [])];
  const child = spawnSync(command[0], command.slice(1), {
    encoding: "utf8", shell: false, maxBuffer: 4 * 1024 * 1024,
  });
  let result = null;
  try { result = JSON.parse(child.stdout); } catch { /* CLI failure may not return JSON */ }
  const exitCode = Number.isInteger(child.status) ? child.status : 2;
  const proofData = {
    schemaVersion: ledgerInput ? 2 : 1,
    generator: "design-with-ai/run-iteration-gate.mjs",
    executedAt: new Date().toISOString(),
    command,
    receipt: receiptInput,
    baseline: baselineInput,
    ledger: ledgerInput,
    validator: scriptInput,
    ledgerValidator: ledgerScriptInput,
    processExitCode: exitCode,
    result: object(result) ? {
      valid: result.valid === true,
      verdict: result.verdict ?? null,
      baselineChecked: result.baselineChecked === true,
      ledgerChecked: result.ledgerChecked === true,
      problems: Array.isArray(result.problems) ? result.problems : [],
    } : null,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(proofData, null, 2) + "\n", { flag: "wx" });
  return { proofPath: outputPath, exitCode, proof: proofData };
}

export function checkProof({ receipt, baseline = null, ledger = null, checkProof: proofPath, workspaceCwd = process.cwd() }) {
  const issues = [];
  const fail = (x) => issues.push(x);
  const discovered = discoverProjectLedger(workspaceCwd);
  if (discovered && ledger === null) fail("Project findings ledger present but not selected for proof verification");
  let evidence;
  try { evidence = JSON.parse(readFileSync(resolve(proofPath), "utf8")); }
  catch { return { valid: false, completionEligible: false, issues: ["Proof is missing or invalid JSON"] }; }
  if (!object(evidence) || ![1, 2].includes(evidence.schemaVersion) ||
      evidence.generator !== "design-with-ai/run-iteration-gate.mjs") {
    fail("Unsupported proof format");
  }
  const expectedInputs = [
    ["receipt", resolve(receipt)],
    ["baseline", baseline === null ? null : resolve(baseline)],
    ["ledger", ledger === null ? null : resolve(ledger)],
    ["validator", validator],
    ["ledgerValidator", ledger === null ? null : ledgerValidator],
  ];
  for (const [key, path] of expectedInputs) {
    const stored = evidence?.[key];
    if (path === null) {
      if (stored !== null && stored !== undefined) fail("Proof " + key + " does not match the selected run");
      continue;
    }
    if (!object(stored) || stored.path !== path) {
      fail(key + " path differs from proof");
      continue;
    }
    let actualHash;
    try { actualHash = hash(path); }
    catch { fail(key + " input is not readable"); continue; }
    if (stored.sha256 !== actualHash) fail(key + " changed after the recorded execution");
  }
  const cmd = evidence?.command;
  const expected = [process.execPath, validator, "--receipt", resolve(receipt),
    ...(baseline ? ["--baseline", resolve(baseline)] : []),
    ...(ledger ? ["--ledger", resolve(ledger)] : [])];
  if (!Array.isArray(cmd) || cmd.length !== expected.length ||
      cmd.some((v, i) => v !== expected[i])) fail("Validator command differs from recorded inputs");
  if (!Number.isInteger(evidence?.processExitCode) ||
      ![0, 1, 2].includes(evidence.processExitCode)) fail("Missing or invalid process exit code");
  if (!object(evidence?.result)) fail("No validator JSON result recorded");
  if (evidence?.processExitCode === 0 && evidence?.result?.valid !== true) {
    fail("Recorded successful process exit contradicts validator result");
  }
  if (evidence?.processExitCode !== 0 && evidence?.result?.valid === true) {
    fail("Recorded nonzero process exit contradicts passing result");
  }
  if (baseline !== null && evidence?.result?.baselineChecked !== true) {
    fail("Baseline verification was not confirmed");
  }
  if (ledger !== null && (evidence?.schemaVersion !== 2 || evidence?.result?.ledgerChecked !== true)) {
    fail("Durable ledger verification was not confirmed");
  }
  const completionEligible = issues.length === 0 &&
    evidence.processExitCode === 0 &&
    evidence.result?.valid === true &&
    evidence.result?.verdict === "COMPLETE";
  return {
    valid: issues.length === 0,
    completionEligible,
    processExitCode: evidence?.processExitCode ?? null,
    verdict: evidence?.result?.verdict ?? null,
    issues,
    limitation: "This verifies process-output consistency and input freshness, not proof integrity against a malicious author, actual agent adoption, or runtime UI correctness.",
  };
}

function main() {
  try {
    const options = argsOf(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node run-iteration-gate.mjs --receipt <json> [--baseline <json>] [--ledger <json>] --proof <out.json>\n   or: node run-iteration-gate.mjs --receipt <json> [--baseline <json>] [--ledger <json>] --check-proof <proof.json>\n");
      return;
    }
    if (options.checkProof !== null) {
      const report = checkProof(options);
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      if (!report.valid || !report.completionEligible) process.exitCode = 1;
      return;
    }
    const result = runGate(options);
    process.stdout.write(JSON.stringify({
      proofPath: result.proofPath,
      processExitCode: result.exitCode,
      verdict: result.proof.result?.verdict ?? null,
      valid: result.proof.result?.valid === true,
    }, null, 2) + "\n");
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write("Cannot run design iteration gate: " + error.message + "\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
