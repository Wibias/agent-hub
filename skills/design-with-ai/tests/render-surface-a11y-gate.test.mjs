import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSurfaceProbe } from "../scripts/render-surface-a11y-gate.mjs";

function probe(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "dwa/audit-surface-probe",
    elements: [],
    tablists: [],
    limitations: [],
    ...overrides,
  };
}

function checkbox(overrides = {}) {
  return {
    kind: "checkbox",
    name: "Minimize when watching",
    checked: false,
    disabled: false,
    visible: true,
    rect: { x: 0, y: 0, width: 18, height: 18 },
    style: {
      appearance: "none",
      borderTopWidth: "1px", borderRightWidth: "1px",
      borderBottomWidth: "1px", borderLeftWidth: "1px",
      borderTopColor: "rgb(60, 60, 60)", borderRightColor: "rgb(60, 60, 60)",
      borderBottomColor: "rgb(60, 60, 60)", borderLeftColor: "rgb(60, 60, 60)",
      backgroundImage: null,
    },
    ownBackground: { value: "rgb(16, 16, 16)" },
    adjacentBackground: { value: "rgb(32, 32, 32)", reliable: true },
    selected: false,
    rules: { base: [], hover: [], focus: [], selected: [] },
    ...overrides,
  };
}

function tab(name, selected, background, hoverBackground) {
  return {
    kind: "tab",
    name,
    selected,
    visible: true,
    rect: { x: 0, y: 0, width: 176, height: 40 },
    style: { appearance: "auto", backgroundImage: null },
    ownBackground: { value: background },
    adjacentBackground: { value: "rgb(24, 24, 24)", reliable: true },
    rules: {
      base: [{ selector: ".tab", declarations: { background: "rgba(0, 0, 0, 0)" } }],
      hover: [{ selector: ".tab:hover", declarations: { background: hoverBackground } }],
      selected: selected ? [{ selector: ".tab.is-active", declarations: { background } }] : [],
      focus: [],
    },
  };
}

function tablist(overrides = {}) {
  return {
    name: "Settings",
    orientation: null,
    layout: "vertical",
    tabCount: 8,
    tabbableCount: 8,
    selectedCount: 1,
    uniqueControls: 1,
    controlsTargetsExist: [true, true, true, true, true, true, true, true],
    rect: { x: 0, y: 0, width: 196, height: 637 },
    ...overrides,
  };
}

test("detects weak empty-control contrast, tablist model and selected-hover collapse", () => {
  const result = evaluateSurfaceProbe(probe({
    elements: [
      checkbox(),
      tab("Interface", true, "rgba(145, 71, 255, 0.22)", "rgba(255, 255, 255, 0.06)"),
      tab("Streaming", false, "rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0.06)"),
    ],
    tablists: [tablist()],
    keyboardEvidence: {
      source: "driven-pass",
      before: { active: "Interface", selected: "Interface" },
      afterArrow: { active: "Interface", selected: "Interface" },
      beforeTab: { active: "Interface", selected: "Interface" },
      afterTab: { active: "Streaming", selected: "Interface", inTablist: true },
    },
  }));

  assert.equal(result.verdict, "REVIEW_SURFACE_A11Y");
  const contrast = result.leads.find((lead) => lead.id === "A11Y-CONTROL-BOUNDARY-CONTRAST");
  assert.ok(contrast);
  assert.equal(contrast.measured.bestCue, 1.48);
  assert.equal(contrast.claim, "measured_below_threshold_not_a_conformance_finding");
  assert.match(contrast.appliesWhen, /required to identify/i);
  assert.doesNotMatch(contrast.claim, /violation/i);

  const tabs = result.leads.find((lead) => lead.id === "A11Y-TABLIST-MODEL");
  assert.ok(tabs);
  assert.deepEqual(tabs.failedChecks, [
    "aria-orientation-missing-for-vertical-layout",
    "roving-tabindex-not-implemented",
    "aria-controls-not-unique-and-valid-per-tab",
    "arrow-keys-do-not-move-focus",
    "tab-moves-focus-to-unselected-tab",
  ]);
  assert.ok(tabs.requiresInteractionChecks.some((check) => /ArrowDown/.test(check)));

  const state = result.leads.find((lead) => lead.id === "INT-STATE-IDENTITY-LOSS");
  assert.ok(state);
  assert.equal(state.observed.selectionCueLost, true);
  assert.match(state.adjudication, /another persistent cue/i);
});

test("automatic activation moves focus and selection without a keyboard lead", () => {
  const result = evaluateSurfaceProbe(probe({
    tablists: [tablist({ orientation: "vertical", tabbableCount: 1, uniqueControls: 8 })],
    keyboardEvidence: {
      source: "driven-pass",
      before: { active: "Interface", selected: "Interface" },
      afterArrow: { active: "Streaming", selected: "Streaming" },
      beforeTab: { active: "Streaming", selected: "Streaming" },
      afterTab: { active: "Theme", selected: "Streaming", inTablist: false },
    },
  }));
  assert.equal(result.verdict, "PASS_SURFACE_A11Y_LIMITED");
  assert.equal(result.leads.length, 0);
});

test("manual activation passes only when the activation key moves selection", () => {
  const base = {
    source: "driven-pass",
    before: { active: "Interface", selected: "Interface" },
    afterArrow: { active: "Streaming", selected: "Interface" },
    activation: {
      key: "Enter",
      before: { active: "Streaming", selected: "Interface" },
      after: { active: "Streaming", selected: "Streaming" },
    },
    beforeTab: { active: "Streaming", selected: "Streaming" },
    afterTab: { active: "Theme", selected: "Streaming", inTablist: false },
  };
  const result = evaluateSurfaceProbe(probe({
    tablists: [tablist({ orientation: "vertical", tabbableCount: 1, uniqueControls: 8 })],
    keyboardEvidence: base,
  }));
  assert.equal(result.verdict, "PASS_SURFACE_A11Y_LIMITED");

  const missingActivation = evaluateSurfaceProbe(probe({
    tablists: [tablist({ orientation: "vertical", tabbableCount: 1, uniqueControls: 8 })],
    keyboardEvidence: { ...base, activation: null },
  }));
  const lead = missingActivation.leads.find((item) => item.id === "A11Y-TABLIST-MODEL");
  assert.ok(lead);
  assert.ok(lead.failedChecks.includes("manual-activation-not-demonstrated"));
});

test("unchanged ArrowDown focus is a failure, not an automatic-activation pass", () => {
  const result = evaluateSurfaceProbe(probe({
    tablists: [tablist({ orientation: "vertical", tabbableCount: 1, uniqueControls: 8 })],
    keyboardEvidence: {
      source: "driven-pass",
      before: { active: "Interface", selected: "Interface" },
      afterArrow: { active: "Interface", selected: "Interface" },
    },
  }));
  const lead = result.leads.find((item) => item.id === "A11Y-TABLIST-MODEL");
  assert.ok(lead);
  assert.ok(lead.failedChecks.includes("arrow-keys-do-not-move-focus"));
  assert.equal(lead.observed.keyboard.activationMode, "unknown");
});

test("passes the limited gate when the measured states and model are sound", () => {
  const result = evaluateSurfaceProbe(probe({
    elements: [
      checkbox({
        style: {
          appearance: "none",
          borderTopWidth: "1px", borderRightWidth: "1px",
          borderBottomWidth: "1px", borderLeftWidth: "1px",
          borderTopColor: "rgb(120, 120, 120)", borderRightColor: "rgb(120, 120, 120)",
          borderBottomColor: "rgb(120, 120, 120)", borderLeftColor: "rgb(120, 120, 120)",
          backgroundImage: null,
        },
      }),
      tab("Interface", true, "rgba(145, 71, 255, 0.22)", "rgba(180, 140, 255, 0.34)"),
      tab("Streaming", false, "rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0.06)"),
    ],
    tablists: [tablist({
      orientation: "vertical",
      tabbableCount: 1,
      uniqueControls: 8,
    })],
  }));

  assert.equal(result.verdict, "PASS_SURFACE_A11Y_LIMITED");
  assert.equal(result.leads.length, 0);
  assert.match(result.claimPolicy, /Name a WCAG failure only when/i);
});

test("skips native controls and reports the state as not measured instead of passing it", () => {
  const result = evaluateSurfaceProbe(probe({
    elements: [checkbox({ style: { appearance: "auto", backgroundImage: null } })],
  }));
  assert.equal(result.verdict, "PASS_SURFACE_A11Y_LIMITED");
  assert.ok(result.observations.nonLeads.some((row) => row.id === "native-control-skipped"));
  assert.ok(result.requiredInteractionChecks.some((check) => /empty\/unchecked\/disabled/.test(check)));
});
