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
