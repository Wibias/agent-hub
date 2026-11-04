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

function trackedBaseline() {
  return {
    schemaVersion: 1,
    intent: "IMPROVE",
    scope: ["/jobs", "/settings"],
    findings: [{
      id: "UX-01",
      route: "/jobs",
      kind: "NAVIGATION",
      priority: "HIGH",
      symptom: "Two generic Settings links share /settings in the same desktop view",
      acceptance: "One generic Settings entry point remains at desktop width",
      evidenceRef: "reviews/jobs-before.png",
    }],
  };
}
function trackedReceipt() {
  const receipt = validComplete();
  receipt.requiresPriorBaseline = true;
  receipt.findings[0].symptom = "Two generic Settings links share /settings in the same desktop view";
  receipt.findings[0].acceptance = "One generic Settings entry point remains at desktop width";
  receipt.findings[0].verification.method = "TEST";
  receipt.changeSummary = {
    kind: "TASK_REPAIR",
    addressedFindingIds: ["UX-01"],
    rationale: "Remove redundant toolbar Settings while retaining global nav",
    evidenceRef: "tests/navigation.test.ts#single-global-settings",
  };
  return receipt;
}

test("independent prior findings baseline validates genuine task repair", () => {
  const result = validateIterationReceipt(trackedReceipt(), trackedBaseline());
  assert.equal(result.valid, true, result.problems.join("\n"));
  assert.equal(result.baselineChecked, true);
});

test("an iterative COMPLETE cannot skip the independently recorded prior baseline", () => {
  const result = validateIterationReceipt(trackedReceipt());
  assert.equal(result.valid, false);
  assert.match(result.problems.join("\n"), /requires an independent pre-edit baseline/);
});

test("omitted known navigation finding fails even when a different finding closes the route", () => {
  const receipt = trackedReceipt();
  receipt.findings[0].id = "UX-NEW";
  receipt.changeSummary.addressedFindingIds = [];
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.equal(result.valid, false);
  assert.match(result.problems.join("\n"), /prior finding missing from final receipt: UX-01/);
});

test("omitting the previously reviewed route fails baseline coverage", () => {
  const receipt = trackedReceipt();
  receipt.scope = receipt.scope.filter((x) => x.route !== "/settings");
  receipt.findings = receipt.findings.filter((x) => x.route !== "/settings");
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.match(result.problems.join("\n"), /baseline scope omitted from final receipt: \/settings/);
});

test("prior acceptance cannot be weakened or silently renamed", () => {
  const receipt = trackedReceipt();
  receipt.findings[0].acceptance = "Settings button has an orange accent";
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.match(result.problems.join("\n"), /prior route\/acceptance changed/);
});

test("a prior defect cannot be disguised as an unchanged KEEP without reassessment", () => {
  const receipt = trackedReceipt();
  receipt.findings[0].disposition = "KEEP_JUSTIFIED";
  receipt.findings[0].justification = "Looks fine";
  receipt.changeSummary = { kind: "NO_CHANGE", addressedFindingIds: [], rationale: "No changes" };
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.match(result.problems.join("\n"), /cannot become KEEP_JUSTIFIED without reassessment evidence/);
});

test("prior defect can be kept if independent evidence documents why the original finding was wrong", () => {
  const receipt = trackedReceipt();
  receipt.findings[0].disposition = "KEEP_JUSTIFIED";
  receipt.findings[0].justification = "Different destinations when actual router state is resolved";
  receipt.findings[0].reassessment = {
    reason: "Toolbar opens job-specific settings, not /settings",
    evidenceRef: "tests/navigation.test.ts#route-targets",
  };
  receipt.changeSummary = { kind: "NO_CHANGE", addressedFindingIds: [], rationale: "Original duplicate finding disproved by router tests" };
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.equal(result.valid, true, result.problems.join("\n"));
});

test("a screenshot alone cannot close a prior navigation defect", () => {
  const receipt = trackedReceipt();
  delete receipt.findings[0].verification.method;
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.match(result.problems.join("\n"), /needs TEST or RUNTIME behavior evidence/);
});

test("cosmetic repaint cannot substitute for unresolved high-priority improvement", () => {
  const receipt = trackedReceipt();
  receipt.iterationVerdict = "PARTIAL";
  receipt.verdictReason = "Settings still duplicated";
  receipt.findings[0].disposition = "PERSISTS";
  receipt.findings[0].reason = "Both settings links remain";
  receipt.openCarryover = ["UX-01"];
  receipt.changeSummary = {
    kind: "COSMETIC_ONLY",
    addressedFindingIds: [],
    rationale: "Repainted accent from blue to orange",
  };
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.match(result.problems.join("\n"), /cannot substitute cosmetic-only changes/);
});

test("user-directed RESTYLE can remain PARTIAL without falsely closing functional issues", () => {
  const baseline = trackedBaseline();
  baseline.intent = "RESTYLE";
  const receipt = trackedReceipt();
  receipt.iterationVerdict = "PARTIAL";
  receipt.verdictReason = "The requested visual restyle did not address navigation duplication";
  receipt.findings[0].disposition = "PERSISTS";
  receipt.findings[0].reason = "The prior navigation finding is out of the authorized restyle scope";
  receipt.openCarryover = ["UX-01"];
  receipt.changeSummary = {
    kind: "COSMETIC_ONLY",
    addressedFindingIds: [],
    rationale: "User specifically requested a palette-only restyle; functional issue carried forward",
  };
  const result = validateIterationReceipt(receipt, baseline);
  assert.equal(result.valid, true, result.problems.join("\n"));
  assert.deepEqual(result.openCarryover, ["UX-01"]);
});

test("TASK_REPAIR cannot cite unknown findings or omit implementation evidence", () => {
  const receipt = trackedReceipt();
  receipt.changeSummary.addressedFindingIds = ["UNKNOWN"];
  receipt.changeSummary.evidenceRef = "";
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.match(result.problems.join("\n"), /must be unique known baseline IDs/);
  assert.match(result.problems.join("\n"), /needs actual implementation or runtime evidence/);
});

test("CLI requires the pre-edit baseline and rejects missing carried findings", () => {
  const dir = mkdtempSync(join(tmpdir(), "design-prior-findings-"));
  try {
    const receiptPath = join(dir, "receipt.json");
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(baselinePath, JSON.stringify(trackedBaseline()));
    writeFileSync(receiptPath, JSON.stringify(trackedReceipt()));
    const missing = spawnSync(process.execPath, [cli, "--receipt", receiptPath], { encoding: "utf8" });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /requires --baseline/);
    const good = spawnSync(process.execPath, [cli, "--receipt", receiptPath, "--baseline", baselinePath], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.equal(JSON.parse(good.stdout).baselineChecked, true);
    const altered = trackedReceipt();
    altered.findings[0].id = "UX-NEW";
    writeFileSync(receiptPath, JSON.stringify(altered));
    const bad = spawnSync(process.execPath, [cli, "--receipt", receiptPath, "--baseline", baselinePath], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /prior finding missing from final receipt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
