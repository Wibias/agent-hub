import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import {
  validateDesktopRenderEvidence, snapshotDesktopCaptureFiles,
} from "../scripts/desktop-render-evidence.mjs";
import { snapshotProjectSource, snapshotRootedSource } from "../scripts/project-source-snapshot.mjs";
import { runGate, checkProof } from "../scripts/run-iteration-gate.mjs";
import { validateIterationReceipt } from "../scripts/verify-iteration-receipt.mjs";

const clone = data => JSON.parse(JSON.stringify(data));
// A fixed PNG fixture, not a claimed PCGuardian capture.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLWxAAAAABJRU5ErkJggg==", "base64");
const sha = buffer => createHash("sha256").update(buffer).digest("hex");

function baseCapture(state) {
  return {
    state, image: state.toLowerCase() + ".png", imageSha256: sha(png),
    capturedAt: "2026-11-21T20:30:00.000Z",
    viewport: { width: 1166, height: 791, dpiPercent: 100 },
    kpiText: [{ id: "used-memory", cell: [18, 65, 148, 90], text: [24, 78, 131, 69] }],
    tableHeaders: [{ id: "committed-memory", cell: [205, 338, 120, 25], text: [212, 344, 105, 13] }],
    processTable: { rect: [0, 366, 1166, 169], visibleRows: 6, totalRows: 50 },
    inspector: { rect: [0, 541, 1166, 172], empty: state === "IDLE" },
    ...(state === "IDLE" ? { chart: {
      sampleCount: 3, collectionIntervalSec: 60, historyLabelSec: 120,
      missingAsZero: false,
    } } : {}),
  };
}
function manifest(source = "a".repeat(64)) {
  return {
    schemaVersion: 1, surfaceKind: "DENSE_DESKTOP_MONITOR",
    candidateSourceSha256: source,
    captures: ["IDLE", "SELECTED", "FOCUS", "STALLED"].map(baseCapture),
    checks: ["NO_SELECTION_ACTION", "SEGMENT_KEYBOARD", "CHART_HISTORY", "DPI_READABILITY"].map(id => ({
      id, result: "PASS", method: "TEST", evidenceRef: "tests/native-" + id,
    })),
    reviewedFindingIds: ["UX-TABLE"],
  };
}

// v2 fixtures are synthetic, valid PNG byte streams with the declared
// physical dimensions. They are NEVER evidence of a real PCGuardian render.
function makePng(width, height) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
  const chunk = (type, data) => {
    const t = Buffer.from(type, "ascii");
    const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
    let crc = 0xffffffff;
    for (const b of Buffer.concat([t, data])) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([n, t, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; // RGBA 8-bit
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    sig, chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function matrixManifest(source = "a".repeat(64)) {
  const viewports = [
    { id: "COMPACT", mode: "WINDOWED", width: 1166, height: 791, dpiPercent: 100 },
    { id: "MEDIUM", mode: "WINDOWED", width: 1440, height: 900, dpiPercent: 100 },
    { id: "MAXIMIZED", mode: "MAXIMIZED", width: 1919, height: 1033, dpiPercent: 100 },
    { id: "SCALED", mode: "WINDOWED", width: 1440, height: 900, dpiPercent: 150 },
  ];
  const variants = [
    ...["IDLE", "SELECTED", "FOCUS", "COLLECTING", "STALLED"].map(s => ["COMPACT", s]),
    ...["IDLE", "SELECTED", "FOCUS", "COLLECTING"].map(s => ["MEDIUM", s]),
    ...["IDLE", "SELECTED", "FOCUS", "COLLECTING"].map(s => ["MAXIMIZED", s]),
    ...["IDLE", "FOCUS"].map(s => ["SCALED", s]),
  ];
  const captures = variants.map(([id, state]) => {
    const v = viewports.find(v => v.id === id), c = baseCapture(state);
    c.viewportId = id;
    c.viewport = { width: v.width, height: v.height, dpiPercent: v.dpiPercent };
    c.kpiStrip = { rect: [0, 60, v.width, 97], bottomDividerY: 157 };
    c.kpiText[0].supportingText = [24, 128, 131, 16];
    c.image = id === "COMPACT" ? state.toLowerCase() + ".png"
      : (id + "-" + state).toLowerCase() + ".png";
    const listHeight = Math.min(260, v.height - 565);
    const inspectorY = 350 + listHeight + 6;
    const inspectorHeight = Math.min(175, v.height - inspectorY - 45);
    c.processTable = { rect: [0, 350, v.width, listHeight],
      visibleRows: Math.floor((listHeight - 24) / 24), totalRows: 50 };
    c.inspector = { rect: [0, inspectorY, v.width, inspectorHeight], empty: state === "IDLE" };
    c.chartPanels = [{ id: "system-chart", role: "SYSTEM", rect: [18, 184, v.width - 36, 96] }];
    if (state === "SELECTED") c.chartPanels.push({
      id: "detail-chart", role: "DETAIL", rect:
        [Math.round(v.width * 0.52), inspectorY + 12, Math.round(v.width * 0.4), 84],
    });
    if (state === "COLLECTING") c.chart = {
      sampleCount: 1, collectionIntervalSec: 60,
      historyLabelSec: 0, missingAsZero: false,
    };
    c.renderInspection = {
      method: "SCREENSHOT_REVIEW", evidenceRef: "review:" + c.image,
      duplicateCharts: false, unexpectedHeaderFill: false,
      clippedSupportingText: false, unproductiveBlankSpace: false,
    };
    return c;
  });
  return { ...manifest(source), schemaVersion: 2, viewports, captures,
    findingViewportReviews: [] };
}

function receipt() {
  return {
    schemaVersion: 1, surfaceKind: "DENSE_DESKTOP_MONITOR",
    iterationVerdict: "COMPLETE",
    gates: { render: "PASS", functional: "PASS" },
    scope: [{ route: "PCGuardian/MainForm", task: "Inspect and manage processes",
      coverage: "INSPECTED", semantics: { applicable: false, reason: "Task-specific native action checks in desktop evidence" } }],
    findings: [{ id: "UX-TABLE", route: "PCGuardian/MainForm",
      symptom: "Table crowded by process inspector",
      acceptance: "Table readable when a process is selected",
      decision: "KEEP", disposition: "KEEP_JUSTIFIED",
      after: { ref: "selected.png" }, justification: "Inspected final native layout" }],
    openCarryover: [],
  };
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-desktop-render-"));
  const repo = join(root, "PCGuardian");
  mkdirSync(join(repo, "UI"), { recursive: true });
  const source = join(repo, "UI", "MainForm.cs");
  writeFileSync(source, "public class MainForm { public int Version = 1; }\n");
  const git = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const candidate = snapshotProjectSource(repo);
  assert.ok(candidate?.sha256);
  assert.ok(candidate.fileCount >= 1, "C# source must participate in the fingerprint");
  const m = matrixManifest(snapshotRootedSource(repo).sha256);
  const pngCache = new Map();
  for (const c of m.captures) {
    const id = c.viewport.width + "x" + c.viewport.height;
    if (!pngCache.has(id)) pngCache.set(id, makePng(c.viewport.width, c.viewport.height));
    const bytes = pngCache.get(id);
    c.imageSha256 = sha(bytes);
    writeFileSync(join(root, c.image), bytes);
  }
  const manifestPath = join(root, "desktop-render.json");
  const receiptPath = join(root, "receipt.json");
  const proof = join(root, "proof.json");
  const save = () => {
    writeFileSync(manifestPath, JSON.stringify(m));
    writeFileSync(receiptPath, JSON.stringify(receipt()));
  };
  save();
  try { return fn({ root, repo, source, m, manifestPath, receiptPath, proof, save }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function allProblems(data, receiptData = receipt()) {
  return validateDesktopRenderEvidence(data, receiptData).problems.join("; ");
}

test("legacy single-window capture cannot certify COMPLETE, but remains valid PARTIAL evidence", () => {
  assert.match(allProblems(manifest()), /MULTI_VIEWPORT_REQUIRED/);
  assert.equal(validateDesktopRenderEvidence(manifest(), {
    ...receipt(), iterationVerdict: "PARTIAL",
  }).valid, true);
});
test("complete matrix evidence is structurally accepted without asserting screenshot authenticity", () => {
  assert.deepEqual(validateDesktopRenderEvidence(matrixManifest(), receipt()).problems, []);
});
test("measured truncated KPI or table header text prevents a complete verdict", () => {
  const a = manifest();
  a.captures[0].kpiText[0].text[3] = 100;
  assert.match(allProblems(a), /CLIPPED_TEXT used-memory/);
  const b = manifest();
  b.captures[1].tableHeaders[0].text[2] = 148;
  assert.match(allProblems(b), /CLIPPED_TEXT committed-memory/);
});
test("selected inspector squeezing the table to two rows is an E2E blocker", () => {
  const a = manifest();
  const selected = a.captures.find(x => x.state === "SELECTED");
  selected.processTable.visibleRows = 2;
  selected.processTable.rect = [0, 367, 1166, 48];
  selected.inspector.rect = [0, 426, 1166, 230];
  assert.match(allProblems(a), /TABLE_CRAMPED/);
});
test("empty inspector may not dominate a two-row idle process list", () => {
  const a = manifest();
  const idle = a.captures.find(x => x.state === "IDLE");
  idle.processTable.visibleRows = 2;
  idle.processTable.rect = [0, 367, 1166, 48];
  idle.inspector.rect = [0, 426, 1166, 230];
  assert.match(allProblems(a), /EMPTY_INSPECTOR_DOMINATES_TABLE/);
});
test("chart must not fake missing samples or label history that was never recorded", () => {
  const a = manifest();
  a.captures[0].chart.sampleCount = 1;
  a.captures[0].chart.historyLabelSec = 180;
  assert.match(allProblems(a), /more history than collected/);
  a.captures[0].chart.missingAsZero = true;
  assert.match(allProblems(a), /absent samples rendered as zero/);
});
test("missing selected/focus/stalled screenshot or keyboard runtime proof blocks complete", () => {
  const a = manifest();
  a.captures = a.captures.filter(x => x.state !== "FOCUS");
  a.checks = a.checks.filter(x => x.id !== "SEGMENT_KEYBOARD");
  assert.match(allProblems(a), /Missing final render state FOCUS/);
  assert.match(allProblems(a), /Missing runtime check SEGMENT_KEYBOARD/);
});
test("documented inapplicable stalled state is allowed, but action check remains required", () => {
  const a = manifest();
  a.captures = a.captures.filter(x => x.state !== "STALLED");
  a.stateExclusions = [{ state: "STALLED", reason: "Target has no stalled state" }];
  assert.equal(validateDesktopRenderEvidence(a, { ...receipt(), iterationVerdict: "PARTIAL" }).valid, true);
  a.checks = a.checks.filter(x => x.id !== "NO_SELECTION_ACTION");
  assert.match(allProblems(a), /Missing runtime check NO_SELECTION_ACTION/);
});
test("original findings cannot disappear from the final visual review", () => {
  const a = manifest();
  a.reviewedFindingIds = [];
  assert.match(allProblems(a), /Visual review omitted carried finding UX-TABLE/);
});
test("a native desktop receipt cannot claim COMPLETE without final evidence", () => {
  assert.match(validateIterationReceipt(receipt()).problems.join("; "), /requires final render evidence/);
  const partial = receipt();
  partial.iterationVerdict = "PARTIAL";
  partial.verdictReason = "Native screenshot capture unavailable";
  assert.equal(validateIterationReceipt(partial).valid, true);
});
test("real screenshot bytes are bound, path traversal is refused and later edits are detected", () => fixture(f => {
  assert.equal(snapshotDesktopCaptureFiles(f.manifestPath).valid, true);
  writeFileSync(join(f.root, "idle.png"), Buffer.from(readFileSync(join(f.root, "idle.png"))).fill(0x41, 35, 36));
  assert.match(snapshotDesktopCaptureFiles(f.manifestPath).problems.join("; "), /hash mismatch/);
  f.m.captures[0].image = "../private.png";
  f.save();
  assert.match(snapshotDesktopCaptureFiles(f.manifestPath).problems.join("; "), /Invalid screenshot relative path/);
}));
test("full iteration proof binds final screenshots and actual C# source, then detects changes", () => fixture(f => {
  const options = { receipt: f.receiptPath, renderEvidence: f.manifestPath,
    sourceRoot: f.repo, proof: f.proof, workspaceCwd: f.root };
  const ran = runGate(options);
  assert.equal(ran.exitCode, 0, JSON.stringify(ran.proof.result?.problems));
  const checked = checkProof({ ...options, checkProof: f.proof });
  assert.equal(checked.valid, true, checked.issues.join("; "));
  assert.equal(checked.completionEligible, true);
  writeFileSync(f.source, "public class MainForm { public int Version = 2; }\n");
  const stale = checkProof({ ...options, checkProof: f.proof });
  assert.equal(stale.valid, false);
  assert.ok(stale.issueCodes.includes("WORKTREE_CHANGED"));
  assert.ok(stale.issueCodes.includes("RENDER_SOURCE_STALE"));
}));
test("last-minute screenshot change invalidates the old proof even without code changes", () => fixture(f => {
  const options = { receipt: f.receiptPath, renderEvidence: f.manifestPath,
    sourceRoot: f.repo, proof: f.proof, workspaceCwd: f.root };
  assert.equal(runGate(options).exitCode, 0);
  writeFileSync(join(f.root, "selected.png"), Buffer.from(readFileSync(join(f.root, "selected.png"))).fill(0x42, 35, 36));
  const stale = checkProof({ ...options, checkProof: f.proof });
  assert.equal(stale.valid, false);
  assert.ok(stale.issueCodes.includes("RENDER_ARTIFACT_CHANGED"));
}));
test("geometry failure never becomes COMPLETE just because the formal receipt claims PASS", () => fixture(f => {
  const selected = f.m.captures.find(x => x.state === "SELECTED");
  selected.processTable.visibleRows = 2;
  selected.inspector.rect = [0, 426, 1166, 230];
  f.save();
  const ran = runGate({ receipt: f.receiptPath, renderEvidence: f.manifestPath,
    sourceRoot: f.repo, proof: f.proof, workspaceCwd: f.root });
  assert.equal(ran.exitCode, 1);
  assert.equal(ran.proof.result.valid, false);
  assert.equal(checkProof({ receipt: f.receiptPath, renderEvidence: f.manifestPath,
    sourceRoot: f.repo, checkProof: f.proof, workspaceCwd: f.root }).completionEligible, false);
}));
test("legacy non-desktop iteration stays valid without desktop evidence", () => {
  const a = receipt();
  delete a.surfaceKind;
  assert.equal(validateIterationReceipt(a).valid, true);
});

test("a renamed placeholder is not accepted as screenshot evidence", () => fixture(f => {
  writeFileSync(join(f.root, "idle.png"), Buffer.alloc(100, 65));
  assert.match(snapshotDesktopCaptureFiles(f.manifestPath).problems.join("; "), /does not match its image format/);
}));

test("native COMPLETE cannot run from an unrelated directory without an explicit source root", () => fixture(f => {
  assert.throws(() => runGate({ receipt: f.receiptPath, renderEvidence: f.manifestPath,
    proof: f.proof, workspaceCwd: f.root }), /requires explicit --source-root/);
}));
test("a different source-root path invalidates proof replay", () => fixture(f => {
  const args = { receipt: f.receiptPath, renderEvidence: f.manifestPath, sourceRoot: f.repo,
    proof: f.proof, workspaceCwd: f.root };
  assert.equal(runGate(args).exitCode, 0);
  assert.equal(checkProof({ ...args, checkProof: f.proof }).sourceBound, true);
  const replay = checkProof({ ...args, sourceRoot: f.root, checkProof: f.proof });
  assert.equal(replay.valid, false);
  assert.ok(replay.issueCodes.includes("PATH_MISMATCH"));
}));

test("maximized screenshot cannot hide two SYSTEM chart panels", () => {
  const m = matrixManifest();
  const big = m.captures.find(c => c.viewportId === "MAXIMIZED" && c.state === "IDLE");
  big.chartPanels.push({ id: "system-chart-duplicate", role: "SYSTEM",
    rect: [big.viewport.width / 2, 184, big.viewport.width / 2 - 20, 96] });
  assert.match(allProblems(m), /DUPLICATE_CHART_ROLE MAXIMIZED:IDLE SYSTEM/);
});
test("white or unexpected header fill in maximized mode blocks visual acceptance", () => {
  const m = matrixManifest();
  m.captures.find(c => c.viewportId === "MAXIMIZED" && c.state === "IDLE")
    .renderInspection.unexpectedHeaderFill = true;
  assert.match(allProblems(m), /RENDER_ANOMALY MAXIMIZED:IDLE unexpectedHeaderFill/);
});
test("compact selected table with two visible rows blocks acceptance even if medium and maximized fit", () => {
  const m = matrixManifest();
  m.captures.find(c => c.viewportId === "COMPACT" && c.state === "SELECTED")
    .processTable.visibleRows = 2;
  assert.match(allProblems(m), /TABLE_CRAMPED COMPACT:SELECTED/);
});
test("each size must include idle, selection, focus and collection state", () => {
  const m = matrixManifest();
  m.captures = m.captures.filter(c => !(c.viewportId === "MEDIUM" && c.state === "FOCUS"));
  assert.match(allProblems(m), /MISSING_VIEWPORT_STATE MEDIUM:FOCUS/);
  const n = matrixManifest();
  n.captures = n.captures.filter(c => !(c.viewportId === "MAXIMIZED" && c.state === "COLLECTING"));
  assert.match(allProblems(n), /MISSING_VIEWPORT_STATE MAXIMIZED:COLLECTING/);
});
test("DPI comparison is a distinct real scaling profile, not the same 100 percent screenshot", () => {
  const m = matrixManifest();
  m.viewports.find(v => v.id === "SCALED").dpiPercent = 100;
  for (const c of m.captures.filter(c => c.viewportId === "SCALED")) c.viewport.dpiPercent = 100;
  assert.match(allProblems(m), /SCALED viewport must use a different Windows DPI/);
});
test("viewport metadata cannot relabel compact screenshot as maximized", () => {
  const m = matrixManifest();
  m.captures.find(c => c.viewportId === "MAXIMIZED" && c.state === "SELECTED")
    .viewport.width = 1166;
  assert.match(allProblems(m), /VIEWPORT_SIZE_MISMATCH MAXIMIZED/);
});
test("a resolved finding requires matching rendered evidence at every normal window size", () => {
  const r = receipt();
  r.findings[0].disposition = "RESOLVED";
  const m = matrixManifest();
  m.findingViewportReviews = [{ findingId: "UX-TABLE", viewportId: "COMPACT",
    status: "RESOLVED", evidenceRef: "render:compact-after" }];
  assert.match(allProblems(m, r), /FINDING_NOT_RESOLVED_AT_VIEWPORT UX-TABLE:MEDIUM/);
  assert.match(allProblems(m, r), /FINDING_NOT_RESOLVED_AT_VIEWPORT UX-TABLE:MAXIMIZED/);
  m.findingViewportReviews.push(
    { findingId: "UX-TABLE", viewportId: "MEDIUM", status: "RESOLVED", evidenceRef: "render:medium-after" },
    { findingId: "UX-TABLE", viewportId: "MAXIMIZED", status: "RESOLVED", evidenceRef: "render:max-after" },
  );
  assert.equal(validateDesktopRenderEvidence(m, r).valid, true);
});
test("missing measured chart geometry or visual review prevents Complete", () => {
  const m = matrixManifest();
  delete m.captures[0].chartPanels;
  delete m.captures[1].renderInspection;
  assert.match(allProblems(m), /chartPanels geometry required/);
  assert.match(allProblems(m), /real renderInspection evidence required/);
});
test("a mismatched screenshot pixel size is rejected even with valid sha256", () => fixture(f => {
  const capture = f.m.captures.find(x => x.viewportId === "MAXIMIZED" && x.state === "IDLE");
  const pngBytes = makePng(1166, 791);
  writeFileSync(join(f.root, capture.image), pngBytes);
  capture.imageSha256 = sha(pngBytes);
  f.save();
  assert.match(snapshotDesktopCaptureFiles(f.manifestPath).problems.join("; "),
    /VIEWPORT_IMAGE_DIMENSION_MISMATCH/);
}));
test("an expanded inspector cannot overlap the process list", () => {
  const m = matrixManifest();
  const selected = m.captures.find(c => c.viewportId === "COMPACT" && c.state === "SELECTED");
  selected.chartPanels.find(c => c.role === "DETAIL").rect = selected.processTable.rect;
  assert.match(allProblems(m), /chart panel overlaps process table/);
});

test("compact KPI supporting text touching divider fails even when maximized view remains clear", () => {
  const m = matrixManifest();
  const compact = m.captures.find(c => c.viewportId === "COMPACT" && c.state === "IDLE");
  compact.kpiStrip = { rect: [0, 60, compact.viewport.width, 84], bottomDividerY: 144 };
  compact.kpiText[0].supportingText = [24, 128, 131, 16];
  assert.match(allProblems(m), /KPI_BOTTOM_CLEARANCE COMPACT:IDLE used-memory/);
  const max = m.captures.find(c => c.viewportId === "MAXIMIZED" && c.state === "IDLE");
  assert.equal(max.kpiStrip.bottomDividerY - (max.kpiText[0].supportingText[1] +
    max.kpiText[0].supportingText[3]), 13);
});
test("KPI divider and supporting text cannot be silently omitted for a v2 render", () => {
  const m = matrixManifest();
  delete m.captures[0].kpiStrip;
  delete m.captures[1].kpiText[0].supportingText;
  assert.match(allProblems(m), /KPI_STRIP_MEASUREMENT_REQUIRED/);
  assert.match(allProblems(m), /KPI_SUPPORTING_TEXT_MEASUREMENT_REQUIRED/);
});
test("a supporting line outside a metric cell is rejected regardless of divider clearance", () => {
  const m = matrixManifest();
  const compact = m.captures.find(c => c.viewportId === "COMPACT" && c.state === "IDLE");
  compact.kpiText[0].supportingText = [24, 100, 250, 16];
  assert.match(allProblems(m), /KPI_SUPPORTING_TEXT_OVERFLOW COMPACT:IDLE used-memory/);
});
test("DPI-specific physical bottom clearance is enforced for scaled native windows", () => {
  const m = matrixManifest();
  const scaled = m.captures.find(c => c.viewportId === "SCALED" && c.state === "IDLE");
  scaled.kpiText[0].supportingText = [24, 133, 131, 16]; // 8 px to divider, needs 9 at 150%
  assert.match(allProblems(m), /KPI_BOTTOM_CLEARANCE SCALED:IDLE used-memory/);
});

test("visible PCGuardian white header anomaly cannot be silently omitted from the findings receipt", () => {
  const m = matrixManifest();
  const c = m.captures.find(c => c.viewportId === "COMPACT" && c.state === "IDLE");
  c.renderInspection.unexpectedHeaderFill = true;
  const errors = allProblems(m);
  assert.match(errors, /RENDER_ANOMALY COMPACT:IDLE unexpectedHeaderFill/);
  assert.match(errors, /UNTRACKED_RENDER_FINDING COMPACT:IDLE unexpectedHeaderFill/);
});
test("reconciled rendering anomaly must retain a stable OPEN finding and same-viewport review", () => {
  const m = matrixManifest();
  const r = receipt();
  const c = m.captures.find(c => c.viewportId === "COMPACT" && c.state === "IDLE");
  c.renderInspection.unexpectedHeaderFill = true;
  c.renderInspection.findingRefs = { unexpectedHeaderFill: "PCG-17" };
  const item = {
    id: "PCG-17", route: "PCGuardian/MainForm", kind: "VISUAL", priority: "MEDIUM",
    symptom: "Unexpected white area next to Since header at compact size",
    acceptance: "Header and scrollbar paint correctly at compact and maximized sizes",
    evidenceRef: "renders/pcg17-compact.png", decision: "Investigate WinForms paint/scrollbar",
    disposition: "PERSISTS", reason: "Render confirmed; root cause remains unverified",
  };
  r.findings.push(item);
  r.openCarryover.push(item.id);
  m.reviewedFindingIds.push(item.id);
  let err = allProblems(m, r);
  assert.match(err, /UNRECONCILED_RENDER_FINDING PCG-17:COMPACT unexpectedHeaderFill/);
  m.findingViewportReviews.push({
    findingId: item.id, viewportId: "COMPACT", status: "PERSISTS",
    evidenceRef: "renders/pcg17-compact.png",
  });
  err = allProblems(m, r);
  assert.match(err, /RENDER_ANOMALY/);
  assert.doesNotMatch(err, /UNTRACKED_RENDER_FINDING|UNRECONCILED_RENDER_FINDING/);
  r.findings.at(-1).disposition = "RESOLVED";
  assert.match(allProblems(m, r), /UNTRACKED_RENDER_FINDING/);
});
test("anomaly cannot be linked to an invented or omitted prior finding", () => {
  const m = matrixManifest();
  const c = m.captures.find(c => c.viewportId === "MAXIMIZED" && c.state === "IDLE");
  c.renderInspection.duplicateCharts = true;
  c.renderInspection.findingRefs = { duplicateCharts: "PCG-FAKE" };
  m.reviewedFindingIds.push("PCG-FAKE");
  m.findingViewportReviews.push({ findingId: "PCG-FAKE", viewportId: "MAXIMIZED",
    status: "PERSISTS", evidenceRef: "renders/fake.png" });
  assert.match(allProblems(m), /UNTRACKED_RENDER_FINDING MAXIMIZED:IDLE duplicateCharts/);
});
