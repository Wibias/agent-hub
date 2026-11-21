import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  validateDesktopRenderEvidence, snapshotDesktopCaptureFiles,
} from "../scripts/desktop-render-evidence.mjs";
import { snapshotProjectSource } from "../scripts/project-source-snapshot.mjs";
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
  const m = manifest(candidate.sha256);
  for (const c of m.captures) writeFileSync(join(root, c.image), png);
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

test("complete matched PCGuardian evidence is structurally accepted, without asserting screenshot authenticity", () => {
  assert.deepEqual(validateDesktopRenderEvidence(manifest(), receipt()).problems, []);
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
  assert.equal(validateDesktopRenderEvidence(a, receipt()).valid, true);
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
  writeFileSync(join(f.root, "idle.png"), Buffer.from(png).fill(0x41, 35, 36));
  assert.match(snapshotDesktopCaptureFiles(f.manifestPath).problems.join("; "), /hash mismatch/);
  f.m.captures[0].image = "../private.png";
  f.save();
  assert.match(snapshotDesktopCaptureFiles(f.manifestPath).problems.join("; "), /Invalid screenshot relative path/);
}));
test("full iteration proof binds final screenshots and actual C# source, then detects changes", () => fixture(f => {
  const options = { receipt: f.receiptPath, renderEvidence: f.manifestPath,
    proof: f.proof, workspaceCwd: f.repo };
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
    proof: f.proof, workspaceCwd: f.repo };
  assert.equal(runGate(options).exitCode, 0);
  writeFileSync(join(f.root, "selected.png"), Buffer.from(png).fill(0x42, 35, 36));
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
    proof: f.proof, workspaceCwd: f.repo });
  assert.equal(ran.exitCode, 1);
  assert.equal(ran.proof.result.valid, false);
  assert.equal(checkProof({ receipt: f.receiptPath, renderEvidence: f.manifestPath,
    checkProof: f.proof, workspaceCwd: f.repo }).completionEligible, false);
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
