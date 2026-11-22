import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { snapshotProjectSource, snapshotRootedSource, discoverNativeSourceRoot } from "../scripts/project-source-snapshot.mjs";
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
    // The external provider token is genuinely unavailable. A structured,
    // evidence-grounded blocker must permit truthful PARTIAL despite the
    // actionable-loop guard; prose alone is not reliable evidence.
    persistentRepairActions: [{
      findingId: finding.id, action: "BLOCKED",
      blocker: "No authorized live TikTok provider token in this environment",
      evidenceRef: "tests/simulated-publish.txt",
      nextStep: "Obtain an authorized provider connection before live verification",
    }],
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

test("WinForms source and XAML modifications invalidate the project fingerprint while obj/publish are excluded", () => fixture(f => {
  const before = snapshotProjectSource(f.repo);
  const form = join(f.ui, "MainForm.cs");
  writeFileSync(form, "public class MainForm { }\n");
  const changed = snapshotProjectSource(f.repo);
  assert.notEqual(before.sha256, changed.sha256);
  const xaml = join(f.ui, "MainWindow.xaml");
  writeFileSync(xaml, "<Window></Window>\n");
  const withXaml = snapshotProjectSource(f.repo);
  assert.notEqual(changed.sha256, withXaml.sha256);
  const output = join(f.repo, "obj");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "Generated.cs"), "class Generated { }\n");
  assert.equal(snapshotProjectSource(f.repo).sha256, withXaml.sha256);
}));

test("Gitless native root below a broken ancestor .git is fingerprinted without touching that metadata", () => {
  const parent = mkdtempSync(join(tmpdir(), "dwa-broken-git-parent-"));
  try {
    const broken = join(parent, ".git");
    mkdirSync(broken);
    const project = join(parent, "nested", "PCGuardian");
    mkdirSync(join(project, "UI"), { recursive: true });
    const form = join(project, "UI", "MainForm.cs");
    writeFileSync(form, "public class MainForm { }\n");
    assert.throws(() => snapshotProjectSource(project), /workspace fingerprint is unavailable/);
    const first = snapshotRootedSource(project);
    assert.equal(first.sourceMode, "ROOTED_DIRECTORY");
    assert.equal(first.fileCount, 1);
    const bin = join(project, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "Generated.cs"), "internal class Generated { }\n");
    assert.equal(snapshotRootedSource(project).sha256, first.sha256);
    writeFileSync(form, "public class MainForm { public int Version = 2; }\n");
    assert.notEqual(snapshotRootedSource(project).sha256, first.sha256);
    assert.equal(readdirSync(broken).length, 0, "ancestor .git remains unchanged");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
test("a Gitless empty or missing source directory is not certifiable", () => {
  const root = mkdtempSync(join(tmpdir(), "dwa-gitless-empty-"));
  try {
    assert.throws(() => snapshotRootedSource(root), /no eligible project source files/);
    assert.throws(() => snapshotRootedSource(join(root, "missing")), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("auto-detected WinForms source root binds a Gitless PCGuardian PARTIAL proof and catches late C# edits", () => {
  const parent = mkdtempSync(join(tmpdir(), "dwa-pcg-auto-root-"));
  try {
    mkdirSync(join(parent, ".git")); // invalid ancestor, must stay untouched
    const project = join(parent, "nested", "MemoryGuardian");
    const art = join(project, ".design-with-ai");
    const ui = join(project, "UI");
    mkdirSync(art, { recursive: true });
    mkdirSync(ui);
    writeFileSync(join(project, "MemoryGuardian.csproj"), "<Project Sdk='Microsoft.NET.Sdk.WindowsDesktop' />");
    const src = join(ui, "MainForm.cs");
    writeFileSync(src, "public sealed class MainForm { public int Value = 1; }");
    const ledger = join(art, "findings-ledger.json");
    initializeLedger(ledger);
    const prior = { id: "PCG-15", route: "PCGuardian/MainForm", kind: "WORKFLOW",
      priority: "MEDIUM", symptom: "Stale action warning after selecting process",
      acceptance: "Clear warning on selection", evidenceRef: "renders/pcg15-before.png" };
    importFindings(ledger, { findings: [prior] });
    const frozen = makeLedgerBaseline(readLedger(ledger),
      { scope: ["PCGuardian/MainForm"], runId: "pcg-native-auto-run-1" });
    const baseline = join(art, "prior.json");
    writeFileSync(baseline, JSON.stringify(frozen));
    const receipt = join(art, "receipt.json");
    const data = {
      schemaVersion: 1, requiresPriorBaseline: true, requiresFindingsLedger: true,
      surfaceKind: "DENSE_DESKTOP_MONITOR", iterationVerdict: "PARTIAL",
      verdictReason: "Live elevated Force Close confirmation not verified",
      changeSummary: { kind: "NO_CHANGE", rationale: "Runtime inspection only", addressedFindingIds: [] },
      scope: [{ route: "PCGuardian/MainForm", task: "Inspect process action state",
        coverage: "INSPECTED", semantics: { applicable: false, reason: "Action remains unverified" } }],
      findings: [{ ...prior, decision: "Retain pending verification",
        disposition: "PERSISTS", reason: "Selection-state render unavailable" }],
      openCarryover: ["PCG-15"],
    };
    writeFileSync(receipt, JSON.stringify(data));
    syncLedger(ledger, frozen, data);
    assert.equal(discoverNativeSourceRoot({ receipt, ledger }), project);
    const proof = join(art, "proof.json");
    const args = { receipt, baseline, ledger, proof, workspaceCwd: parent };
    assert.equal(runGate(args).exitCode, 0);
    const saved = JSON.parse(readFileSync(proof, "utf8"));
    assert.equal(saved.sourceRootMode, "AUTO_NATIVE");
    assert.equal(saved.sourceRoot, project);
    assert.equal(saved.projectSource.sourceMode, "ROOTED_DIRECTORY");
    const checked = checkProof({ ...args, checkProof: proof });
    assert.equal(checked.valid, true, checked.issues.join("; "));
    assert.equal(checked.sourceBound, true);
    assert.equal(checked.completionEligible, false);
    writeFileSync(src, "public sealed class MainForm { public int Value = 2; }");
    const stale = checkProof({ ...args, checkProof: proof });
    assert.equal(stale.valid, false);
    assert.ok(stale.issueCodes.includes("WORKTREE_CHANGED"));

    // Real regression: a fresh gate proof generated after the source edit
    // must not bless the unchanged, older receipt as valid PARTIAL.
    const past = new Date(Date.now() - 20000);
    utimesSync(receipt, past, past);
    const staleReceiptProof = join(art, "proof-over-old-receipt.json");
    const staleReceiptGate = runGate({ ...args, proof: staleReceiptProof });
    assert.equal(staleReceiptGate.exitCode, 1);
    assert.equal(staleReceiptGate.proof.result.valid, false);
    assert.equal(staleReceiptGate.proof.validatorProcessExitCode, 0);
    assert.match(staleReceiptGate.proof.result.problems.join("; "), /NATIVE_RECEIPT_STALE/);
    const staleReceiptCheck = checkProof({ ...args, checkProof: staleReceiptProof });
    assert.equal(staleReceiptCheck.valid, false);
    assert.ok(staleReceiptCheck.issueCodes.includes("NATIVE_RECEIPT_STALE"));

    // After the final edit, a genuinely new, reconciled receipt may be
    // validated without touching the broken ancestor Git metadata.
    const olderSource = new Date(Date.now() - 10000);
    utimesSync(src, olderSource, olderSource);
    writeFileSync(receipt, JSON.stringify(data));
    const repairedProof = join(art, "proof-after-fresh-receipt.json");
    assert.equal(runGate({ ...args, proof: repairedProof }).exitCode, 0);
    assert.equal(checkProof({ ...args, checkProof: repairedProof }).valid, true);
    assert.equal(readdirSync(join(parent, ".git")).length, 0);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
test("auto root never guesses unrelated folder names or mismatched project ledgers", () => {
  const parent = mkdtempSync(join(tmpdir(), "dwa-pcg-no-guess-"));
  try {
    const p = join(parent, "MemoryGuardian"), art = join(p, ".design-with-ai");
    mkdirSync(art, { recursive: true });
    const receipt = join(art, "receipt.json"), ledger = join(art, "findings-ledger.json");
    writeFileSync(receipt, "{}"); writeFileSync(ledger, "{}");
    writeFileSync(join(p, "MainForm.cs"), "class MainForm {}");
    assert.equal(discoverNativeSourceRoot({ receipt, ledger }), null, "missing real .csproj marker");
    writeFileSync(join(p, "MemoryGuardian.csproj"), "<Project />");
    assert.equal(discoverNativeSourceRoot({ receipt, ledger }), p);
    assert.equal(discoverNativeSourceRoot({ receipt, ledger: join(parent, "other", "findings-ledger.json") }), null);
    assert.equal(discoverNativeSourceRoot({ receipt: join(parent, "outside.json"), ledger }), null);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
