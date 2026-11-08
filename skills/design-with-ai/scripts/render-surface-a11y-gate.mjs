#!/usr/bin/env node
// Read-only analyzer for the generic surface probe. It emits review leads, not WCAG verdicts.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const round = (value) => Math.round(Number(value) * 100) / 100;
const clamp = (value) => Math.max(0, Math.min(255, value));

function parseColor(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text || text === "transparent" || text === "none") return { r: 0, g: 0, b: 0, a: 0 };
  const match = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (match) {
    return {
      r: clamp(Number(match[1])), g: clamp(Number(match[2])), b: clamp(Number(match[3])),
      a: match[4] === undefined ? 1 : clamp(Number(match[4])),
    };
  }
  const hex = text.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const raw = hex[1];
    const expanded = raw.length <= 4 ? raw.split("").map((ch) => ch + ch).join("") : raw;
    return {
      r: parseInt(expanded.slice(0, 2), 16),
      g: parseInt(expanded.slice(2, 4), 16),
      b: parseInt(expanded.slice(4, 6), 16),
      a: expanded.length >= 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function composite(foreground, background) {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: clamp((foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha),
    g: clamp((foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha),
    b: clamp((foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha),
    a: 1,
  };
}

function luminance(color) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(foregroundValue, backgroundValue) {
  const foreground = parseColor(foregroundValue);
  const background = parseColor(backgroundValue);
  if (!foreground || !background) return null;
  const opaqueBackground = background.a < 1 ? composite(background, { r: 255, g: 255, b: 255, a: 1 }) : background;
  const opaqueForeground = foreground.a < 1 ? composite(foreground, opaqueBackground) : foreground;
  const lighter = Math.max(luminance(opaqueForeground), luminance(opaqueBackground));
  const darker = Math.min(luminance(opaqueForeground), luminance(opaqueBackground));
  return round((lighter + 0.05) / (darker + 0.05));
}

function sameColor(first, second, tolerance = 2) {
  const a = parseColor(first);
  const b = parseColor(second);
  if (!a || !b) return false;
  return Math.abs(a.r - b.r) <= tolerance
    && Math.abs(a.g - b.g) <= tolerance
    && Math.abs(a.b - b.b) <= tolerance
    && Math.abs(a.a - b.a) <= 0.02;
}

function px(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function borderWidth(style) {
  return Math.max(
    px(style.borderTopWidth), px(style.borderRightWidth),
    px(style.borderBottomWidth), px(style.borderLeftWidth),
  );
}

function borderColors(style) {
  return [...new Set([
    style.borderTopColor, style.borderRightColor,
    style.borderBottomColor, style.borderLeftColor,
  ].filter(Boolean))];
}

function declarationColor(element, declarations, property) {
  if (!declarations) return null;
  return declarations[`${property}-color`] ?? declarations[property] ?? null;
}

function lastDeclaration(element, rules, property) {
  const list = Array.isArray(rules) ? rules : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const value = declarationColor(element, list[index].declarations, property);
    if (value && parseColor(value)) return value;
  }
  return null;
}

function controlCue(element) {
  const style = element.style ?? {};
  const adjacent = element.adjacentBackground?.value;
  if (!adjacent) return null;
  const custom = String(style.appearance ?? "").toLowerCase() === "none"
    || Boolean(style.backgroundImage);
  const width = borderWidth(style);
  const borderRatios = width > 0
    ? borderColors(style).map((color) => ({ color, ratio: contrast(color, adjacent) })).filter((row) => row.ratio !== null)
    : [];
  const fill = element.ownBackground?.value;
  const fillRatio = fill ? contrast(fill, adjacent) : null;
  const borderRatio = borderRatios.length
    ? Math.max(...borderRatios.map((row) => row.ratio)) : null;
  const cues = [borderRatio, fillRatio].filter((value) => value !== null);
  return {
    custom,
    adjacent,
    borderWidth: width,
    borderRatios,
    borderRatio,
    fill,
    fillRatio,
    bestCue: cues.length ? round(Math.max(...cues)) : null,
    reliable: element.adjacentBackground?.reliable !== false,
  };
}

function elementLabel(element) {
  return {
    kind: element.kind,
    name: element.name || null,
    text: element.text || null,
    checked: element.checked,
    disabled: element.disabled,
    rect: element.rect,
  };
}

function evaluateContrast(elements) {
  const grouped = new Map();
  const observations = [];
  for (const element of elements) {
    if (!["checkbox"].includes(element.kind)) continue;
    if (element.disabled) continue;
    const cue = controlCue(element);
    if (!cue) continue;
    if (!cue.custom) {
      observations.push({ id: "native-control-skipped", element: elementLabel(element) });
      continue;
    }
    if (element.checked) continue;
    if (element.style?.backgroundImage) {
      observations.push({ id: "unchecked-control-has-icon-cue", element: elementLabel(element) });
      continue;
    }
    if (cue.bestCue === null || !cue.reliable) {
      observations.push({ id: "control-contrast-not-measured", element: elementLabel(element), reason: cue.reliable ? "no-color-cue" : "approximate-background" });
      continue;
    }
    if (cue.bestCue >= 3) continue;
    const measured = {
        borderRatio: cue.borderRatio,
        fillRatio: cue.fillRatio,
        bestCue: cue.bestCue,
        adjacentBackground: cue.adjacent,
        threshold: 3,
    };
    const key = `${measured.bestCue}|${measured.adjacentBackground}|${cue.reliable ? "reliable" : "approximate"}`;
    const group = grouped.get(key) ?? { measured, reliable: cue.reliable, elements: [] };
    group.elements.push(elementLabel(element));
    grouped.set(key, group);
  }
  const leads = [...grouped.values()].map((group) => ({
    id: "A11Y-CONTROL-BOUNDARY-CONTRAST",
    severity: "P2",
    category: "accessibility",
    confidence: group.reliable ? "measured" : "approximate",
    element: group.elements[0],
    elements: group.elements,
    count: group.elements.length,
    measured: group.measured,
    criterion: "WCAG 2.2 SC 1.4.11 Non-text Contrast (3:1)",
    claim: "measured_below_threshold_not_a_conformance_finding",
    appliesWhen: "The control boundary or fill is visual information required to identify the control or its state.",
    adjudication: "Confirm whether another 3:1 cue (platform-native rendering, icon, label shape, or surrounding target) already identifies the empty control before calling this a conformance failure.",
    fixDirection: "Raise the boundary/fill contrast for the empty state without relying on the checked fill.",
  }));
  return { leads, observations };
}

function evaluateTablists(tablists, keyboardEvidence = null) {
  const leads = [];
  for (const list of tablists) {
    const failed = [];
    if (!list.orientation && list.layout === "vertical") failed.push("aria-orientation-missing-for-vertical-layout");
    if (list.orientation && list.orientation !== list.layout) failed.push("aria-orientation-does-not-match-layout");
    if (list.tabbableCount !== 1) failed.push("roving-tabindex-not-implemented");
    if (list.uniqueControls < list.tabCount || list.controlsTargetsExist.some((exists) => !exists)) {
      failed.push("aria-controls-not-unique-and-valid-per-tab");
    }
    if (list.selectedCount !== 1) failed.push("selected-tab-count-is-not-one");
    if (keyboardEvidence?.afterArrow
        && keyboardEvidence.afterArrow.active === keyboardEvidence.afterArrow.selected) {
      failed.push("arrow-keys-do-not-move-focus-or-selection");
    }
    if (keyboardEvidence?.afterTab
        && keyboardEvidence.afterTab.active !== keyboardEvidence.afterTab.selected) {
      failed.push("tab-moves-focus-to-unselected-tab");
    }
    if (!failed.length) continue;
    const structural = failed.some((id) => id !== "aria-orientation-missing-for-vertical-layout" && id !== "aria-orientation-does-not-match-layout");
    leads.push({
      id: "A11Y-TABLIST-MODEL",
      severity: structural ? "P2" : "P3",
      category: "accessibility",
      confidence: "static_attribute_and_layout",
      element: { kind: "tablist", name: list.name || null, rect: list.rect },
      failedChecks: failed,
      observed: {
        orientation: list.orientation,
        layout: list.layout,
        tabCount: list.tabCount,
        tabbableCount: list.tabbableCount,
        selectedCount: list.selectedCount,
        uniqueControls: list.uniqueControls,
        controlsTargetsExist: list.controlsTargetsExist,
        keyboardEvidence: keyboardEvidence ?? null,
      },
      claim: "static_attribute_and_layout_observation_not_full_aria_conformance",
      requiresInteractionChecks: [
        "ArrowDown/ArrowUp or ArrowLeft/ArrowRight move focus and selection according to orientation",
        "Home/End reach the first/last tab where the widget pattern requires them",
        "Tab exits the tablist instead of visiting the next unselected tab",
        "Panel changes are announced and focus/selection remain in sync",
      ],
      fixDirection: "Use a complete tabs primitive or model the rail as navigation with aria-current; make tab stops, controls, orientation, and keyboard behaviour agree.",
    });
  }
  return leads;
}

function evaluateStateIdentity(elements, tablists) {
  const leads = [];
  const tabs = elements.filter((element) => element.kind === "tab");
  for (const element of elements) {
    if (element.kind !== "tab") continue;
    if (!element.selected) continue;
    const selectedDefault = lastDeclaration(element, element.rules?.selected, "background")
      || lastDeclaration(element, element.rules?.base, "background")
      || element.ownBackground?.value;
    const selectedHover = lastDeclaration(element, element.rules?.hover, "background");
    if (!selectedDefault || !selectedHover) continue;
    if (sameColor(selectedDefault, selectedHover, 3)) continue;
    const neutral = tabs
      .filter((candidate) => candidate !== element && !candidate.selected)
      .map((candidate) => lastDeclaration(candidate, candidate.rules?.hover, "background"))
      .find((value) => value && parseColor(value));
    const collapses = neutral ? sameColor(selectedHover, neutral, 3) : false;
    if (!collapses) continue;
    const peer = tabs.find((candidate) => !candidate.selected);
    const persistentCue = Boolean(peer && (
      String(peer.style?.fontWeight ?? "") !== String(element.style?.fontWeight ?? "")
      || String(peer.style?.color ?? "") !== String(element.style?.color ?? "")
      || String(peer.style?.textDecorationLine ?? "") !== String(element.style?.textDecorationLine ?? "")
    ));
    leads.push({
      id: "INT-STATE-IDENTITY-LOSS",
      severity: persistentCue ? "P3" : "P2",
      category: "interaction",
      confidence: "cascade-heuristic",
      element: elementLabel(element),
      observed: {
        selectedDefault,
        selectedHover,
        neutralHover: neutral ?? null,
        selectionCueLost: collapses,
        persistentSelectionCue: persistentCue,
      },
      claim: "computed-cascade-observation-requires-hover-confirmation",
      adjudication: "Hovering the selected item replaces its selection treatment with the neutral hover treatment. Confirm in the rendered surface; if another persistent cue (weight, marker, underline) carries selection, keep the finding at the stated impact rather than calling it a WCAG failure.",
      fixDirection: "Keep the selected treatment distinct during hover, or make the selected/hover combination deliberately stronger.",
    });
  }
  return leads;
}

export function evaluateSurfaceProbe(probe) {
  if (!probe || probe.schemaVersion !== 1 || probe.kind !== "dwa/audit-surface-probe"
      || !Array.isArray(probe.elements) || !Array.isArray(probe.tablists)) {
    throw new TypeError("Unsupported or malformed audit-surface probe");
  }
  const contrast = evaluateContrast(probe.elements);
  const tablistLeads = evaluateTablists(probe.tablists, probe.keyboardEvidence ?? null);
  const stateLeads = evaluateStateIdentity(probe.elements, probe.tablists);
  const leads = [...contrast.leads, ...tablistLeads, ...stateLeads];
  return {
    schemaVersion: 1,
    kind: "dwa/render-surface-a11y-gate",
    verdict: leads.length ? "REVIEW_SURFACE_A11Y" : "PASS_SURFACE_A11Y_LIMITED",
    leads,
    observations: {
      controls: probe.elements.filter((element) => ["checkbox", "select", "text"].includes(element.kind)).length,
      tablists: probe.tablists.length,
      nonLeads: contrast.observations,
    },
    requiredInteractionChecks: [
      "Hover the selected/checked item and confirm the active treatment remains observable.",
      "Focus each interactive control and confirm a visible focus indicator.",
      "Drive the declared widget keyboard model, not just Tab order.",
      "Check the empty/unchecked/disabled states separately from the filled state.",
    ],
    claimPolicy: "Measurements and attribute observations are review leads. Name a WCAG failure only when the criterion applies to the actual rendered state, the measurement is against the real adjacent colors, and no alternative identifying cue or documented exception changes the conclusion.",
    limitations: probe.limitations ?? [],
  };
}

function parseArgs(argv) {
  const args = { probe: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") { args.json = true; continue; }
    if (token !== "--probe") throw new Error("Usage: render-surface-a11y-gate.mjs --probe <probe.json> [--json]");
    args.probe = argv[++index];
  }
  if (!args.probe) throw new Error("Usage: render-surface-a11y-gate.mjs --probe <probe.json> [--json]");
  return args;
}

function main() {
  let args = null;
  try {
    args = parseArgs(process.argv.slice(2));
    const path = resolve(args.probe);
    if (!existsSync(path)) throw new Error("Probe file not found");
    let probe;
    try { probe = JSON.parse(readFileSync(path, "utf8")); }
    catch { throw new Error("Probe is not valid JSON"); }
    const result = evaluateSurfaceProbe(probe);
    const output = { probe: path, ...result };
    if (args.json) process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    else {
      process.stdout.write("design-with-ai render-surface-a11y-gate\n");
      process.stdout.write("verdict: " + result.verdict + "\n");
      for (const lead of result.leads) process.stdout.write(`${lead.id} ${lead.severity} ${lead.element?.name ?? lead.element?.kind ?? ""}\n`);
      process.stdout.write(result.claimPolicy + "\n");
    }
    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args?.json) process.stdout.write(JSON.stringify({ error: message }, null, 2) + "\n");
    else process.stderr.write(message + "\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
