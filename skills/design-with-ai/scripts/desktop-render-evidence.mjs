#!/usr/bin/env node
// Conditional, inspectable native desktop evidence. Does not authenticate UI
// screenshots, self-reported measurements, human approval, or runtime behavior.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const filled = x => typeof x === "string" && x.trim().length > 0;
const hex = x => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
const statesRequired = ["IDLE", "SELECTED", "FOCUS", "STALLED"];
const checksRequired = ["NO_SELECTION_ACTION", "SEGMENT_KEYBOARD", "CHART_HISTORY", "DPI_READABILITY"];
const knownStates = new Set(statesRequired);
const knownChecks = new Set(checksRequired);

function rect(r) {
  return Array.isArray(r) && r.length === 4 &&
    r.every(Number.isFinite) && r[2] > 0 && r[3] > 0;
}
function outside(inner, outer) {
  const e = 1; // measured-pixel rounding allowance, not an aesthetic threshold
  return inner[0] < outer[0] - e || inner[1] < outer[1] - e ||
    inner[0] + inner[2] > outer[0] + outer[2] + e ||
    inner[1] + inner[3] > outer[1] + outer[3] + e;
}
function expectedWindowRect(viewport) { return [0, 0, viewport.width, viewport.height]; }

export function validateDesktopRenderEvidence(manifest, receipt = null) {
  const problems = [];
  const fail = message => problems.push(message);
  if (!object(manifest) || manifest.schemaVersion !== 1 ||
      manifest.surfaceKind !== "DENSE_DESKTOP_MONITOR") {
    return { valid: false, problems: ["Expected a version 1 DENSE_DESKTOP_MONITOR render manifest"] };
  }
  if (!hex(manifest.candidateSourceSha256)) fail("Missing versioned candidateSourceSha256");
  if (!Array.isArray(manifest.captures) || manifest.captures.length === 0) {
    fail("captures: at least one real final-candidate screenshot is required");
  }
  const seenStates = new Set();
  for (const [i, c] of (Array.isArray(manifest.captures) ? manifest.captures : []).entries()) {
    const label = "captures[" + i + "]";
    if (!object(c)) { fail(label + ": invalid capture"); continue; }
    if (!knownStates.has(c.state) || seenStates.has(c.state)) {
      fail(label + ": unknown or duplicate state");
    }
    seenStates.add(c.state);
    if (!filled(c.image) || isAbsolute(c.image) ||
        c.image.replaceAll("\\", "/").split("/").includes("..")) {
      fail(label + ": expected relative screenshot image path within manifest folder");
    }
    if (!hex(c.imageSha256)) fail(label + ": missing screenshot SHA-256");
    if (!filled(c.capturedAt) || !Number.isFinite(Date.parse(c.capturedAt))) {
      fail(label + ": missing capture time");
    }
    if (!object(c.viewport) ||
        !Number.isInteger(c.viewport.width) || c.viewport.width < 320 ||
        !Number.isInteger(c.viewport.height) || c.viewport.height < 240 ||
        !Number.isFinite(c.viewport.dpiPercent) || c.viewport.dpiPercent < 50 ||
        c.viewport.dpiPercent > 400) {
      fail(label + ": invalid physical window size or DPI");
      continue;
    }
    const windowRect = expectedWindowRect(c.viewport);
    for (const [key, field] of [["kpiText", "cell"], ["tableHeaders", "cell"]]) {
      if (!Array.isArray(c[key]) || c[key].length === 0) {
        fail(label + "." + key + ": measured visible content required");
        continue;
      }
      for (const [j, item] of c[key].entries()) {
        if (!object(item) || !filled(item.id) || !rect(item[field]) || !rect(item.text)) {
          fail(label + "." + key + "[" + j + "]: id and measured cell/text rectangles required");
          continue;
        }
        if (outside(item[field], windowRect)) fail(label + "." + key + "[" + j + "]: cell outside window");
        if (outside(item.text, item[field])) {
          fail(label + "." + key + "[" + j + "]: CLIPPED_TEXT " + item.id);
        }
      }
    }
    const table = c.processTable;
    const inspector = c.inspector;
    if (!object(table) || !rect(table.rect) ||
        !Number.isInteger(table.visibleRows) || table.visibleRows < 0 ||
        !Number.isInteger(table.totalRows) || table.totalRows < table.visibleRows) {
      fail(label + ": processTable requires measured bounds and visible/total rows");
    } else if (outside(table.rect, windowRect)) fail(label + ": processTable outside window");
    if (!object(inspector) || !rect(inspector.rect) || typeof inspector.empty !== "boolean") {
      fail(label + ": inspector requires bounds and explicit empty state");
    } else if (outside(inspector.rect, windowRect)) fail(label + ": inspector outside window");
    if (c.state === "SELECTED" && object(table) && object(inspector) &&
        Number.isInteger(table.visibleRows) && Number.isInteger(table.totalRows) &&
        rect(inspector.rect) && table.totalRows >= 10 && table.visibleRows <= 2 &&
        inspector.rect[3] >= 0.25 * c.viewport.height) {
      fail(label + ": TABLE_CRAMPED - selected inspector leaves at most two visible process rows");
    }
    if (c.state === "IDLE" && inspector?.empty === true && object(table) &&
        rect(table.rect) && rect(inspector.rect) && table.totalRows >= 10 &&
        table.visibleRows <= 2 && inspector.rect[3] >= 0.25 * c.viewport.height) {
      fail(label + ": EMPTY_INSPECTOR_DOMINATES_TABLE");
    }
    if (c.state === "IDLE" && !object(c.chart)) fail(label + ": chart sampling evidence required");
    if (object(c.chart)) {
      const g = c.chart;
      if (!Number.isInteger(g.sampleCount) || g.sampleCount < 0 ||
          !Number.isFinite(g.collectionIntervalSec) || g.collectionIntervalSec <= 0 ||
          !Number.isFinite(g.historyLabelSec) || g.historyLabelSec < 0 ||
          typeof g.missingAsZero !== "boolean") {
        fail(label + ": chart sampling metadata is incomplete");
      } else {
        if (g.missingAsZero) fail(label + ": absent samples rendered as zero");
        const actualHistory = Math.max(0, g.sampleCount - 1) * g.collectionIntervalSec;
        if (g.historyLabelSec > actualHistory + g.collectionIntervalSec * 0.5) {
          fail(label + ": chart label claims more history than collected samples");
        }
      }
    }
  }
  const excluded = new Set();
  if (manifest.stateExclusions !== undefined) {
    if (!Array.isArray(manifest.stateExclusions)) fail("stateExclusions must be an array");
    else for (const exclusion of manifest.stateExclusions) {
      if (!object(exclusion) || exclusion.state !== "STALLED" ||
          !filled(exclusion.reason) || excluded.has(exclusion.state)) {
        fail("Only a justified, unique STALLED exclusion is supported");
      } else excluded.add(exclusion.state);
    }
  }
  for (const state of statesRequired) if (!seenStates.has(state) && !excluded.has(state)) {
    fail("Missing final render state " + state);
  }
  if (!Array.isArray(manifest.checks)) fail("checks: interaction and freshness results required");
  const seenChecks = new Set();
  for (const check of Array.isArray(manifest.checks) ? manifest.checks : []) {
    if (!object(check) || !knownChecks.has(check.id) || seenChecks.has(check.id)) {
      fail("Invalid or duplicate runtime check"); continue;
    }
    seenChecks.add(check.id);
    if (check.result !== "PASS" || !["TEST", "RUNTIME"].includes(check.method) ||
        !filled(check.evidenceRef)) {
      fail("Check " + check.id + " requires PASS with TEST/RUNTIME evidence");
    }
  }
  for (const id of checksRequired) {
    if (!seenChecks.has(id) && !(id === "CHART_HISTORY" && excluded.has("STALLED"))) {
      fail("Missing runtime check " + id);
    }
  }
  if (!Array.isArray(manifest.reviewedFindingIds) ||
      new Set(manifest.reviewedFindingIds).size !== manifest.reviewedFindingIds.length ||
      manifest.reviewedFindingIds.some(id => !filled(id))) {
    fail("reviewedFindingIds must be unique finding IDs");
  }
  if (Array.isArray(receipt?.findings) && Array.isArray(manifest.reviewedFindingIds)) {
    for (const finding of receipt.findings) {
      if (filled(finding?.id) && !manifest.reviewedFindingIds.includes(finding.id)) {
        fail("Visual review omitted carried finding " + finding.id);
      }
    }
  }
  return {
    valid: problems.length === 0,
    problems,
    states: [...seenStates],
    limitation: "Only checks supplied geometry/data and screenshot identity. It cannot independently measure a native UI, prove screenshots are genuine, authenticate a tested action, or replace human rendered review.",
  };
}

// Files are restricted to the screenshot manifest's directory. No symlinks,
// recursion, arbitrary input paths, or reading unrelated project secrets.
export function snapshotDesktopCaptureFiles(manifestPath) {
  const dir = dirname(resolve(manifestPath));
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const problems = [];
  const files = [];
  const seen = new Set();
  for (const capture of Array.isArray(manifest.captures) ? manifest.captures : []) {
    const name = capture?.image;
    if (!filled(name) || isAbsolute(name) || name.replaceAll("\\", "/").split("/").includes("..") ||
        !/^\.(?:png|jpe?g|webp)$/i.test(extname(name))) {
      problems.push("Invalid screenshot relative path");
      continue;
    }
    const full = resolve(dir, name);
    const rel = relative(dir, full);
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || seen.has(full)) {
      problems.push("Duplicate or out-of-scope screenshot file"); continue;
    }
    seen.add(full);
    try {
      const st = lstatSync(full);
      if (!st.isFile() || st.isSymbolicLink() || st.size < 64 || st.size > 16 * 1024 * 1024) {
        problems.push("Unsafe or invalid screenshot file"); continue;
      }
      const sha256 = createHash("sha256").update(readFileSync(full)).digest("hex");
      if (sha256 !== capture.imageSha256) problems.push("Screenshot hash mismatch: " + capture.state);
      files.push({ state: capture.state, sha256, size: st.size });
    } catch {
      problems.push("Screenshot unavailable: " + capture.state);
    }
  }
  return { valid: problems.length === 0, problems, files };
}
