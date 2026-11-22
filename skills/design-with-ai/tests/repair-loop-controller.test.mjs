import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { decideRepairLoop } from "../scripts/repair-loop-controller.mjs";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/repair-loop-controller.mjs");
const baseline = () => ({
  schemaVersion: 1, intent: "IMPROVE", scope: ["/dashboard"],
  findings: [
    { id: "UX-OLD", route: "/dashboard", kind: "VISUAL", priority: "HIGH",
      symptom: "Footer overlaps supporting label", acceptance: "Visible bottom clearance",
      evidenceRef: "before.png" },
    { id: "UX-SEARCH", route: "/dashboard", kind: "DETAIL", priority: "MEDIUM",
      symptom: "Search text is off center", acceptance: "Search text vertically balanced",
      evidenceRef: "search-before.png" },
  ],
});
const receipt = () => ({
  schemaVersion: 1, surfaceKind: "DENSE_DESKTOP_MONITOR",
  iterationVerdict: "PARTIAL", verdictReason: "Native QA in progress",
  gates: { render: "REVISE", functional: "PASS" },
  changeSummary: { kind: "TASK_REPAIR", addressedFindingIds: ["UX-NEW"],
    rationale: "A new search shortcut was added", evidenceRef: "diff/shortcut.patch" },
  findings: [
    { id: "UX-OLD", kind: "VISUAL", priority: "HIGH",
      disposition: "PERSISTS", acceptance: "Visible bottom clearance" },
    { id: "UX-SEARCH", kind: "DETAIL", priority: "MEDIUM",
      disposition: "UNVERIFIED", acceptance: "Search text vertically balanced" },
    { id: "UX-NEW", kind: "DETAIL", priority: "LOW", disposition: "RESOLVED",
      acceptance: "Escape clears search" },
  ],
  currentVisualObservations: [{
    findingId: "UX-OLD", observed: true, reportedBy: "USER",
    method: "SCREENSHOT_REVIEW", evidenceRef: "current.png",
    viewportId: "COMPACT", issueCode: "KPI_CROWDING",
  }],
});

test("existing high-priority observed issue outranks a newly implemented feature", () => {
  const r = decideRepairLoop(receipt(), baseline());
  assert.equal(r.outcome, "CONTINUE");
  assert.equal(r.action, "REPAIR_SOURCE");
  assert.equal(r.findingId, "UX-OLD");
  assert.equal(r.requireMatchedBeforeAfter, true);
});

test("unknown current appearance leads to verification, never speculative editing", () => {
  const x = receipt();
  x.currentVisualObservations = [];
  const r = decideRepairLoop(x, baseline());
  assert.equal(r.action, "VERIFY_CURRENT");
  assert.equal(r.findingId, "UX-OLD");
});

test("current manifest observation can independently drive repair", () => {
  const x = receipt();
  delete x.currentVisualObservations;
  const result = decideRepairLoop(x, baseline(), {
    manifest: { captures: [{
      viewportId: "COMPACT",
      renderInspection: { kpiBottomCrowding: true,
        findingRefs: { kpiBottomCrowding: "UX-OLD" } },
    }] },
  });
  assert.equal(result.action, "REPAIR_SOURCE");
  assert.equal(result.findingId, "UX-OLD");
});

test("after a source repair require independent same-viewport rendering before another edit", () => {
  const r = decideRepairLoop(receipt(), baseline(), { attempts: [{
    findingId: "UX-OLD", action: "REPAIR_SOURCE", result: "REVISE",
    sourceBefore: "abc", sourceAfter: "def",
    renderBefore: "initial.png", renderAfter: "",
  }] });
  assert.equal(r.action, "RERENDER");
  assert.equal(r.verifyAtSameViewport, true);
});

test("after rerender the loop returns to observed outstanding defect", () => {
  const attempts = [
    { findingId: "UX-OLD", action: "REPAIR_SOURCE", result: "REVISE",
      sourceBefore: "abc", sourceAfter: "def", renderBefore: "a", renderAfter: "" },
    { findingId: "UX-OLD", action: "RERENDER", result: "REVISE",
      sourceBefore: "def", sourceAfter: "def", renderBefore: "a", renderAfter: "b" },
  ];
  assert.equal(decideRepairLoop(receipt(), baseline(), { attempts }).action, "REPAIR_SOURCE");
});

test("stalled repeated attempts with identical source and rendered evidence stop honestly", () => {
  const attempts = ["one", "two"].map(() => ({
    findingId: "UX-OLD", action: "REPAIR_SOURCE", result: "REVISE",
    sourceBefore: "one", sourceAfter: "unchanged", renderBefore: "a", renderAfter: "same",
  }));
  const r = decideRepairLoop(receipt(), baseline(), { attempts });
  assert.equal(r.outcome, "STOP_STALLED");
  assert.equal(r.findingId, "UX-OLD");
});

test("documented real blocker lets the loop move on to another finding", () => {
  const x = receipt();
  x.persistentRepairActions = [{
    findingId: "UX-OLD", action: "BLOCKED", blocker: "Read-only source",
    nextStep: "Request authorized write access", evidenceRef: "logs/write-denied.txt",
  }];
  const r = decideRepairLoop(x, baseline());
  assert.equal(r.action, "VERIFY_CURRENT");
  assert.equal(r.findingId, "UX-SEARCH");
});

test("all blocked, with actual evidence, terminates PARTIAL rather than requesting the user to repeat command", () => {
  const x = receipt();
  x.persistentRepairActions = [
    { findingId: "UX-OLD", action: "BLOCKED", blocker: "Read-only source",
      nextStep: "Ask authorized owner", evidenceRef: "logs/write-denied.txt" },
    { findingId: "UX-SEARCH", action: "BLOCKED", blocker: "Target app inaccessible",
      nextStep: "Obtain authorized UI access", evidenceRef: "logs/ui-denied.txt" },
  ];
  const r = decideRepairLoop(x, baseline());
  assert.equal(r.outcome, "STOP_BLOCKED");
  assert.deepEqual(r.remaining, ["UX-OLD", "UX-SEARCH"]);
});

test("a claimed blocker without actual referenced evidence cannot stop an actionable repair", () => {
  const x = receipt();
  x.persistentRepairActions = [{
    findingId: "UX-OLD", action: "BLOCKED", blocker: "I don't feel like fixing this",
    nextStep: "Another time",
  }];
  assert.equal(decideRepairLoop(x, baseline()).action, "REPAIR_SOURCE");
});

test("UNVERIFIED with a valid current inability goes to the next actionable defect", () => {
  const x = receipt();
  x.currentVisualObservations = [];
  x.visualCarryoverReviews = [
    { findingId: "UX-OLD", status: "NOT_VERIFIED",
      reason: "Cannot access native viewport", evidenceRef: "logs/capture-denied.txt",
      nextStep: "Obtain authorized capture access" },
  ];
  const r = decideRepairLoop(x, baseline());
  assert.equal(r.action, "VERIFY_CURRENT");
  assert.equal(r.findingId, "UX-SEARCH");
});

test("valid COMPLETE is only recognized with independently verified final proof", () => {
  const x = receipt();
  x.iterationVerdict = "COMPLETE";
  x.findings = x.findings.map(f => ({ ...f, disposition: "RESOLVED" }));
  assert.equal(decideRepairLoop(x, baseline()).outcome, "CONTINUE");
  assert.equal(decideRepairLoop(x, baseline()).action, "RUN_GATES");
  assert.equal(decideRepairLoop(x, baseline(), {
    checkedProof: { completionEligible: true },
  }).outcome, "COMPLETE");
});

test("hard iteration budget prevents unbounded remediation", () => {
  const attempts = Array.from({ length: 8 }, (_, i) => ({
    findingId: "UX-OLD", action: "VERIFY_CURRENT", result: "REVISE",
    sourceAfter: "revision-" + i,
  }));
  assert.equal(decideRepairLoop(receipt(), baseline(), { attempts }).outcome, "STOP_LIMIT");
});

test("does not hijack read-only/restyle workflows or accept malformed histories", () => {
  const x = baseline();
  x.intent = "RESTYLE";
  assert.equal(decideRepairLoop(receipt(), x).outcome, "OUT_OF_SCOPE");
  assert.equal(decideRepairLoop(receipt(), baseline(), {
    attempts: [{ findingId: "UX-OLD", action: "DELETE_ALL_FILES", result: "PASS" }],
  }).outcome, "INVALID");
});

test("controller CLI produces an actionable JSON instruction from actual task files", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwa-repair-controller-"));
  try {
    const receiptPath = join(dir, "receipt.json");
    const baselinePath = join(dir, "baseline.json");
    writeFileSync(receiptPath, JSON.stringify(receipt()));
    writeFileSync(baselinePath, JSON.stringify(baseline()));
    const call = spawnSync(process.execPath, [cli,
      "--receipt", receiptPath, "--baseline", baselinePath], { encoding: "utf8" });
    assert.equal(call.status, 0, call.stderr);
    const result = JSON.parse(call.stdout);
    assert.equal(result.action, "REPAIR_SOURCE");
    assert.equal(result.findingId, "UX-OLD");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
