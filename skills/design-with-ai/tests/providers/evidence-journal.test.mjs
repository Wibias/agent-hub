import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { initializeLedger, importFindings, readLedger } from "../../scripts/findings-ledger.mjs";
import { fuseProviderEvidence } from "../../scripts/providers/fuse.mjs";
import {
  initializeEvidenceJournal, readEvidenceJournal, captureProviderFusion,
  adjudicateProviderGroup, previewLegacyImport,
} from "../../scripts/providers/evidence-journal.mjs";

const cli = fileURLToPath(new URL("../../scripts/providers/evidence-cli.mjs", import.meta.url));
const historic = {
  id: "UX-EXISTING", route: "/dashboard", kind: "VISUAL", priority: "MEDIUM",
  symptom: "Old issue", acceptance: "Still valid", evidenceRef: "screens/old.png",
};

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "provider-journal-test-"));
  const dir = join(root, ".design-with-ai"); mkdirSync(dir);
  const legacyPath = join(dir, "findings-ledger.json");
  const journalPath = join(dir, "provider-evidence-journal.json");
  initializeLedger(legacyPath);
  importFindings(legacyPath, { findings: [historic] });
  const fusion = fuseProviderEvidence([{
    provider: "native-dwa", capability: "static-audit", status: "FINDINGS",
    verdict: "HOLD",
    findings: [{
      id: "n1", providerRuleId: "G05", priority: "P0",
      message: "Nested cards", location: { route: "/dashboard",
        file: "src/page.tsx", line: 12 },
      evidence: [{ kind: "source", ref: "src/page.tsx:12" }],
    }],
  }], { required: ["native-dwa"] });
  try { return await fn({ root, dir, legacyPath, journalPath, fusion }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function promotion(fx) {
  return {
    runId: "audit-1", groupId: fx.fusion.groups[0].id,
    decision: "PROMOTE", reason: "Confirmed repeated card nesting in real UI",
    evidenceRef: "screens/updated.png",
    legacyFinding: {
      id: "UX-PROVIDER-001", route: "/dashboard", kind: "VISUAL",
      priority: "MEDIUM", symptom: "Nested cards obscure hierarchy",
      acceptance: "Simplify the containment structure",
      evidenceRef: "screens/updated.png",
    },
  };
}

test("v2 journal is separate, anchored to the existing append-only v1 ledger", async () => {
  await fixture(async (fx) => {
    const before = readFileSync(fx.legacyPath, "utf8");
    const journal = initializeEvidenceJournal(fx.journalPath, fx.legacyPath);
    assert.equal(journal.schemaVersion, 2);
    assert.equal(journal.legacyAnchor.eventCount, 1);
    assert.equal(journal.events.length, 0);
    assert.equal(readFileSync(fx.legacyPath, "utf8"), before);
    assert.throws(() => initializeEvidenceJournal(fx.journalPath, fx.legacyPath),
      /refusing reset/);
  });
});

test("capture is idempotent, differing same-run evidence cannot overwrite history", async () => {
  await fixture(async (fx) => {
    initializeEvidenceJournal(fx.journalPath, fx.legacyPath);
    const before = readFileSync(fx.legacyPath, "utf8");
    const first = captureProviderFusion(fx.journalPath, fx.legacyPath,
      { runId: "audit-1", fusion: fx.fusion });
    assert.equal(first.idempotent, false);
    const again = captureProviderFusion(fx.journalPath, fx.legacyPath,
      { runId: "audit-1", fusion: fx.fusion });
    assert.equal(again.idempotent, true);
    assert.equal(readEvidenceJournal(fx.journalPath, fx.legacyPath).events.length, 1);
    const changed = structuredClone(fx.fusion);
    changed.contentSha256 = "wrong";
    assert.throws(() => captureProviderFusion(fx.journalPath, fx.legacyPath,
      { runId: "audit-1", fusion: changed }), /digest mismatch/);
    assert.equal(readFileSync(fx.legacyPath, "utf8"), before);
  });
});

test("explicit adjudication preserves chain and refuses changing a prior decision", async () => {
  await fixture(async (fx) => {
    initializeEvidenceJournal(fx.journalPath, fx.legacyPath);
    captureProviderFusion(fx.journalPath, fx.legacyPath,
      { runId: "audit-1", fusion: fx.fusion });
    const initial = readEvidenceJournal(fx.journalPath, fx.legacyPath).events;
    const promote = promotion(fx);
    assert.equal(adjudicateProviderGroup(fx.journalPath, fx.legacyPath, promote).idempotent, false);
    assert.equal(adjudicateProviderGroup(fx.journalPath, fx.legacyPath, promote).idempotent, true);
    assert.deepEqual(readEvidenceJournal(fx.journalPath, fx.legacyPath).events.slice(0, 1), initial);
    assert.throws(() => adjudicateProviderGroup(fx.journalPath, fx.legacyPath,
      { ...promote, decision: "DEFER", legacyFinding: undefined }), /refusing to rewrite/);
    assert.equal(readEvidenceJournal(fx.journalPath, fx.legacyPath).events.length, 2);
  });
});

test("only an explicit PROMOTE yields v1 import candidates; preview itself is read-only", async () => {
  await fixture(async (fx) => {
    initializeEvidenceJournal(fx.journalPath, fx.legacyPath);
    captureProviderFusion(fx.journalPath, fx.legacyPath,
      { runId: "audit-1", fusion: fx.fusion });
    const legacyBefore = readFileSync(fx.legacyPath, "utf8");
    assert.deepEqual(previewLegacyImport(fx.journalPath, fx.legacyPath,
      { runId: "audit-1" }).findings, []);
    adjudicateProviderGroup(fx.journalPath, fx.legacyPath, promotion(fx));
    const preview = previewLegacyImport(fx.journalPath, fx.legacyPath,
      { runId: "audit-1" });
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.requiresExplicitLegacyImport, true);
    assert.equal(preview.findings.length, 1);
    assert.equal(readFileSync(fx.legacyPath, "utf8"), legacyBefore);
    // The legacy import API itself remains the ONLY promotion write path.
    assert.equal(importFindings(fx.legacyPath, preview).added, 1);
    assert.deepEqual(readLedger(fx.legacyPath).events.map((e) => e.id),
      ["UX-EXISTING", "UX-PROVIDER-001"]);
    assert.equal(readEvidenceJournal(fx.journalPath, fx.legacyPath).events.length, 2);
  });
});

test("changing a v1 historical prefix invalidates provider journal reads", async () => {
  await fixture(async (fx) => {
    initializeEvidenceJournal(fx.journalPath, fx.legacyPath);
    const legacy = readLedger(fx.legacyPath);
    legacy.events[0].symptom = "Altered historic issue";
    writeFileSync(fx.legacyPath, JSON.stringify(legacy));
    assert.throws(() => readEvidenceJournal(fx.journalPath, fx.legacyPath),
      /prefix changed/);
  });
});

test("tampering with an earlier provider journal event invalidates the chain", async () => {
  await fixture(async (fx) => {
    initializeEvidenceJournal(fx.journalPath, fx.legacyPath);
    captureProviderFusion(fx.journalPath, fx.legacyPath,
      { runId: "audit-1", fusion: fx.fusion });
    const journal = readEvidenceJournal(fx.journalPath, fx.legacyPath);
    journal.events[0].fusion.groups[0].priority = "P2";
    writeFileSync(fx.journalPath, JSON.stringify(journal));
    assert.throws(() => readEvidenceJournal(fx.journalPath, fx.legacyPath),
      /hash changed/);
  });
});

test("adjudication requires evidence, route match, and valid legacy metadata", async () => {
  await fixture(async (fx) => {
    initializeEvidenceJournal(fx.journalPath, fx.legacyPath);
    captureProviderFusion(fx.journalPath, fx.legacyPath,
      { runId: "audit-1", fusion: fx.fusion });
    const good = promotion(fx);
    assert.throws(() => adjudicateProviderGroup(fx.journalPath, fx.legacyPath,
      { ...good, reason: "" }), /needs a known/);
    assert.throws(() => adjudicateProviderGroup(fx.journalPath, fx.legacyPath,
      { ...good, legacyFinding: { ...good.legacyFinding, route: "/wrong" } }), /route-matched/);
    assert.throws(() => adjudicateProviderGroup(fx.journalPath, fx.legacyPath,
      { ...good, legacyFinding: { ...good.legacyFinding, acceptance: "" } }), /reviewed acceptance/);
  });
});

test("legacy historical IDs cannot be reused during export", async () => {
  await fixture(async (fx) => {
    initializeEvidenceJournal(fx.journalPath, fx.legacyPath);
    captureProviderFusion(fx.journalPath, fx.legacyPath,
      { runId: "audit-1", fusion: fx.fusion });
    const d = promotion(fx);
    d.legacyFinding.id = "UX-EXISTING";
    adjudicateProviderGroup(fx.journalPath, fx.legacyPath, d);
    assert.throws(() => previewLegacyImport(fx.journalPath, fx.legacyPath,
      { runId: "audit-1" }), /historical or duplicate/);
  });
});

test("CLI performs fusion and sidecar creation without touching v1", async () => {
  await fixture(async (fx) => {
    const input = join(fx.root, "provider.json");
    const fused = join(fx.root, "fused.json");
    writeFileSync(input, JSON.stringify({
      provider: "native-dwa", capability: "static-audit",
      status: "PASS", findings: [],
    }));
    const run = spawnSync(process.execPath, [cli,
      "fuse", "--reports", input, "--required", "native-dwa", "--output", fused,
    ], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(readFileSync(fused, "utf8")).status, "SCOPED_CLEAR");
    const before = readFileSync(fx.legacyPath, "utf8");
    const init = spawnSync(process.execPath, [cli,
      "init", "--journal", fx.journalPath, "--ledger", fx.legacyPath,
    ], { encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    assert.equal(readFileSync(fx.legacyPath, "utf8"), before);
    const verify = spawnSync(process.execPath, [cli,
      "verify", "--journal", fx.journalPath, "--ledger", fx.legacyPath,
    ], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).valid, true);
  });
});

test("journal never silently creates an absent legacy ledger", async () => {
  await fixture(async (fx) => {
    rmSync(fx.legacyPath);
    assert.throws(() => initializeEvidenceJournal(fx.journalPath, fx.legacyPath),
      /Ledger missing/);
    assert.equal(existsSync(fx.journalPath), false);
  });
});
