import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  initializeLedger, importFindings, makeLedgerBaseline, readLedger, syncLedger,
  verifyLedgerCoverage, discoverProjectLedger,
} from "../scripts/findings-ledger.mjs";
import { runGate, checkProof } from "../scripts/run-iteration-gate.mjs";

const historic = [
  { id: "UX-SETTINGS", route: "/jobs", kind: "NAVIGATION", priority: "MEDIUM",
    symptom: "Two generic Settings links may navigate to the same page",
    acceptance: "Confirm destinations; avoid redundant generic entries if identical",
    evidenceRef: "audit/jobs-desktop.png" },
  { id: "UX-PUBLISH", route: "/jobs", kind: "WORKFLOW", priority: "HIGH",
    symptom: "Publishing consent is unverified against the live service",
    acceptance: "Real publish requires valid authorization and a reported provider result",
    evidenceRef: "tests/publish-fixture.txt" },
  { id: "UX-DETAIL", route: "/jobs/:id", kind: "DETAIL", priority: "MEDIUM",
    symptom: "Detail panel has only passive metadata",
    acceptance: "Inspect job data and provide actual actionable inspection where supported",
    evidenceRef: "screens/job-detail.png" },
];
async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "ux-ledger-test-"));
  const dir = join(root, ".design-with-ai");
  mkdirSync(dir);
  const ledgerPath = join(dir, "findings-ledger.json");
  initializeLedger(ledgerPath);
  importFindings(ledgerPath, { findings: historic });
  const baseline = makeLedgerBaseline(readLedger(ledgerPath),
    { scope: ["/jobs"], runId: "run-fixture-1" });
  const baselinePath = join(root, "baseline.json");
  const receiptPath = join(root, "receipt.json");
  const proofPath = join(root, "proof.json");
  writeFileSync(baselinePath, JSON.stringify(baseline));
  function receipt() {
    return {
      schemaVersion: 1, requiresPriorBaseline: true, requiresFindingsLedger: true,
      iterationVerdict: "PARTIAL",
      verdictReason: "Live TikTok publishing unavailable",
      changeSummary: { kind: "NO_CHANGE", rationale: "Runtime conditions still unresolved", addressedFindingIds: [] },
      scope: [{ route: "/jobs", task: "Review and publish clips", coverage: "INSPECTED",
        semantics: { applicable: false, reason: "This fixture only tests ledger coverage" } }],
      findings: baseline.findings.map(x => ({
        ...x, decision: "Preserve and reassess the finding", disposition: "PERSISTS",
        reason: "Acceptance remains unproven in fixture",
      })),
      openCarryover: baseline.findings.map(x => x.id),
    };
  }
  try { return await fn({ root, ledgerPath, baseline, baselinePath, receiptPath, proofPath, receipt }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("frozen snapshot retains every historic in-scope issue and excludes unrelated route", () => fixture(f => {
  assert.deepEqual(f.baseline.findings.map(x => x.id), ["UX-SETTINGS", "UX-PUBLISH"]);
  assert.equal(f.baseline.ledgerSnapshot.eventCount, 3);
  assert.equal(discoverProjectLedger(f.root), f.ledgerPath);
}));

test("import is idempotent and rejects conflicting reuse of a finding ID", () => fixture(f => {
  assert.equal(importFindings(f.ledgerPath, { findings: [historic[0]] }).added, 0);
  const altered = { ...historic[0], acceptance: "Use orange button" };
  assert.throws(() => importFindings(f.ledgerPath, { findings: [altered] }), /Conflicting historical finding ID/);
}));

test("an omitted known issue cannot pass ledger coverage even with a plausible receipt", () => fixture(f => {
  const receipt = f.receipt();
  const ledger = readLedger(f.ledgerPath);
  const filtered = { ...f.baseline, findings: f.baseline.findings.filter(x => x.id !== "UX-SETTINGS") };
  assert.match(verifyLedgerCoverage(ledger, filtered, receipt).problems.join(" "), /UX-SETTINGS/);
  receipt.findings = receipt.findings.filter(x => x.id !== "UX-SETTINGS");
  receipt.openCarryover = ["UX-PUBLISH"];
  assert.throws(() => syncLedger(f.ledgerPath, filtered, receipt), /UX-SETTINGS/);
}));

test("history cannot be rewritten after baseline snapshot", () => fixture(f => {
  const ledger = readLedger(f.ledgerPath);
  ledger.events[0].acceptance = "An intentionally weakened acceptance";
  assert.match(verifyLedgerCoverage(ledger, f.baseline, f.receipt()).problems.join(" "),
    /Historic findings ledger prefix changed/);
}));

test("synchronization appends verdicts without deleting or editing old discoveries", () => fixture(f => {
  const receipt = f.receipt();
  const before = readLedger(f.ledgerPath).events;
  assert.deepEqual(syncLedger(f.ledgerPath, f.baseline, receipt),
    { added: 0, assessed: 2, idempotent: false });
  const ledger = readLedger(f.ledgerPath);
  assert.deepEqual(ledger.events.slice(0, before.length), before);
  assert.deepEqual(ledger.events.slice(before.length).map(x => x.id), ["UX-SETTINGS", "UX-PUBLISH"]);
  assert.equal(verifyLedgerCoverage(ledger, f.baseline, receipt).valid, true);
  assert.equal(syncLedger(f.ledgerPath, f.baseline, receipt).idempotent, true);
}));

test("new findings are appended and remain visible in the next iteration", () => fixture(f => {
  const receipt = f.receipt();
  const extra = { id: "UX-NEW", route: "/jobs", kind: "VISUAL", priority: "LOW",
    symptom: "Small label not legible", acceptance: "Readable label at 390px",
    evidenceRef: "screens/mobile.png", decision: "Investigate label",
    disposition: "PERSISTS", reason: "Not resolved" };
  receipt.findings.push(extra);
  receipt.openCarryover.push(extra.id);
  const outcome = syncLedger(f.ledgerPath, f.baseline, receipt);
  assert.equal(outcome.added, 1);
  const next = makeLedgerBaseline(readLedger(f.ledgerPath),
    { scope: ["/jobs"], runId: "run-fixture-2" });
  assert.ok(next.findings.some(x => x.id === "UX-NEW"));
  assert.ok(next.findings.some(x => x.id === "UX-SETTINGS"));
}));

test("a disproven navigation duplicate can be kept, but only with reassessment evidence", () => fixture(f => {
  const receipt = f.receipt();
  receipt.findings[0].disposition = "KEEP_JUSTIFIED";
  receipt.findings[0].decision = "Retain because routes are different";
  receipt.findings[0].justification = "Actual destinations differ";
  receipt.findings[0].after = { ref: "tests/router-links.txt" };
  receipt.findings[0].reassessment = {
    reason: "Toolbar opens a job-scoped settings panel rather than /settings",
    evidenceRef: "tests/router-links.test.ts",
    method: "TEST",
  };
  receipt.openCarryover = ["UX-PUBLISH"];
  assert.equal(syncLedger(f.ledgerPath, f.baseline, receipt).assessed, 2);
  const events = readLedger(f.ledgerPath).events;
  assert.equal(events.at(-2).disposition, "KEEP_JUSTIFIED");
  const next = makeLedgerBaseline(readLedger(f.ledgerPath),
    { scope: ["/jobs"], runId: "run-fixture-2" });
  assert.ok(next.findings.some(x => x.id === "UX-SETTINGS"),
    "Disproved findings remain available for regression inspection");
}));

test("run-iteration-gate binds the durable ledger and rejects omission of --ledger", () => fixture(f => {
  const receipt = f.receipt();
  syncLedger(f.ledgerPath, f.baseline, receipt);
  writeFileSync(f.receiptPath, JSON.stringify(receipt));
  assert.throws(() => runGate({
    receipt: f.receiptPath, baseline: f.baselinePath,
    proof: f.proofPath, workspaceCwd: f.root,
  }), /pass --ledger/);
  assert.equal(runGate({
    receipt: f.receiptPath, baseline: f.baselinePath,
    ledger: f.ledgerPath, proof: f.proofPath, workspaceCwd: f.root,
  }).exitCode, 0);
  const proof = JSON.parse(readFileSync(f.proofPath, "utf8"));
  assert.equal(proof.schemaVersion, 2);
  assert.equal(proof.result.ledgerChecked, true);
  const result = checkProof({ receipt: f.receiptPath, baseline: f.baselinePath,
    ledger: f.ledgerPath, checkProof: f.proofPath, workspaceCwd: f.root });
  assert.equal(result.valid, true, result.issues.join("; "));
  assert.equal(result.completionEligible, false);
  assert.match(checkProof({ receipt: f.receiptPath, baseline: f.baselinePath,
    checkProof: f.proofPath, workspaceCwd: f.root }).issues.join("; "),
    /ledger present/i);
}));

test("proof rejects modifications to the persistent ledger after validation", () => fixture(f => {
  const receipt = f.receipt();
  syncLedger(f.ledgerPath, f.baseline, receipt);
  writeFileSync(f.receiptPath, JSON.stringify(receipt));
  assert.equal(runGate({ receipt: f.receiptPath, baseline: f.baselinePath,
    ledger: f.ledgerPath, proof: f.proofPath, workspaceCwd: f.root }).exitCode, 0);
  const ledger = readLedger(f.ledgerPath);
  ledger.events.push({ type: "REVIEWED", id: "UX-SETTINGS", runId: "later",
    disposition: "PERSISTS", reason: "Retested", evidenceRef: "tests/new.txt" });
  writeFileSync(f.ledgerPath, JSON.stringify(ledger));
  const result = checkProof({ receipt: f.receiptPath, baseline: f.baselinePath,
    ledger: f.ledgerPath, checkProof: f.proofPath, workspaceCwd: f.root });
  assert.equal(result.valid, false);
  assert.match(result.issues.join("; "), /ledger changed after the recorded execution/);
}));

test("changed acceptance rationale cannot reuse an earlier persisted assessment", () => fixture(f => {
  const receipt = f.receipt();
  syncLedger(f.ledgerPath, f.baseline, receipt);
  receipt.findings[0].reason = "A later altered rationale";
  const status = verifyLedgerCoverage(readLedger(f.ledgerPath), f.baseline, receipt);
  assert.equal(status.valid, false);
  assert.match(status.problems.join(" "), /missing matching persisted run assessment: UX-SETTINGS/);
  assert.throws(() => syncLedger(f.ledgerPath, f.baseline, receipt),
    /Existing run assessment differs/);
}));

test("ledger refuses to reset existing history", () => fixture(f => {
  assert.equal(existsSync(f.ledgerPath), true);
  assert.throws(() => initializeLedger(f.ledgerPath), /refusing to reset/);
}));

test("re-running sync after altering a receipt cannot rewrite prior assessments", () => fixture(f => {
  const receipt = f.receipt();
  syncLedger(f.ledgerPath, f.baseline, receipt);
  receipt.findings[0].disposition = "DEFERRED";
  receipt.findings[0].reason = "New claim";
  assert.throws(() => syncLedger(f.ledgerPath, f.baseline, receipt),
    /Existing run assessment differs/);
}));

test("optional design artifact references are append-only and idempotent", () => fixture(f => {
  const item = {
    id: "UX-NEW-LINEAGE", route: "/jobs", kind: "VISUAL", priority: "MEDIUM",
    symptom: "Visible task status ambiguous", acceptance: "State is clear",
    evidenceRef: "renders/before.png",
    sourceDesignArtifactRef: "slice:before-sha", designArtifactRef: "slice:after-sha",
  };
  assert.equal(importFindings(f.ledgerPath, { findings: [item] }).added, 1);
  const found = readLedger(f.ledgerPath).events.find(e => e.id === item.id);
  assert.equal(found.designArtifactRef, item.designArtifactRef);
  assert.equal(found.sourceDesignArtifactRef, item.sourceDesignArtifactRef);
  assert.equal(importFindings(f.ledgerPath, { findings: [item] }).added, 0);
  assert.equal(importFindings(f.ledgerPath, { findings: [historic[0]] }).added, 0);
  assert.throws(() => importFindings(f.ledgerPath, {
    findings: [{ ...item, designArtifactRef: "slice:conflict" }],
  }), /Conflicting historical finding ID/);
}));
test("blank optional design source is rejected", () => fixture(f => {
  assert.throws(() => importFindings(f.ledgerPath, { findings: [
    { ...historic[0], id: "UX-BAD-LINEAGE", designArtifactRef: "" },
  ] }), /requires id/);
}));

test("unversioned latest cannot be imported as a design artifact reference", () => fixture(f => {
  assert.throws(() => importFindings(f.ledgerPath, { findings: [
    { ...historic[0], id: "UX-UNVERSIONED", designArtifactRef: "slice/latest" },
  ] }), /requires id/);
}));

test("reviewed design refs persist with the run and cannot be rewritten", () => fixture(f => {
  const receipt = f.receipt();
  receipt.findings[0].sourceDesignArtifactRef = "slice:before";
  receipt.findings[0].designArtifactRef = "slice:after";
  syncLedger(f.ledgerPath, f.baseline, receipt);
  const evt = readLedger(f.ledgerPath).events.find(e =>
    e.type === "REVIEWED" && e.id === receipt.findings[0].id);
  assert.equal(evt.sourceDesignArtifactRef, "slice:before");
  assert.equal(evt.designArtifactRef, "slice:after");
  assert.equal(verifyLedgerCoverage(readLedger(f.ledgerPath), f.baseline, receipt).valid, true);
  const altered = structuredClone(receipt);
  altered.findings[0].designArtifactRef = "slice:changed-later";
  assert.throws(() => syncLedger(f.ledgerPath, f.baseline, altered), /Existing run assessment differs/);
}));

test("native PARTIAL cannot append a newly visual RESOLVED finding without final render", () => fixture(f => {
  const receipt = f.receipt();
  receipt.surfaceKind = "DENSE_DESKTOP_MONITOR";
  receipt.findings.push({
    id: "UX-VISUAL-NEW", route: "/jobs", kind: "VISUAL", priority: "MEDIUM",
    symptom: "Small detail table is unreadable",
    acceptance: "Table remains legible when inspector opens",
    evidenceRef: "screens/compact-before.png",
    decision: "Repair layout", disposition: "RESOLVED",
    before: { ref: "screens/compact-before.png", route: "/jobs", viewport: "compact",
      stateKey: "selected", dataKey: "rows" },
    after: { ref: "screens/compact-after.png", route: "/jobs", viewport: "compact",
      stateKey: "selected", dataKey: "rows" },
    verification: { result: "PASS", evidenceRef: "tests/table-layout.test.js" },
  });
  const before = readLedger(f.ledgerPath).events.length;
  assert.throws(() => syncLedger(f.ledgerPath, f.baseline, receipt),
    /VISUAL_CLOSURE_UNVERIFIED UX-VISUAL-NEW/);
  assert.equal(readLedger(f.ledgerPath).events.length, before,
    "refusing unsupported closure must leave immutable history untouched");
  const open = receipt.findings.at(-1);
  open.disposition = "UNVERIFIED";
  open.reason = "No rendered selected-state screenshot yet";
  receipt.openCarryover.push(open.id);
  assert.equal(syncLedger(f.ledgerPath, f.baseline, receipt).added, 1,
    "documented open finding may still be persisted with PARTIAL");
}));

test("PCG-16 cannot be silently reassigned from KPI gap to an unrelated empty-filter state", () => fixture(f => {
  const original = {
    id: "PCG-16", route: "/jobs", kind: "VISUAL", priority: "MEDIUM",
    symptom: "Compact KPI supporting text collides with the bottom divider",
    acceptance: "At least six DPI-aware pixels below supporting KPI lines",
    evidenceRef: "renders/compact-kpi-before.png",
  };
  importFindings(f.ledgerPath, { findings: [original] });
  const baseline = makeLedgerBaseline(readLedger(f.ledgerPath),
    { scope: ["/jobs"], runId: "pcg-id-collision" });
  const receipt = f.receipt();
  receipt.findings.push({ ...original, kind: "DETAIL",
    symptom: "Empty filter shows a misleading inspector hint",
    decision: "Fix the empty-filter hint", disposition: "PERSISTS",
    reason: "Not verified in all windows" });
  receipt.openCarryover.push("PCG-16");
  const snapshot = readLedger(f.ledgerPath).events;
  assert.throws(() => syncLedger(f.ledgerPath, baseline, receipt), /FINDING_IDENTITY_CHANGED/);
  assert.deepEqual(readLedger(f.ledgerPath).events, snapshot,
    "identity rejection must not append to durable history");
  receipt.findings.at(-1).kind = "DETAIL";
  receipt.findings.at(-1).acceptance = "Show a relevant hint after filtering to zero processes";
  receipt.findings.at(-1).id = "PCG-17"; // distinct real observation gets a distinct ID
  receipt.openCarryover = ["UX-SETTINGS", "UX-PUBLISH", "PCG-17", "PCG-16"];
  receipt.findings.push({ ...original, decision: "Continue KPI measurement",
    disposition: "PERSISTS", reason: "Compact footer still too close to the divider" });
  assert.equal(syncLedger(f.ledgerPath, baseline, receipt).added, 1);
}));
test("repeated observed desktop KPI defects require source repair or a named blocker", () => fixture(f => {
  const issue = {
    id: "PCG-KPI", route: "/jobs", kind: "VISUAL", priority: "MEDIUM",
    symptom: "KPI supporting lines are only two pixels above the divider",
    acceptance: "The compact window leaves at least six pixels of bottom clearance",
    evidenceRef: "renders/compact-kpi-initial.png",
  };
  importFindings(f.ledgerPath, { findings: [issue] });
  const makeReceipt = () => {
    const r = f.receipt();
    r.findings.push({ ...issue, decision: "Keep investigating the KPI strip",
      disposition: "PERSISTS", reason: "Gap is still measured at two pixels" });
    r.openCarryover.push(issue.id);
    return r;
  };
  const first = makeLedgerBaseline(readLedger(f.ledgerPath),
    { scope: ["/jobs"], runId: "kpi-iteration-one" });
  syncLedger(f.ledgerPath, first, makeReceipt());
  const second = makeLedgerBaseline(readLedger(f.ledgerPath),
    { scope: ["/jobs"], runId: "kpi-iteration-two" });
  syncLedger(f.ledgerPath, second, makeReceipt());
  const third = makeLedgerBaseline(readLedger(f.ledgerPath),
    { scope: ["/jobs"], runId: "kpi-iteration-three" });
  const current = makeReceipt();
  const before = readLedger(f.ledgerPath).events;
  assert.throws(() => syncLedger(f.ledgerPath, third, current),
    /REPEATED_DEFECT_WITHOUT_REPAIR PCG-KPI/);
  assert.deepEqual(readLedger(f.ledgerPath).events, before);
  current.persistentRepairActions = [{ findingId: issue.id, action: "SOURCE_REPAIR",
    sourceFile: "UI/MainForm.cs", beforeRef: "diffs/mainform-before",
    afterRef: "diffs/mainform-after", renderResult: "REVISE" }];
  assert.throws(() => syncLedger(f.ledgerPath, third, current),
    /SOURCE_REPAIR_UNPROVEN/);
  current.changeSummary = { kind: "TASK_REPAIR",
    rationale: "Increased actual KPI panel height and safe bottom padding",
    addressedFindingIds: [issue.id], evidenceRef: "diffs/mainform-kpi-branch.patch" };
  assert.equal(syncLedger(f.ledgerPath, third, current).assessed, current.findings.length);
  assert.equal(readLedger(f.ledgerPath).events.filter(e => e.type === "FOUND" && e.id === issue.id).length, 1);
}));
test("a real blocker permits truthful PARTIAL without inventing a source change", () => fixture(f => {
  const issue = { id: "PCG-ACCESS", route: "/jobs", kind: "VISUAL", priority: "HIGH",
    symptom: "The selected inspector clips its process list",
    acceptance: "Keep at least three process rows visible with inspector open",
    evidenceRef: "screens/selected-before.png" };
  importFindings(f.ledgerPath, { findings: [issue] });
  const r = () => {
    const receipt = f.receipt();
    receipt.findings.push({ ...issue, decision: "Recheck selected window",
      disposition: "REGRESSED", reason: "Only two rows measured" });
    receipt.openCarryover.push(issue.id);
    return receipt;
  };
  for (const [index, runId] of ["access-1", "access-2"].entries()) {
    const base = makeLedgerBaseline(readLedger(f.ledgerPath), { scope: ["/jobs"], runId });
    assert.equal(syncLedger(f.ledgerPath, base, r()).assessed, 3);
  }
  const base = makeLedgerBaseline(readLedger(f.ledgerPath), { scope: ["/jobs"], runId: "access-3" });
  const current = r();
  current.persistentRepairActions = [{ findingId: issue.id, action: "BLOCKED",
    blocker: "The target project's source is read-only in this session",
    nextStep: "Use an authorized editable source worktree before attempting the repair" }];
  assert.equal(syncLedger(f.ledgerPath, base, current).assessed, 3);
}));
