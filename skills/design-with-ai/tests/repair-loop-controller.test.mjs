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

test("an observed defect mislabeled UNVERIFIED requires repair, not another capture loop", () => {
  const x = receipt();
  x.findings[0].disposition = "UNVERIFIED";
  const next = decideRepairLoop(x, baseline());
  assert.equal(next.action, "REPAIR_SOURCE");
  assert.equal(next.findingId, "UX-OLD");
  assert.equal(next.reconcileDisposition, true);
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

test("a locally observed exporter concurrency failure becomes a targeted source repair, not a generic blocker", () => {
  const x = receipt();
  x.findings.push({
    id: "UX-EXPORT-RACE", kind: "WORKFLOW", priority: "HIGH",
    disposition: "PERSISTS",
    acceptance: "Repeat capture without modifying a live collection during iteration",
  });
  x.currentRuntimeFailures = [{
    findingId: "UX-EXPORT-RACE", observed: true,
    evidenceRef: "logs/collection-concurrency-stacktrace.txt",
    errorCode: "COLLECTION_MODIFIED_DURING_ENUMERATION",
  }];
  x.findings[0].disposition = "RESOLVED";
  x.findings[1].disposition = "RESOLVED";
  const result = decideRepairLoop(x, baseline());
  assert.equal(result.action, "REPAIR_SOURCE");
  assert.equal(result.findingId, "UX-EXPORT-RACE");
});

test("an incomplete desktop manifest selects actual missing evidence rather than repeating RUN_GATES", () => {
  const x = receipt();
  x.findings = x.findings.map(f => ({ ...f, disposition: "RESOLVED" }));
  x.currentVisualObservations = [];
  const result = decideRepairLoop(x, baseline());
  assert.equal(result.outcome, "CONTINUE");
  assert.equal(result.action, "VERIFY_COVERAGE");
  assert.equal(result.findingId, null);
  assert.equal(result.target, "MANIFEST:V2");
});

test("partial native matrix targets COMPACT and real DPI after MEDIUM and MAXIMIZED captures", () => {
  const x = receipt();
  x.findings = x.findings.map(f => ({ ...f, disposition: "RESOLVED" }));
  x.currentVisualObservations = [];
  const manifest = {
    schemaVersion: 2, viewports: [
      { id: "MEDIUM", width: 1170, height: 753, dpiPercent: 100 },
      { id: "MAXIMIZED", width: 1790, height: 1000, dpiPercent: 100 },
    ],
    captures: ["IDLE", "SELECTED", "FOCUS"].map(state => ({
      viewportId: "MEDIUM", state, image: state + ".png",
      imageSha256: "a".repeat(64), renderInspection: { evidenceRef: "render/" + state },
    })).concat([{ viewportId: "MAXIMIZED", state: "IDLE", image: "max-idle.png",
      imageSha256: "b".repeat(64), renderInspection: { evidenceRef: "render/max-idle" } }]),
    checks: [{ id: "CHART_HISTORY", result: "PASS", method: "TEST",
      evidenceRef: "tests/chart-history.txt" }],
  };
  const result = decideRepairLoop(x, baseline(), {
    manifest, checkedProof: { valid: true, completionEligible: false, verdict: "PARTIAL" },
  });
  assert.equal(result.outcome, "CONTINUE");
  assert.equal(result.action, "VERIFY_COVERAGE");
  assert.equal(result.target, "VIEWPORT:COMPACT");
  assert.ok(result.missingCoverage.includes("VIEWPORT:SCALED"));
  assert.ok(result.missingCoverage.includes("COMPACT:IDLE"));
  assert.ok(result.missingCoverage.includes("SCALED:FOCUS"));
  assert.ok(result.missingCoverage.includes("CHECK:NO_SELECTION_ACTION"));
  assert.ok(!result.missingCoverage.includes("MEDIUM:SELECTED"));
  assert.ok(!result.missingCoverage.includes("MAXIMIZED:IDLE"));
});

test("a real documented coverage blocker advances to the next missing state", () => {
  const x = receipt();
  x.findings = x.findings.map(f => ({ ...f, disposition: "RESOLVED" }));
  x.currentVisualObservations = [];
  const result = decideRepairLoop(x, baseline(), { attempts: [{
    action: "VERIFY_COVERAGE", target: "MANIFEST:V2", result: "BLOCKED",
    blocker: "Windows capture tool is denied by UIPI", evidenceRef: "logs/capture-denied.txt",
    nextStep: "Use a separately authorized same-integrity tester",
  }] });
  assert.equal(result.outcome, "STOP_BLOCKED");
  assert.deepEqual(result.blockedCoverage, ["MANIFEST:V2"]);
});

test("a bare blocked claim cannot skip missing desktop evidence", () => {
  const x = receipt();
  x.findings = x.findings.map(f => ({ ...f, disposition: "RESOLVED" }));
  x.currentVisualObservations = [];
  const result = decideRepairLoop(x, baseline(), { attempts: [{
    action: "VERIFY_COVERAGE", target: "MANIFEST:V2", result: "BLOCKED",
    blocker: "No access", nextStep: "retry",
  }] });
  assert.equal(result.action, "VERIFY_COVERAGE");
  assert.equal(result.target, "MANIFEST:V2");
});

test("a fully enumerated matrix with a valid PARTIAL proof requires acceptance review, not another proof", () => {
  const x = receipt();
  x.findings = x.findings.map(f => ({ ...f, disposition: "RESOLVED" }));
  x.currentVisualObservations = [];
  const manifest = { schemaVersion: 2,
    viewports: ["COMPACT", "MEDIUM", "MAXIMIZED", "SCALED"].map(id => ({
      id, width: 1170, height: 753, dpiPercent: id === "SCALED" ? 125 : 100,
    })),
    captures: ["COMPACT", "MEDIUM", "MAXIMIZED"].flatMap(viewportId =>
      ["IDLE", "SELECTED", "FOCUS", "COLLECTING"].map(state => ({
        viewportId, state, image: viewportId + state + ".png",
        imageSha256: "a".repeat(64), renderInspection: { evidenceRef: "render/" + viewportId + state },
      }))).concat(["IDLE", "FOCUS"].map(state => ({
        viewportId: "SCALED", state, image: "scaled-" + state + ".png",
        imageSha256: "a".repeat(64), renderInspection: { evidenceRef: "render/" + state },
      })), [{ viewportId: "MEDIUM", state: "STALLED", image: "stalled.png",
        imageSha256: "a".repeat(64), renderInspection: { evidenceRef: "render/stalled" } }]),
    checks: ["NO_SELECTION_ACTION", "SEGMENT_KEYBOARD", "CHART_HISTORY", "DPI_READABILITY"].map(id => ({
      id, result: "PASS", method: "TEST", evidenceRef: "tests/" + id,
    })),
  };
  const partial = { valid: true, completionEligible: false, verdict: "PARTIAL" };
  const result = decideRepairLoop(x, baseline(), { manifest, checkedProof: partial });
  assert.equal(result.action, "VERIFY_ACCEPTANCE");
  assert.equal(result.target, "ACCEPTANCE:FINAL");
  const stalled = decideRepairLoop(x, baseline(), {
    manifest, checkedProof: partial, attempts: [{
      action: "VERIFY_ACCEPTANCE", target: "ACCEPTANCE:FINAL", result: "PASS",
    }],
  });
  assert.equal(stalled.outcome, "STOP_STALLED");
});

test("a source repair still requires a real rerender if the finding was prematurely closed", () => {
  const x = receipt();
  x.findings = x.findings.map(f => ({ ...f, disposition: "RESOLVED" }));
  x.currentVisualObservations = [];
  const result = decideRepairLoop(x, baseline(), {
    attempts: [{
      findingId: "UX-OLD", action: "REPAIR_SOURCE", result: "PASS",
      sourceBefore: "old-sha", sourceAfter: "new-sha",
      renderBefore: "renders/old.png", renderAfter: "",
    }],
  });
  assert.equal(result.action, "RERENDER");
  assert.equal(result.findingId, "UX-OLD");
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
