import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { snapshotProjectSource } from "../scripts/project-source-snapshot.mjs";
import { runGate, checkProof } from "../scripts/run-iteration-gate.mjs";
import { decideStop } from "../scripts/codex-stop-gate.mjs";
import {
  initializeLedger, importFindings, readLedger, makeLedgerBaseline, syncLedger,
} from "../scripts/findings-ledger.mjs";

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8", shell: false });
  assert.equal(r.status, 0, r.stderr);
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "design-proof-freshness-"));
  const repo = join(root, "product");
  const ui = join(repo, "ui");
  const source = join(ui, "index.html");
  const ledger = join(repo, ".design-with-ai", "findings-ledger.json");
  mkdirSync(ui, { recursive: true });
  mkdirSync(join(repo, ".design-with-ai"));
  git("init", "-q", repo);
  writeFileSync(source, '<html style="font-family:Inter"></html>\n');
  git("-C", repo, "add", "ui/index.html");
  initializeLedger(ledger);
  const finding = {
    id: "UX-EXTERNAL", route: "/jobs", kind: "WORKFLOW", priority: "HIGH",
    symptom: "Live publish cannot be verified", acceptance: "Verify real provider result",
    evidenceRef: "tests/simulated-publish.txt",
  };
  importFindings(ledger, { findings: [finding] });
  const baseline = join(root, "baseline.json");
  const receipt = join(root, "receipt.json");
  const proof = join(root, "proof.json");
  const frozen = makeLedgerBaseline(readLedger(ledger),
    { scope: ["/jobs"], runId: "freshness-fixture-run" });
  writeFileSync(baseline, JSON.stringify(frozen));
  const data = {
    schemaVersion: 1, requiresPriorBaseline: true, requiresFindingsLedger: true,
    iterationVerdict: "PARTIAL", verdictReason: "Real TikTok token unavailable",
    changeSummary: { kind: "NO_CHANGE", rationale: "Known external dependency", addressedFindingIds: [] },
    scope: [{ route: "/jobs", task: "Inspect publishing",
      coverage: "INSPECTED", semantics: { applicable: false, reason: "No live publishing attempt" } }],
    findings: [{
      ...finding, decision: "Carry forward external publish verification",
      disposition: "PERSISTS", reason: "Real publishing remains unverified",
    }],
    openCarryover: [finding.id],
  };
  writeFileSync(receipt, JSON.stringify(data));
  syncLedger(ledger, frozen, data);
  const event = {
    hook_event_name: "Stop", cwd: repo, turn_id: "turn-1",
    last_assistant_message: "PARTIAL: live TikTok publishing remains open.",
  };
  const report = {
    userBoundary: true, modifying: true, explicit: true,
    userPrompt: "", readsSkill: true,
    gateCommands: [{ receipt, baseline, ledger, proof }],
  };
  const options = { receipt, baseline, ledger, proof, workspaceCwd: repo };
  try { return fn({ root, repo, ui, source, ledger, baseline, receipt, proof, event, report, options }); }
  finally { rmSync(root, { force: true, recursive: true }); }
}

test("source snapshot changes after a CSS/HTML repair and includes untracked TS code", () => fixture(f => {
  const before = snapshotProjectSource(f.repo);
  writeFileSync(f.source, '<html style="font-family:Segoe UI"></html>\n');
  const after = snapshotProjectSource(f.repo);
  assert.notEqual(before.sha256, after.sha256);
  assert.ok(after.fileCount >= 1);
  const untracked = join(f.ui, "App.tsx");
  writeFileSync(untracked, "export default function App() { return null; }\n");
  const withNewSource = snapshotProjectSource(f.repo);
  assert.notEqual(after.sha256, withNewSource.sha256);
  writeFileSync(untracked, "export default function App() { return <main />; }\n");
  assert.notEqual(withNewSource.sha256, snapshotProjectSource(f.repo).sha256);
}));

test("green PARTIAL -> font edit -> old proof blocked -> new proof accepted", () => fixture(f => {
  assert.equal(runGate(f.options).exitCode, 0);
  const first = checkProof({ ...f.options, checkProof: f.proof });
  assert.equal(first.valid, true, first.issues.join("; "));
  assert.equal(first.completionEligible, false);
  assert.equal(decideStop(f.event, f.report).status, "VERIFIED_INCOMPLETE");

  writeFileSync(f.source, '<html style="font-family:Segoe UI"></html>\n');
  const stale = checkProof({ ...f.options, checkProof: f.proof });
  assert.equal(stale.valid, false);
  assert.ok(stale.issueCodes.includes("WORKTREE_CHANGED"));
  const blocked = decideStop(f.event, f.report);
  assert.equal(blocked.decision, "block");
  assert.equal(blocked.proofStatus, "WORKTREE_CHANGED");
  assert.match(blocked.reason, /WORKTREE_CHANGED/);
  const exhausted = decideStop({ ...f.event, stop_hook_active: true }, f.report);
  assert.equal(exhausted.status, "RETRY_LIMIT_NOT_VERIFIED");
  assert.match(exhausted.systemMessage, /WORKTREE_CHANGED/);

  const latest = join(f.root, "proof-after-final-edit.json");
  assert.equal(runGate({ ...f.options, proof: latest }).exitCode, 0);
  const latestReport = { ...f.report,
    gateCommands: [...f.report.gateCommands, { ...f.report.gateCommands[0], proof: latest }] };
  assert.equal(decideStop(f.event, latestReport).status, "VERIFIED_INCOMPLETE");
}));

test("receipt, baseline and ledger changes have distinct error codes", () => {
  for (const kind of ["receipt", "baseline", "ledger"]) {
    fixture(f => {
      assert.equal(runGate(f.options).exitCode, 0);
      const file = f[kind];
      const original = readFileSync(file, "utf8");
      writeFileSync(file, original + "\n");
      const checked = checkProof({ ...f.options, checkProof: f.proof });
      assert.equal(checked.valid, false);
      assert.ok(checked.issueCodes.includes(kind.toUpperCase() + "_CHANGED"),
        kind + ": " + checked.issues.join("; "));
      const blocked = decideStop(f.event, f.report);
      assert.equal(blocked.proofStatus, kind.toUpperCase() + "_CHANGED");
    });
  }
});

test("legacy Git proof without a workspace snapshot is not accepted", () => fixture(f => {
  assert.equal(runGate(f.options).exitCode, 0);
  const evidence = JSON.parse(readFileSync(f.proof, "utf8"));
  delete evidence.projectSource;
  writeFileSync(f.proof, JSON.stringify(evidence));
  const checked = checkProof({ ...f.options, checkProof: f.proof });
  assert.equal(checked.valid, false);
  assert.ok(checked.issueCodes.includes("WORKTREE_UNBOUND"));
}));

test("old proof reports PROOF_TOO_OLD even with unchanged artifacts", () => fixture(f => {
  assert.equal(runGate(f.options).exitCode, 0);
  const report = { ...f.report, promptAt: "2099-01-01T00:00:00.000Z" };
  assert.equal(checkProof({ ...f.options, checkProof: f.proof }).valid, true);
  assert.equal(decideStop(f.event, report).proofStatus, "PROOF_TOO_OLD");
}));

test("generated screenshot under artifacts does not invalidate UI source proof", () => fixture(f => {
  assert.equal(runGate(f.options).exitCode, 0);
  mkdirSync(join(f.repo, "artifacts"));
  writeFileSync(join(f.repo, "artifacts", "after.png"), "fake binary fixture");
  assert.equal(checkProof({ ...f.options, checkProof: f.proof }).valid, true);
}));
