// Targeted, bounded native desktop QA planning. This is a checklist of
// *missing evidence*, never an authentication of screenshots or UI behavior.
// The full desktop-render-evidence validator remains the final authority.
const baseStates = ["IDLE", "SELECTED", "FOCUS", "COLLECTING"];
const viewportIds = ["COMPACT", "MEDIUM", "MAXIMIZED", "SCALED"];
const checks = ["NO_SELECTION_ACTION", "SEGMENT_KEYBOARD", "CHART_HISTORY", "DPI_READABILITY"];
const states = [
  "COMPACT:IDLE", "SCALED:IDLE", "SCALED:FOCUS",
  ...baseStates.filter(s => s !== "IDLE").map(s => "COMPACT:" + s),
  ...baseStates.map(s => "MEDIUM:" + s),
  ...baseStates.map(s => "MAXIMIZED:" + s),
  "ANY:STALLED",
];
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const filled = x => typeof x === "string" && x.trim().length > 0;
const items = x => Array.isArray(x) ? x : [];
export const desktopCoverageTargets = Object.freeze([
  "MANIFEST:V2",
  ...viewportIds.map(x => "VIEWPORT:" + x),
  ...states,
  ...checks.map(x => "CHECK:" + x),
]);
const targetSet = new Set(desktopCoverageTargets);
export const isDesktopCoverageTarget = x => targetSet.has(x);

/**
 * The result is actionable only when an actual host agent executes it.
 * A name or image reference inside JSON does NOT establish a genuine capture.
 */
export function planDesktopCoverage(manifest, attempts = []) {
  const targets = [];
  if (!object(manifest) || manifest.schemaVersion !== 2) {
    targets.push("MANIFEST:V2");
  } else {
    const v = new Set(items(manifest.viewports).filter(x => object(x) &&
      viewportIds.includes(x.id) && Number.isInteger(x.width) &&
      Number.isInteger(x.height) && Number.isFinite(x.dpiPercent))
      .map(x => x.id));
    for (const id of viewportIds) if (!v.has(id)) targets.push("VIEWPORT:" + id);
    const c = items(manifest.captures).filter(x => object(x) &&
      filled(x.image) && filled(x.imageSha256) &&
      filled(x.renderInspection?.evidenceRef));
    const captured = new Set(c.map(x => x.viewportId + ":" + x.state));
    for (const state of states) {
      if (state === "ANY:STALLED") {
        const excluded = items(manifest.stateExclusions).some(x =>
          x?.state === "STALLED" && filled(x.reason));
        if (!excluded && !c.some(x => x.state === "STALLED" &&
            ["COMPACT", "MEDIUM", "MAXIMIZED"].includes(x.viewportId))) {
          targets.push(state);
        }
      } else if (!captured.has(state)) targets.push(state);
    }
    const passed = new Set(items(manifest.checks).filter(x => object(x) &&
      x.result === "PASS" && ["TEST", "RUNTIME"].includes(x.method) &&
      filled(x.evidenceRef)).map(x => x.id));
    for (const id of checks) if (!passed.has(id)) targets.push("CHECK:" + id);
  }
  const blocked = [], pending = [];
  for (const target of targets) {
    // Only a concrete, attributable failed attempt may defer coverage.
    // A plain 'blocked' string in a receipt is not enough.
    const refusal = attempts.filter(x => x?.action === "VERIFY_COVERAGE" &&
      x.target === target && x.result === "BLOCKED" &&
      filled(x.blocker) && filled(x.evidenceRef) && filled(x.nextStep)).at(-1);
    if (refusal) blocked.push(target);
    else pending.push(target);
  }
  return { nextTarget: pending[0] ?? null, missing: targets, blocked, pending,
    complete: targets.length === 0, limitation:
      "Manifest metadata is not screenshot, interaction, DPI or process-action authentication" };
}
