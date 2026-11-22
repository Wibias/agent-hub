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
  receipt.findings[0].kind = "NAVIGATION";
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
  assert.match(result.problems.join("\n"), /FINDING_IDENTITY_CHANGED/);
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
    method: "TEST",
  };
  receipt.changeSummary = { kind: "NO_CHANGE", addressedFindingIds: [], rationale: "Original duplicate finding disproved by router tests" };
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.equal(result.valid, true, result.problems.join("\n"));
});

test("a previous navigation duplicate cannot be dismissed with screenshot-only reassessment", () => {
  const receipt = trackedReceipt();
  receipt.findings[0].disposition = "KEEP_JUSTIFIED";
  receipt.findings[0].justification = "The links seem distinct";
  receipt.findings[0].reassessment = {
    reason: "May target distinct views",
    evidenceRef: "screens/settings-links.png",
    method: "SCREENSHOT",
  };
  receipt.changeSummary = { kind: "NO_CHANGE", addressedFindingIds: [],
    rationale: "Potentially different destinations" };
  const result = validateIterationReceipt(receipt, trackedBaseline());
  assert.match(result.problems.join(" "), /KEEP_JUSTIFIED needs TEST or RUNTIME reassessment/);
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
  assert.match(result.problems.join("\n"), /must be unique known final finding IDs/);
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

test("baseline identity rejects hijacking a historical finding even with matching route/acceptance", () => {
  const baseline = trackedBaseline();
  const payload = trackedReceipt(baseline);
  const original = baseline.findings[0];
  const current = payload.findings.find(f => f.id === original.id);
  current.kind = original.kind === "VISUAL" ? "DETAIL" : "VISUAL";
  current.symptom = "Unrelated filter empty state";
  const errors = validateIterationReceipt(payload, baseline).problems.join("; ");
  assert.match(errors, /FINDING_IDENTITY_CHANGED/);
});

test("a medium-priority old visual finding blocks cosmetic detours in an IMPROVE run", () => {
  const baseline = trackedBaseline();
  baseline.findings[0].priority = "MEDIUM";
  baseline.findings[0].kind = "VISUAL";
  const receipt = trackedReceipt();
  receipt.iterationVerdict = "PARTIAL";
  receipt.verdictReason = "Old visual defect remains while cosmetic title bar is changed";
  receipt.findings[0].kind = "VISUAL";
  receipt.findings[0].disposition = "IMPROVED_BUT_OPEN";
  receipt.findings[0].reason = "Current compact selected state not yet repaired";
  receipt.openCarryover = ["UX-01"];
  receipt.changeSummary = {
    kind: "COSMETIC_ONLY", addressedFindingIds: [], rationale: "New dark title bar",
  };
  const unprioritized = validateIterationReceipt(receipt, baseline);
  assert.match(unprioritized.problems.join("; "), /UNRESOLVED_FINDING_DEPRIORITIZED UX-01/);
  receipt.priorityDeferrals = [{ findingId: "UX-01", basis: "EXPLICIT_USER_SCOPE",
    reason: "User explicitly requested only title-bar styling",
    evidenceRef: "brief/user-titlebar-only.txt" }];
  assert.equal(validateIterationReceipt(receipt, baseline).valid, true,
    validateIterationReceipt(receipt, baseline).problems.join("; "));
});
test("a low-priority task repair cannot silently skip an older medium-priority issue", () => {
  const baseline = trackedBaseline();
  baseline.findings[0].priority = "MEDIUM";
  baseline.findings[0].kind = "VISUAL";
  baseline.findings.push({
    id: "UX-02", route: "/settings", kind: "VISUAL", priority: "LOW",
    symptom: "Risk of unnecessary redesign",
    acceptance: "Form remains readable and logically grouped",
    evidenceRef: "review/settings-before.png",
  });
  const receipt = trackedReceipt();
  receipt.iterationVerdict = "PARTIAL";
  receipt.verdictReason = "Higher priority issue remains unaddressed";
  receipt.findings[0].kind = "VISUAL";
  receipt.findings[0].disposition = "PERSISTS";
  receipt.findings[0].reason = "Old defect still visible";
  receipt.openCarryover = ["UX-01"];
  receipt.findings[1].kind = "VISUAL";
  receipt.findings[1].disposition = "RESOLVED";
  receipt.findings[1].decision = "Repair settings copy";
  receipt.findings[1].before = captured("review/settings-before.png", "/settings");
  receipt.findings[1].verification = { result: "PASS", evidenceRef: "tests/settings-layout.test.ts" };
  receipt.changeSummary = {
    kind: "TASK_REPAIR", addressedFindingIds: ["UX-02"],
    rationale: "Fixed lower-priority settings polish",
    evidenceRef: "diff/settings-surface.patch",
  };
  assert.match(validateIterationReceipt(receipt, baseline).problems.join("; "),
    /UNRESOLVED_FINDING_DEPRIORITIZED UX-01/);
  receipt.priorityDeferrals = [{ findingId: "UX-01", basis: "BLOCKED",
    reason: "No write access to the KPI view source in this session",
    evidenceRef: "logs/source-access-denied.txt" }];
  assert.match(validateIterationReceipt(receipt, baseline).problems.join("; "),
    /UNRESOLVED_FINDING_DEPRIORITIZED/);
  receipt.priorityDeferrals[0].nextStep = "Get authorized write access and fix the KPI view";
  assert.equal(validateIterationReceipt(receipt, baseline).valid, true,
    validateIterationReceipt(receipt, baseline).problems.join("; "));

  // Relabeling the same open older finding must not allow a new
  // low-priority repair to bypass the exception requirement.
  delete receipt.priorityDeferrals;
  for (const status of ["UNVERIFIED", "DEFERRED"]) {
    receipt.findings[0].disposition = status;
    receipt.findings[0].reason = "Current KPI verification is unavailable";
    assert.match(validateIterationReceipt(receipt, baseline).problems.join("; "),
      /UNRESOLVED_FINDING_DEPRIORITIZED UX-01/);
  }
});

test("an unverified older medium defect blocks cosmetic detours, not a no-change verification", () => {
  const baseline = trackedBaseline();
  baseline.findings[0].priority = "MEDIUM";
  baseline.findings[0].kind = "VISUAL";
  const receipt = trackedReceipt();
  receipt.iterationVerdict = "PARTIAL";
  receipt.verdictReason = "The compact KPI state could not be measured";
  receipt.findings[0].kind = "VISUAL";
  receipt.findings[0].disposition = "UNVERIFIED";
  receipt.findings[0].reason = "No current native compact KPI measurement";
  receipt.openCarryover = ["UX-01"];
  receipt.changeSummary = {
    kind: "COSMETIC_ONLY", addressedFindingIds: [],
    rationale: "Repainted the title bar instead of verifying the KPI",
  };
  assert.match(validateIterationReceipt(receipt, baseline).problems.join("; "),
    /UNRESOLVED_FINDING_DEPRIORITIZED UX-01/);

  receipt.changeSummary = {
    kind: "NO_CHANGE", addressedFindingIds: [],
    rationale: "No source edit; compact capture unavailable",
  };
  assert.equal(validateIterationReceipt(receipt, baseline).valid, true,
    validateIterationReceipt(receipt, baseline).problems.join("; "));

  receipt.changeSummary = {
    kind: "COSMETIC_ONLY", addressedFindingIds: [],
    rationale: "Explicitly scoped title-bar work while native capture is unavailable",
  };
  receipt.priorityDeferrals = [{
    findingId: "UX-01", basis: "BLOCKED",
    reason: "Native compact render cannot start in this session",
    evidenceRef: "logs/compact-native-launch-failure.txt",
    nextStep: "Obtain a native compact render and inspect the KPI bottom clearance",
  }];
  assert.equal(validateIterationReceipt(receipt, baseline).valid, true,
    validateIterationReceipt(receipt, baseline).problems.join("; "));
});

test("user screenshot confirms old KPI defect: UNVERIFIED and no-change cannot avoid repair", () => {
  const baseline = trackedBaseline();
  baseline.findings[0].priority = "MEDIUM";
  baseline.findings[0].kind = "VISUAL";
  const r = trackedReceipt();
  r.iterationVerdict = "PARTIAL";
  r.verdictReason = "Only a current compact screenshot was inspected";
  r.findings[0].kind = "VISUAL";
  r.findings[0].disposition = "UNVERIFIED";
  r.findings[0].reason = "Multi-viewport matrix is missing";
  r.openCarryover = ["UX-01"];
  r.changeSummary = {
    kind: "NO_CHANGE", addressedFindingIds: [],
    rationale: "No source edit because other viewports were unavailable",
  };
  r.currentVisualObservations = [{
    findingId: "UX-01", observed: true, method: "SCREENSHOT_REVIEW",
    reportedBy: "USER", issueCode: "KPI_BOTTOM_CLEARANCE",
    viewportId: "COMPACT", evidenceRef: "user/pcguardian-compact-current.png",
  }];

  assert.match(validateIterationReceipt(r, baseline).problems.join("; "),
    /OBSERVED_VISUAL_DEFECT_UNVERIFIED UX-01/);
  r.findings[0].disposition = "PERSISTS";
  assert.match(validateIterationReceipt(r, baseline).problems.join("; "),
    /OBSERVED_VISUAL_DEFECT_WITHOUT_REPAIR UX-01/);
  r.persistentRepairActions = { invalid: true };
  assert.match(validateIterationReceipt(r, baseline).problems.join("; "),
    /persistentRepairActions must be an array/,
    "malformed action evidence must not crash the validator");
  delete r.persistentRepairActions;

  // A real access blocker is truthful; speculative source edits are not.
  r.persistentRepairActions = [{
    findingId: "UX-01", action: "BLOCKED",
    blocker: "Native project source is read-only in this session",
    nextStep: "Obtain authorized source access and rerender the compact state",
  }];
  assert.equal(validateIterationReceipt(r, baseline).valid, true,
    validateIterationReceipt(r, baseline).problems.join("; "));

  r.persistentRepairActions = [{
    findingId: "UX-01", action: "SOURCE_REPAIR",
    sourceFile: "UI/MainForm.cs",
    beforeRef: "renders/compact-before.png",
    afterRef: "renders/compact-after.png",
    renderResult: "REVISE",
  }];
  r.changeSummary = {
    kind: "TASK_REPAIR", addressedFindingIds: ["UX-01"],
    rationale: "Reallocated KPI strip height and bottom padding",
    evidenceRef: "diff/main-form-kpi.patch",
  };
  assert.equal(validateIterationReceipt(r, baseline).valid, true,
    validateIterationReceipt(r, baseline).problems.join("; "));
});

test("a newly observed input alignment defect may be repaired in the same iteration", () => {
  const baseline = trackedBaseline();
  const r = trackedReceipt();
  r.iterationVerdict = "PARTIAL";
  r.verdictReason = "A different KPI finding still needs full viewport verification";
  const issue = {
    id: "PCG-INPUT", route: "/jobs", kind: "DETAIL", priority: "LOW",
    symptom: "Search placeholder text is vertically off-center",
    acceptance: "Placeholder and entered text are vertically balanced in the input",
    evidenceRef: "user/search-field-compact.png",
    decision: "Repair search input text alignment",
    disposition: "PERSISTS", reason: "User screenshot confirms visible misalignment",
  };
  r.findings.push(issue);
  r.openCarryover = ["PCG-INPUT"];
  r.currentVisualObservations = [{
    findingId: "PCG-INPUT", observed: true, method: "SCREENSHOT_REVIEW",
    reportedBy: "USER", issueCode: "INPUT_TEXT_VERTICAL_ALIGNMENT",
    viewportId: "COMPACT", evidenceRef: "user/search-field-compact.png",
  }];
  r.changeSummary = {
    kind: "TASK_REPAIR", addressedFindingIds: ["PCG-INPUT"],
    rationale: "Changed WinForms input text rendering margins",
    evidenceRef: "diff/search-input-align.patch",
  };
  assert.match(validateIterationReceipt(r, baseline).problems.join("; "),
    /OBSERVED_VISUAL_DEFECT_WITHOUT_REPAIR PCG-INPUT/);
  r.persistentRepairActions = [{
    findingId: "PCG-INPUT", action: "SOURCE_REPAIR",
    sourceFile: "UI/DarkControls.cs",
    beforeRef: "renders/search-before.png",
    afterRef: "renders/search-after.png",
    renderResult: "REVISE",
  }];
  assert.equal(validateIterationReceipt(r, baseline).valid, true,
    validateIterationReceipt(r, baseline).problems.join("; "));
});

test("uninspected user reports must not be promoted to observed render evidence", () => {
  const baseline = trackedBaseline();
  const r = trackedReceipt();
  r.iterationVerdict = "PARTIAL";
  r.verdictReason = "No current render is accessible";
  r.findings[0].disposition = "UNVERIFIED";
  r.findings[0].reason = "Screenshot unavailable";
  r.openCarryover = ["UX-01"];
  r.changeSummary = { kind: "NO_CHANGE", addressedFindingIds: [], rationale: "No render evidence" };
  r.currentVisualObservations = [{
    findingId: "UX-01", observed: false, method: "SCREENSHOT_REVIEW",
    reportedBy: "USER", issueCode: "KPI_BOTTOM_CLEARANCE",
    viewportId: "COMPACT", evidenceRef: "missing.png",
  }];
  assert.match(validateIterationReceipt(r, baseline).problems.join("; "),
    /CURRENT_VISUAL_OBSERVATION_INVALID/);
  r.currentVisualObservations[0].observed = true;
  r.currentVisualObservations[0].reportedBy = "UNKNOWN";
  assert.match(validateIterationReceipt(r, baseline).problems.join("; "),
    /CURRENT_VISUAL_OBSERVATION_INVALID/,
    "unrecognized provenance cannot silently bypass observed USER defect repair");
  delete r.currentVisualObservations;
  assert.equal(validateIterationReceipt(r, baseline).valid, true,
    validateIterationReceipt(r, baseline).problems.join("; "));
});
