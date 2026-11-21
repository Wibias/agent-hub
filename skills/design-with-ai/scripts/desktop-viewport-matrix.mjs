// Schema v2: multi-viewport, multi-state native UI evidence contract.
// Validates declared measurements and independent review metadata, NOT screenshot
// authenticity or the truthfulness of manual UI inspection.
const REQUIRED_VIEWPORTS = ["COMPACT", "MEDIUM", "MAXIMIZED", "SCALED"];
const BASE_STATES = ["IDLE", "SELECTED", "FOCUS", "COLLECTING"];
const ROLES = new Set(["SYSTEM", "DETAIL"]);
const ISSUE_FLAGS = [
  "duplicateCharts", "unexpectedHeaderFill", "clippedSupportingText",
  "unproductiveBlankSpace",
];
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const filled = x => typeof x === "string" && x.trim().length > 0;
const rect = x => Array.isArray(x) && x.length === 4 &&
  x.every(Number.isFinite) && x[2] > 0 && x[3] > 0;
const right = r => r[0] + r[2];
const bottom = r => r[1] + r[3];
const outside = (inner, outer) => inner[0] < outer[0] - 1 || inner[1] < outer[1] - 1 ||
  right(inner) > right(outer) + 1 || bottom(inner) > bottom(outer) + 1;
const overlaps = (a, b) => Math.min(right(a), right(b)) - Math.max(a[0], b[0]) > 1 &&
  Math.min(bottom(a), bottom(b)) - Math.max(a[1], b[1]) > 1;

/**
 * No hard-coded 1161/1440/1919 dimensions: the real supported client
 * sizes must be observed and adequately distinct. A full window/scale matrix
 * is conditional on claiming COMPLETE for a dense native monitor.
 */
export function validateDesktopViewportMatrix(manifest, receipt = null) {
  const problems = [];
  const fail = x => problems.push(x);
  const viewports = new Map();
  if (!Array.isArray(manifest?.viewports) || manifest.viewports.length !== 4) {
    fail("MULTI_VIEWPORT_REQUIRED: define COMPACT, MEDIUM, MAXIMIZED and SCALED viewports");
  }
  for (const [i, v] of (Array.isArray(manifest?.viewports) ? manifest.viewports : []).entries()) {
    if (!object(v) || !REQUIRED_VIEWPORTS.includes(v.id) || viewports.has(v.id)) {
      fail("viewports[" + i + "]: duplicate or unknown viewport ID"); continue;
    }
    viewports.set(v.id, v);
    if (!Number.isInteger(v.width) || v.width < 320 ||
        !Number.isInteger(v.height) || v.height < 240 ||
        !Number.isFinite(v.dpiPercent) || v.dpiPercent < 50 || v.dpiPercent > 400) {
      fail("viewports[" + i + "]: invalid measured dimensions/DPI");
    }
    if (v.mode !== (v.id === "MAXIMIZED" ? "MAXIMIZED" : "WINDOWED")) {
      fail("viewports[" + i + "]: incorrect WINDOWED/MAXIMIZED mode");
    }
  }
  for (const id of REQUIRED_VIEWPORTS) if (!viewports.has(id)) fail("Missing viewport " + id);
  const compact = viewports.get("COMPACT");
  const medium = viewports.get("MEDIUM");
  const maximized = viewports.get("MAXIMIZED");
  const scaled = viewports.get("SCALED");
  if (compact && medium && maximized && Number.isFinite(compact.width) &&
      Number.isFinite(medium.width) && Number.isFinite(maximized.width) &&
      (medium.width - compact.width < 96 || maximized.width - medium.width < 96)) {
    fail("VIEWPORT_MATRIX_NOT_DISTINCT: compact, medium, maximized widths need meaningful separation");
  }
  if (scaled && medium && scaled.dpiPercent === medium.dpiPercent) {
    fail("SCALED viewport must use a different Windows DPI scale than MEDIUM");
  }
  const seen = new Set();
  const captures = Array.isArray(manifest?.captures) ? manifest.captures : [];
  for (const [i, c] of captures.entries()) {
    if (!object(c)) continue; // standard capture validator reports malformed data
    const label = "captures[" + i + "]";
    const v = viewports.get(c.viewportId);
    if (!v) { fail(label + ": unknown viewportId"); continue; }
    const key = c.viewportId + ":" + c.state;
    if (seen.has(key)) fail("DUPLICATE_VIEWPORT_STATE " + key);
    seen.add(key);
    if (!object(c.viewport) || v.width !== c.viewport.width ||
        v.height !== c.viewport.height || v.dpiPercent !== c.viewport.dpiPercent) {
      fail(label + ": VIEWPORT_SIZE_MISMATCH " + c.viewportId);
    }
    if (!filled(c.image)) fail(label + ": missing capture image");
    // KPI supporting lines can be inside their metric cell yet cross the
    // *actual* section divider when the compact header is vertically squeezed.
    // Measure the divider and rendered supporting-text bounds separately.
    // Six device-independent px is the dense-monitor minimum legibility gap,
    // scaled to physical pixels. This is a conditional defect threshold, not
    // a generic universal typography or spacing token.
    if (!object(c.kpiStrip) || !rect(c.kpiStrip.rect) ||
        !Number.isFinite(c.kpiStrip.bottomDividerY) ||
        Math.abs(c.kpiStrip.bottomDividerY - bottom(c.kpiStrip.rect)) > 2) {
      fail("KPI_STRIP_MEASUREMENT_REQUIRED " + key);
    } else {
      const bottomDividerY = c.kpiStrip.bottomDividerY;
      if (outside(c.kpiStrip.rect, [0, 0, v.width, v.height])) {
        fail("KPI_STRIP_OUTSIDE_WINDOW " + key);
      }
      const minBottomClearance = Math.ceil(6 * v.dpiPercent / 100);
      if (!Array.isArray(c.kpiText) || c.kpiText.length === 0) {
        fail("KPI_SUPPORTING_TEXT_REQUIRED " + key);
      } else {
        const ids = new Set();
        for (const [j, item] of c.kpiText.entries()) {
          if (!object(item) || !filled(item.id) || !rect(item.cell) ||
              !rect(item.supportingText)) {
            fail("KPI_SUPPORTING_TEXT_MEASUREMENT_REQUIRED " + key + " [" + j + "]");
            continue;
          }
          if (ids.has(item.id)) fail("DUPLICATE_KPI_MEASUREMENT " + key + " " + item.id);
          ids.add(item.id);
          if (outside(item.supportingText, item.cell) ||
              outside(item.supportingText, c.kpiStrip.rect)) {
            fail("KPI_SUPPORTING_TEXT_OVERFLOW " + key + " " + item.id);
          }
          const clearance = bottomDividerY - bottom(item.supportingText);
          if (clearance < minBottomClearance) {
            fail("KPI_BOTTOM_CLEARANCE " + key + " " + item.id +
              ": measured " + clearance.toFixed(1) + " px, need >= " +
              minBottomClearance + " physical px");
          }
        }
      }
    }

    if (!Array.isArray(c.chartPanels)) fail(label + ": chartPanels geometry required");
    else {
      const roles = new Set(), panels = [];
      for (const [j, chart] of c.chartPanels.entries()) {
        if (!object(chart) || !ROLES.has(chart.role) || !filled(chart.id) ||
            !rect(chart.rect)) {
          fail(label + ": malformed chartPanels[" + j + "]"); continue;
        }
        if (roles.has(chart.role)) fail("DUPLICATE_CHART_ROLE " + key + " " + chart.role);
        roles.add(chart.role);
        panels.push(chart);
        const win = [0, 0, v.width, v.height];
        if (outside(chart.rect, win)) fail(label + ": chartPanel outside window");
        if (chart.role === "DETAIL" && rect(c.inspector?.rect) &&
            outside(chart.rect, c.inspector.rect)) fail(label + ": detail chart outside inspector");
        if (rect(c.processTable?.rect) && overlaps(chart.rect, c.processTable.rect)) {
          fail(label + ": chart panel overlaps process table");
        }
      }
      if (!roles.has("SYSTEM")) fail(label + ": missing SYSTEM chart");
      if (c.state === "SELECTED" && !roles.has("DETAIL")) {
        fail(label + ": selected inspector missing DETAIL chart");
      }
      for (let j = 0; j < panels.length; j++) for (let k = j + 1; k < panels.length; k++) {
        if (overlaps(panels[j].rect, panels[k].rect)) {
          fail(label + ": overlapping independent chart panels");
        }
      }
    }
    const inspection = c.renderInspection;
    if (!object(inspection) || !filled(inspection.evidenceRef) ||
        !["LIVE_RENDER", "SCREENSHOT_REVIEW"].includes(inspection.method)) {
      fail(label + ": real renderInspection evidence required");
    } else {
      for (const flag of ISSUE_FLAGS) {
        if (typeof inspection[flag] !== "boolean") {
          fail(label + ": missing inspected issue flag " + flag);
        } else if (inspection[flag] === true) {
          fail("RENDER_ANOMALY " + key + " " + flag);
          // Observed defects must become durable findings, even during a
          // verification-only run. The agent creates the receipt entry; the
          // established ledger sync appends FOUND and REVIEWED atomically.
          const id = inspection.findingRefs?.[flag];
          const finding = Array.isArray(receipt?.findings)
            ? receipt.findings.find(x => x?.id === id) : null;
          if (!filled(id) || !finding || !filled(finding.route) ||
              !filled(finding.symptom) || !filled(finding.acceptance) ||
              !filled(finding.evidenceRef) ||
              !["PERSISTS", "IMPROVED_BUT_OPEN", "REGRESSED", "UNVERIFIED", "DEFERRED"].includes(finding.disposition)) {
            fail("UNTRACKED_RENDER_FINDING " + key + " " + flag +
              ": add a stable OPEN finding to receipt and canonical ledger");
          } else if (!Array.isArray(manifest.reviewedFindingIds) ||
                     !manifest.reviewedFindingIds.includes(id)) {
            fail("UNREVIEWED_RENDER_FINDING " + key + " " + flag + " " + id);
          }
        }
      }
    }
    if (["IDLE", "SELECTED", "FOCUS", "COLLECTING"].includes(c.state) &&
        Number.isInteger(c.processTable?.totalRows) && c.processTable.totalRows >= 10 &&
        Number.isInteger(c.processTable?.visibleRows) && c.processTable.visibleRows < 3) {
      fail("TABLE_CRAMPED " + key + ": fewer than 3 fully visible process rows");
    }
    if (c.state === "IDLE" && c.inspector?.empty === true && rect(c.inspector.rect) &&
        c.inspector.rect[3] > v.height * 0.25) {
      fail("EMPTY_INSPECTOR_DOMINATES_TABLE " + key);
    }
    if (c.state === "SELECTED" && c.inspector?.empty === true) {
      fail("SELECTED_INSPECTOR_EMPTY " + key);
    }
  }
  for (const id of ["COMPACT", "MEDIUM", "MAXIMIZED"]) {
    for (const state of BASE_STATES) if (!seen.has(id + ":" + state)) {
      fail("MISSING_VIEWPORT_STATE " + id + ":" + state);
    }
  }
  for (const state of ["IDLE", "FOCUS"]) if (!seen.has("SCALED:" + state)) {
    fail("MISSING_VIEWPORT_STATE SCALED:" + state);
  }
  // A deliberately excluded stalled state is still reviewed by the base
  // validator; if a stalled state exists, one real viewport must show it.
  const stalledExcluded = Array.isArray(manifest.stateExclusions) &&
    manifest.stateExclusions.some(x => x?.state === "STALLED");
  if (!stalledExcluded && !captures.some(c => c?.state === "STALLED" &&
      ["COMPACT", "MEDIUM", "MAXIMIZED"].includes(c?.viewportId))) {
    fail("STALLED state needs a real viewport capture or justified exclusion");
  }
  const resolved = Array.isArray(receipt?.findings)
    ? receipt.findings.filter(x => x?.disposition === "RESOLVED" && filled(x.id)) : [];
  const reviews = Array.isArray(manifest?.findingViewportReviews) ? manifest.findingViewportReviews : [];
  if (!Array.isArray(manifest?.findingViewportReviews)) fail("findingViewportReviews required");
  const seenReviews = new Set();
  for (const [i, r] of reviews.entries()) {
    if (!object(r) || !filled(r.findingId) ||
        !["COMPACT", "MEDIUM", "MAXIMIZED"].includes(r.viewportId) ||
        !["RESOLVED", "NOT_APPLICABLE", "IMPROVED_BUT_OPEN", "PERSISTS", "NOT_VERIFIED"].includes(r.status) ||
        !filled(r.evidenceRef)) {
      fail("findingViewportReviews[" + i + "]: invalid review"); continue;
    }
    const id = r.findingId + ":" + r.viewportId;
    if (seenReviews.has(id)) fail("Duplicate finding viewport review " + id);
    seenReviews.add(id);
    if (r.status === "NOT_APPLICABLE" && !filled(r.reason)) {
      fail("findingViewportReviews[" + i + "]: NOT_APPLICABLE requires a reason");
    }
  }
  // A real anomaly cannot be marked "RESOLVED" at its observed viewport.
  // Cross-size findings remain in the same existing ledger and receipt.
  for (const c of captures) {
    const observed = c?.renderInspection;
    if (!object(observed)) continue;
    for (const flag of ISSUE_FLAGS) {
      if (observed[flag] !== true) continue;
      const id = observed.findingRefs?.[flag];
      if (!filled(id)) continue; // already reported as untracked above
      const review = reviews.find(r => r?.findingId === id && r?.viewportId === c.viewportId);
      if (!review || !["PERSISTS", "IMPROVED_BUT_OPEN", "NOT_VERIFIED"].includes(review.status)) {
        fail("UNRECONCILED_RENDER_FINDING " + id + ":" + c.viewportId + " " + flag);
      }
    }
  }
  for (const f of resolved) for (const viewportId of ["COMPACT", "MEDIUM", "MAXIMIZED"]) {
    const review = reviews.find(r => r?.findingId === f.id && r?.viewportId === viewportId);
    if (!review || !["RESOLVED", "NOT_APPLICABLE"].includes(review.status)) {
      fail("FINDING_NOT_RESOLVED_AT_VIEWPORT " + f.id + ":" + viewportId);
    }
  }
  return { valid: problems.length === 0, problems };
}
