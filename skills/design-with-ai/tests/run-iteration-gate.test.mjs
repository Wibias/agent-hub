import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runGate, checkProof } from "../scripts/run-iteration-gate.mjs";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/run-iteration-gate.mjs");
const copy = (x) => JSON.parse(JSON.stringify(x));

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "design-gate-proof-"));
  try {
    const receipt = join(root, "receipt.json");
    const baseline = join(root, "prior.json");
    const proof = join(root, "proof.json");
    const data = {
      schemaVersion: 1,
      requiresPriorBaseline: true,
      iterationVerdict: "COMPLETE",
      gates: { render: "PASS", functional: "PASS" },
      changeSummary: { kind: "NO_CHANGE", addressedFindingIds: [], rationale: "Previously reviewed UI intentionally kept" },
      scope: [{
        route: "/settings", task: "Inspect existing settings",
        coverage: "INSPECTED",
        semantics: { applicable: false, reason: "No guarded publishing actions in this view" },
      }],
      findings: [{
        id: "UX-01", route: "/settings", symptom: "Existing grouped settings",
        acceptance: "Grouping remains legible", decision: "KEEP",
        disposition: "KEEP_JUSTIFIED", justification: "Verified as currently useful",
        after: { ref: "artifacts/settings-current.png" },
      }],
      openCarryover: [],
    };
    const prior = { schemaVersion: 1, intent: "IMPROVE", scope: ["/settings"], findings: [] };
    const save = () => { writeFileSync(receipt, JSON.stringify(data)); writeFileSync(baseline, JSON.stringify(prior)); };
    save();
    return fn({ root, receipt, baseline, proof, data, prior, save });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("runs real validator with frozen baseline and generates input-bound process evidence", () => fixture((f) => {
  const result = runGate(f);
  assert.equal(result.exitCode, 0);
  assert.equal(result.proof.processExitCode, 0);
  assert.equal(result.proof.result.verdict, "COMPLETE");
  assert.equal(result.proof.result.baselineChecked, true);
  assert.match(result.proof.receipt.sha256, /^[0-9a-f]{64}$/);
  assert.match(result.proof.validator.sha256, /^[0-9a-f]{64}$/);
  const checked = checkProof({ receipt: f.receipt, baseline: f.baseline, checkProof: f.proof });
  assert.equal(checked.valid, true, checked.issues.join("\n"));
  assert.equal(checked.completionEligible, true);
}));

test("a failed validator still writes accurate nonzero evidence, never a passing completion", () => fixture((f) => {
  f.data.findings[0].disposition = "PERSISTS";
  f.data.findings[0].reason = "Still needs review";
  f.data.openCarryover = ["UX-01"];
  f.save();
  const ran = runGate(f);
  assert.equal(ran.exitCode, 1);
  assert.equal(ran.proof.result.valid, false);
  const checked = checkProof({ receipt: f.receipt, baseline: f.baseline, checkProof: f.proof });
  assert.equal(checked.completionEligible, false);
}));

test("a valid PARTIAL receipt is not promoted into a complete UI iteration", () => fixture((f) => {
  f.data.iterationVerdict = "PARTIAL";
  f.data.verdictReason = "Publish handler not inspected";
  f.save();
  assert.equal(runGate(f).exitCode, 0);
  const checked = checkProof({ receipt: f.receipt, baseline: f.baseline, checkProof: f.proof });
  assert.equal(checked.valid, true);
  assert.equal(checked.completionEligible, false);
}));

test("a receipt mutated after validation is rejected as stale", () => fixture((f) => {
  runGate(f);
  const changed = copy(f.data);
  changed.findings[0].acceptance = "Renamed acceptance";
  writeFileSync(f.receipt, JSON.stringify(changed));
  const checked = checkProof({ receipt: f.receipt, baseline: f.baseline, checkProof: f.proof });
  assert.equal(checked.valid, false);
  assert.match(checked.issues.join("\n"), /receipt changed after/);
}));

test("baseline edits after validation invalidate the gate evidence", () => fixture((f) => {
  runGate(f);
  const changed = copy(f.prior);
  changed.intent = "RESTYLE";
  writeFileSync(f.baseline, JSON.stringify(changed));
  const checked = checkProof({ receipt: f.receipt, baseline: f.baseline, checkProof: f.proof });
  assert.equal(checked.valid, false);
  assert.match(checked.issues.join("\n"), /baseline changed after/);
}));

test("missing proof never qualifies as execution evidence", () => fixture((f) => {
  const checked = checkProof({ receipt: f.receipt, baseline: f.baseline, checkProof: f.proof });
  assert.equal(checked.valid, false);
  assert.match(checked.issues.join("\n"), /Proof is missing/);
}));

test("the evidence writer refuses overwriting old proof or input files", () => fixture((f) => {
  runGate(f);
  assert.throws(() => runGate(f), /already exists/);
  assert.throws(() => runGate({ ...f, proof: f.receipt }), /must not overwrite/);
}));

test("tampering with claimed child exit is flagged", () => fixture((f) => {
  runGate(f);
  const evidence = JSON.parse(readFileSync(f.proof, "utf8"));
  evidence.processExitCode = 1;
  writeFileSync(f.proof, JSON.stringify(evidence));
  const checked = checkProof({ receipt: f.receipt, baseline: f.baseline, checkProof: f.proof });
  assert.equal(checked.valid, false);
  assert.match(checked.issues.join("\n"), /contradicts passing result/);
}));

test("CLI run and check emit machine-readable summary with exit codes", () => fixture((f) => {
  const call = (args) => spawnSync(process.execPath, [cli, "--receipt", f.receipt, "--baseline", f.baseline, ...args], { encoding: "utf8" });
  const ran = call(["--proof", f.proof]);
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(JSON.parse(ran.stdout).valid, true);
  const checked = call(["--check-proof", f.proof]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).completionEligible, true);
  const invalid = call(["--check-proof", join(f.root, "missing.json")]);
  assert.equal(invalid.status, 1);
}));

test("CLI exits nonzero for missing baseline required by receipt", () => fixture((f) => {
  const ran = spawnSync(process.execPath, [cli, "--receipt", f.receipt, "--proof", f.proof], { encoding: "utf8" });
  assert.equal(ran.status, 2);
  const proof = JSON.parse(readFileSync(f.proof, "utf8"));
  assert.equal(proof.processExitCode, 2);
  assert.equal(proof.result, null);
}));

test("CLI help is safe and leaves project files unchanged", () => {
  const ran = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(ran.status, 0);
  assert.match(ran.stdout, /--check-proof/);
});
