import assert from "node:assert/strict";
import test from "node:test";
import { desktopCoverageTargets, isDesktopCoverageTarget,
  planDesktopCoverage } from "../scripts/desktop-coverage-plan.mjs";

function v2() {
  return {
    schemaVersion: 2,
    viewports: [
      { id: "COMPACT", width: 960, height: 680, dpiPercent: 100 },
      { id: "MEDIUM", width: 1170, height: 753, dpiPercent: 100 },
      { id: "MAXIMIZED", width: 1850, height: 1000, dpiPercent: 100 },
      { id: "SCALED", width: 1440, height: 900, dpiPercent: 125 },
    ],
    captures: [],
    checks: [],
  };
}
const capture = (viewportId, state, withInspection = true) => ({
  viewportId, state, image: viewportId + "-" + state + ".png",
  imageSha256: "f".repeat(64),
  ...(withInspection ? { renderInspection: {
    method: "SCREENSHOT_REVIEW",
    evidenceRef: "captures/" + viewportId + "-" + state,
  } } : {}),
});
const block = target => ({
  action: "VERIFY_COVERAGE", target, result: "BLOCKED",
  blocker: "UIPI blocked external same-integrity automation",
  evidenceRef: "logs/native-ui-access-denied.txt",
  nextStep: "Obtain user-approved same-integrity test access",
});

test("coverage planner prioritizes compact then scaled and never calls a proof a screenshot", () => {
  const manifest = v2();
  manifest.captures = [
    capture("MEDIUM", "IDLE"), capture("MEDIUM", "SELECTED"),
    capture("MEDIUM", "FOCUS"), capture("MAXIMIZED", "IDLE"),
  ];
  const result = planDesktopCoverage(manifest);
  assert.equal(result.nextTarget, "COMPACT:IDLE");
  assert.ok(result.missing.includes("SCALED:IDLE"));
  assert.ok(result.missing.includes("COMPACT:SELECTED"));
  assert.ok(result.missing.includes("CHECK:NO_SELECTION_ACTION"));
  assert.equal(result.missing.includes("MEDIUM:SELECTED"), false);
  assert.equal(result.missing.includes("MAXIMIZED:IDLE"), false);
});

test("a capture with no actual review reference remains missing", () => {
  const manifest = v2();
  manifest.captures = [capture("COMPACT", "IDLE", false)];
  assert.equal(planDesktopCoverage(manifest).nextTarget, "COMPACT:IDLE");
});

test("justified stalled exclusion is honored; missing action check remains", () => {
  const manifest = v2();
  manifest.captures = ["COMPACT", "MEDIUM", "MAXIMIZED"].flatMap(id =>
    ["IDLE", "SELECTED", "FOCUS", "COLLECTING"].map(state => capture(id, state)))
    .concat(["IDLE", "FOCUS"].map(state => capture("SCALED", state)));
  manifest.stateExclusions = [{ state: "STALLED", reason: "No stalled runtime mode is supported" }];
  manifest.checks = ["SEGMENT_KEYBOARD", "CHART_HISTORY", "DPI_READABILITY"]
    .map(id => ({ id, result: "PASS", method: "TEST", evidenceRef: "tests/" + id }));
  const result = planDesktopCoverage(manifest);
  assert.deepEqual(result.missing, ["CHECK:NO_SELECTION_ACTION"]);
  assert.equal(result.nextTarget, "CHECK:NO_SELECTION_ACTION");
  manifest.checks.push({
    id: "NO_SELECTION_ACTION", result: "PASS", method: "TEST",
    evidenceRef: "tests/no-selection-action",
  });
  assert.equal(planDesktopCoverage(manifest).complete, true);
});

test("verified blocker skips only its own target, never unrelated native states", () => {
  const manifest = v2();
  const blocked = [block("COMPACT:IDLE"), block("SCALED:IDLE")];
  const result = planDesktopCoverage(manifest, blocked);
  assert.equal(result.nextTarget, "SCALED:FOCUS");
  assert.deepEqual(result.blocked, ["COMPACT:IDLE", "SCALED:IDLE"]);
  assert.ok(result.missing.includes("COMPACT:IDLE"));
  const incomplete = planDesktopCoverage(manifest, [
    { ...block("COMPACT:IDLE"), evidenceRef: "" },
  ]);
  assert.equal(incomplete.nextTarget, "COMPACT:IDLE");
});

test("legacy and absent manifests need a real v2 packet, not a fake COMPLETE", () => {
  assert.deepEqual(planDesktopCoverage(null).missing, ["MANIFEST:V2"]);
  assert.deepEqual(planDesktopCoverage({ schemaVersion: 1, captures: [] }).missing,
    ["MANIFEST:V2"]);
  assert.equal(planDesktopCoverage(null, [block("MANIFEST:V2")]).nextTarget, null);
  assert.equal(planDesktopCoverage(null, [block("MANIFEST:V2")]).complete, false);
});

test("only allowlisted coverage IDs may appear as executable agent targets", () => {
  for (const target of desktopCoverageTargets) assert.equal(isDesktopCoverageTarget(target), true);
  assert.equal(isDesktopCoverageTarget("C:/Users/private/secret.json"), false);
  assert.equal(isDesktopCoverageTarget("CHECK:TERMINATE_RANDOM_PROCESS"), false);
});
