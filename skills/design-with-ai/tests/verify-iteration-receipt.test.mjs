import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateIterationReceipt } from "../scripts/verify-iteration-receipt.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../scripts/verify-iteration-receipt.mjs");
const deepCopy = (value) => JSON.parse(JSON.stringify(value));

function captured(ref, route, viewport = "desktop-1440", stateKey = "qa-passed-unauthed", dataKey = "jobs-three") {
  return { ref, route, viewport, stateKey, dataKey };
}
function semanticsPass() {
  return {
    applicable: true,
    verdict: "PASS",
    contractSource: "src/domain/job-states.ts#jobSelectors",
    testedStates: ["QA-passed but account disconnected", "account connected and publish eligible"],
    checks: ["phase", "filter", "count", "readiness", "action"].map((kind) => ({
      kind,
      result: "PASS",
      method: kind === "phase" ? "SOURCE" : "TEST",
      evidenceRef: "tests/workflow-semantics.test.ts#" + kind,
    })),
  };
}
function validComplete() {
  return {
    schemaVersion: 1,
    iterationVerdict: "COMPLETE",
    gates: { render: "PASS", functional: "PASS" },
    scope: [
      { route: "/jobs", task: "Filter and inspect work", coverage: "INSPECTED", semantics: semanticsPass() },
      { route: "/settings", task: "Change video output settings", coverage: "INSPECTED",
        semantics: { applicable: false, reason: "No workflow/status or guarded action on this view" } },
    ],
    findings: [
      {
        id: "UX-01", route: "/jobs", symptom: "Filter rail implied progress",
        acceptance: "Filter click selects subset without changing production state",
        decision: "Change the rail semantics and labels", disposition: "RESOLVED",
        before: captured("artifacts/jobs-before.png", "/jobs"),
        after: captured("artifacts/jobs-after.png", "/jobs"),
        verification: { result: "PASS", evidenceRef: "tests/workflow-semantics.test.ts#filter" },
      },
      {
        id: "UX-02", route: "/settings", symptom: "Risk of unnecessary redesign",
        acceptance: "Form remains readable and logically grouped",
        decision: "KEEP", disposition: "KEEP_JUSTIFIED",
        after: captured("artifacts/settings-after.png", "/settings"),
        justification: "Inspected grouping and contrast at normal zoom",
      },
    ],
    openCarryover: [],
  };
}

test("valid COMPLETE with matched before/after, inspected KEEP and runtime semantics", () => {
  const result = validateIterationReceipt(validComplete());
  assert.equal(result.valid, true, result.problems.join("\n"));
  assert.equal(result.verdict, "COMPLETE");
  assert.deepEqual(result.openCarryover, []);
});

test("rejects COMPLETE when a multi-route scope is skipped", () => {
  const payload = validComplete();
  payload.scope[1].coverage = "NOT_INSPECTED";
  payload.scope[1].coverageReason = "No available screenshot";
  const result = validateIterationReceipt(payload);
  assert.equal(result.valid, false);
  assert.match(result.problems.join("\n"), /COMPLETE cannot include uninspected/);
});

test("rejects COMPLETE when prior setup problems are silently omitted", () => {
  const payload = validComplete();
  payload.scope.push({
    route: "/setup", task: "Authorize the account", coverage: "INSPECTED",
    semantics: { applicable: false, reason: "A documentation-only checklist" },
  });
  const result = validateIterationReceipt(payload);
  assert.equal(result.valid, false);
  assert.match(result.problems.join("\n"), /\/setup: COMPLETE requires at least one disposition/);
});

test("rejects COMPLETE when QA is done but publishing readiness has not been verified", () => {
  const payload = validComplete();
  payload.scope[0].semantics = {
    applicable: true, verdict: "NOT_VERIFIED", reason: "Account disconnected; handler not inspected",
  };
  assert.match(validateIterationReceipt(payload).problems.join("\n"), /cannot claim unverified\/failed workflow semantics/);
});

test("rejects screenshot-only workflow interaction proof", () => {
  const payload = validComplete();
  payload.scope[0].semantics.checks.find((x) => x.kind === "action").method = "SCREENSHOT";
  const result = validateIterationReceipt(payload);
  assert.equal(result.valid, false);
  assert.match(result.problems.join("\n"), /requires RUNTIME\/TEST evidence/);
});

test("rejects missing and contradictory semantic evidence", () => {
  const payload = validComplete();
  payload.scope[0].semantics.checks = payload.scope[0].semantics.checks.filter((x) => x.kind !== "readiness");
  payload.scope[0].semantics.testedStates = ["QA passed only"];
  const result = validateIterationReceipt(payload);
  assert.match(result.problems.join("\n"), /exactly one readiness check/);
  assert.match(result.problems.join("\n"), /at least two named representative states/);
});

test("rejects mismatched viewport or data state disguised as before/after improvement", () => {
  const payload = validComplete();
  payload.findings[0].after.viewport = "mobile-390";
  const result = validateIterationReceipt(payload);
  assert.equal(result.valid, false);
  assert.match(result.problems.join("\n"), /requires matched before\/after/);
});

test("rejects open findings hidden behind a COMPLETE verdict", () => {
  const payload = validComplete();
  payload.findings[0].disposition = "IMPROVED_BUT_OPEN";
  payload.findings[0].reason = "The semantics are improved, but the setup action still misleads";
  payload.openCarryover = ["UX-01"];
  const result = validateIterationReceipt(payload);
  assert.equal(result.valid, false);
  assert.match(result.problems.join("\n"), /COMPLETE cannot include open finding/);
});

test("valid PARTIAL carries unresolved findings into the next iteration", () => {
  const payload = validComplete();
  payload.iterationVerdict = "PARTIAL";
  payload.verdictReason = "Setup authorization and action affordance are not implemented";
  payload.findings[0].disposition = "IMPROVED_BUT_OPEN";
  payload.findings[0].reason = "Rail now filters, but publish action misleading";
  payload.scope[0].semantics = {
    applicable: true, verdict: "NOT_VERIFIED",
    reason: "Need live account authorization and publish handler test",
  };
  payload.openCarryover = ["UX-01"];
  const result = validateIterationReceipt(payload);
  assert.equal(result.valid, true, result.problems.join("\n"));
  assert.deepEqual(result.openCarryover, ["UX-01"]);
});

test("rejects silent loss of open issue ID and duplicate IDs", () => {
  const payload = validComplete();
  payload.iterationVerdict = "PARTIAL";
  payload.verdictReason = "Not finished";
  payload.findings[0].disposition = "PERSISTS";
  payload.findings[0].reason = "Still ambiguous";
  const missing = validateIterationReceipt(payload);
  assert.match(missing.problems.join("\n"), /open finding omitted from carryover/);
  payload.openCarryover = ["UX-01"];
  payload.findings.push(deepCopy(payload.findings[0]));
  const duplicate = validateIterationReceipt(payload);
  assert.match(duplicate.problems.join("\n"), /duplicate finding id/);
});

test("rejects final quality claims without functional or rendered verification", () => {
  const payload = validComplete();
  payload.gates.functional = "NOT_VERIFIED";
  const result = validateIterationReceipt(payload);
  assert.match(result.problems.join("\n"), /COMPLETE requires passing functional and rendered checks/);
});

test("CLI returns JSON and nonzero for contradictory COMPLETE", () => {
  const dir = mkdtempSync(join(tmpdir(), "design-iteration-receipt-"));
  try {
    const path = join(dir, "receipt.json");
    writeFileSync(path, JSON.stringify(validComplete()));
    const good = spawnSync(process.execPath, [cli, "--receipt", path], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).valid, true);
    const payload = validComplete();
    payload.findings[0].disposition = "PERSISTS";
    payload.findings[0].reason = "Not resolved";
    writeFileSync(path, JSON.stringify(payload));
    const bad = spawnSync(process.execPath, [cli, "--receipt", path], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).valid, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects missing receipt and unsupported schema", () => {
  assert.equal(validateIterationReceipt({}).valid, false);
  const invalid = spawnSync(process.execPath, [cli, "--receipt", "/missing/receipt.json"], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
});
