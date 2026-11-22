import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const skill = read('../SKILL.md');
const baseline = read('../references/baseline-ui.md');
const quality = read('../references/quality-stack.md');
const verification = read('../references/verification-contract.md');
const contract = read('../references/desktop-monitoring-surfaces.md');

test('desktop monitor gate is conditional, discoverable and not a popup gate', () => {
  assert.match(skill, /desktop-monitoring-surfaces\.md/);
  assert.match(contract, /not a generic rule for every dashboard/);
  assert.match(contract, /G74/);
  assert.match(contract, /dark surfaces/);
});
test('dense monitor acceptance covers tangible window geometry and honest chart history', () => {
  for (const concept of ['KPI vertical fit', 'Table column budget', 'Vertical workspace budget',
    'Control identity and hierarchy', 'Table and graph honesty', 'Action prerequisites',
    'Typography and contrast', 'Host and edge cases']) {
    assert.ok(contract.includes(concept), 'Missing inspection category: ' + concept);
  }
  for (const concept of ['No process selected', '125%', '150%', 'absent samples', 'DPI', 'ellipsis']) {
    assert.ok(contract.includes(concept), 'Missing critical negative/edge case: ' + concept);
  }
});
test('baseline and quality explicitly block empty-pane pressure and header clipping', () => {
  assert.match(baseline, /table headings/);
  assert.match(quality, /column width vs header/);
  assert.match(quality, /empty panels/);
  assert.match(verification, /list-versus-empty-inspector/);
});
test('static screenshot cannot certify disabled destructive action or live-data freshness', () => {
  assert.match(contract, /A screenshot that \*looks\* enabled is a REVIEW lead/);
  assert.match(contract, /not proof the handler is enabled/);
  assert.match(contract, /NOT_VERIFIED/);
  assert.match(verification, /a static\nscreenshot alone leaves those behaviors `NOT_VERIFIED`/);
});
test('desktop monitoring eval cases are explicit and quick general polish stays unaffected', () => {
  const cases = read('./evals/cases.jsonl').trim().split(/\r?\n/).map(JSON.parse);
  const ids = new Set(cases.map(x => x.id));
  for (const id of ['E104','E105','E106','E107']) assert.ok(ids.has(id));
  const unrelated = cases.find(x=>x.id==='E107');
  assert.ok(unrelated.unnecessary_resources.includes('references/desktop-monitoring-surfaces.md'));
});

test("dense desktop COMPLETE requires an honest v2 window matrix and cross-viewport findings", () => {
  for (const concept of ["schemaVersion 2", "COMPACT", "MEDIUM", "MAXIMIZED",
    "SCALED", "COLLECTING", "findingViewportReviews", "duplicate", "PARTIAL"]) {
    assert.ok(contract.includes(concept), "Missing viewport regression guidance " + concept);
  }
  assert.match(verification, /single-window manifest cannot certify COMPLETE/);
  assert.match(quality, /multi-viewport/);
  assert.match(baseline, /compact, medium and maximized/);
});

test("compact KPI supporting text must clear the section divider, including scaled DPI", () => {
  for (const word of ["kpiStrip.bottomDividerY", "supportingText", "6 device-independent",
    "line touching or crossing", "every viewport"]) {
    assert.ok(contract.includes(word), "Missing KPI clearance instruction " + word);
  }
  assert.match(verification, /KPI supporting-text bottom clearance/);
});

test("Gitless native root is detected without user prompting and visual anomalies remain durable findings", () => {
  assert.match(contract, /automatically discovers/);
  assert.match(contract, /sourceRootMode: AUTO_NATIVE/);
  assert.match(contract, /renderInspection\.findingRefs/);
  assert.match(contract, /findings-ledger\.mjs sync/);
  assert.match(verification, /automatically selects/);
  assert.match(verification, /newly observed/);
  assert.match(skill, /verification, append newly discovered defects/);
});

test("closed visual findings must be reopened when selected-state geometry regresses", () => {
  for (const word of ["Reopen historical findings", "measuredFindingRefs.TABLE_CRAMPED",
    "REGRESSED", "unreadableInspectorPath", "PARTIAL", "--render-evidence"]) {
    assert.ok(contract.includes(word), "Missing regression audit guidance " + word);
  }
  assert.match(verification, /may not claim visually closed findings/);
});

test("partial native KPI QA may be scoped, but a render PASS must be backed by compact evidence", () => {
  for (const phrase of ["gates.render", "COMPACT:IDLE", "NOT_VERIFIED",
    "six DPI-scaled pixels", "actual tested runtime checks"]) {
    assert.ok(contract.includes(phrase), "Missing compact KPI smoke contract " + phrase);
  }
  assert.match(verification, /COMPACT:IDLE/);
  assert.match(verification, /near-touching KPI line/);
});

test("stalled visual fixes require a source repair, and historic finding IDs remain immutable", () => {
  const durable = read("../references/durable-findings-ledger.md");
  assert.match(durable, /No repeated observation-only loop/);
  assert.match(durable, /persistentRepairActions/);
  assert.match(durable, /two meanings for PCG-16/);
  assert.match(contract, /Code-first repair loop/);
  assert.match(contract, /same compact client dimensions/);
  assert.match(verification, /different defect cannot reuse/);
});

test("native verification uses external inspection without altering the app just to generate evidence", () => {
  for (const phrase of [
    "External-first native inspection", "read-only", "PowerShell/.NET",
    "GetDpiForWindow", "same integrity level", "restoring",
    "Do **not** modify Program.cs", "not to the PCGuardian executable",
    "PARTIAL", "NOT_VERIFIED",
  ]) {
    assert.ok(contract.toLowerCase().includes(phrase.toLowerCase()),
      "Missing external-first native inspection contract: " + phrase);
  }
  assert.match(verification, /captured \*\*externally\*\*/);
  assert.match(verification, /without modifying the application's startup code/);
  assert.match(contract, /A screenshot alone cannot substitute/);
  assert.match(contract, /Product source changes\s+are justified separately/);
});

test("bundled external capture helper stays read-only and distinguishes raw observation from v2 proof", () => {
  const helper = read("../scripts/capture-native-window.ps1");
  for (const marker of [
    "GetClientRect", "ClientToScreen", "GetDpiForWindow", "CopyFromScreen",
    "UIAutomationClient", "Get-FileHash", "RAW_NOT_CERTIFIED",
    "SetThreadDpiAwarenessContext", "occlusionVerified = $false",
  ]) {
    assert.ok(helper.includes(marker), "Missing external capture behavior: " + marker);
  }
  assert.doesNotMatch(helper, /(?:Program|MainForm)\.cs|dotnet build|Add-Content.*\.cs/);
  assert.match(contract, /scripts\/capture-native-window\.ps1/);

  if (process.platform === "win32") {
    const path = fileURLToPath(new URL("../scripts/capture-native-window.ps1", import.meta.url));
    const command = '$errors=$null;$tokens=$null;' +
      '[System.Management.Automation.Language.Parser]::ParseFile(' +
      "'" + path.replaceAll("'", "''") + "',[ref]$tokens,[ref]$errors)|Out-Null;" +
      'if($errors.Count){$errors|ForEach-Object{Write-Error $_.Message};exit 1}';
    const proc = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(command, "utf16le").toString("base64")], { encoding: "utf8" });
    assert.equal(proc.status, 0, proc.stdout + proc.stderr);
  }
});

test("repeated IMPROVED_BUT_OPEN needs actual evidence and old issues outrank cosmetic novelty", () => {
  const durable = read("../references/durable-findings-ledger.md");
  assert.match(durable, /IMPROVED_BUT_OPEN with evidence/);
  assert.match(durable, /reassessment: \{ observed: true/);
  assert.match(durable, /priorityDeferrals\[\]/);
  assert.match(contract, /historical finding says IMPROVED_BUT_OPEN/);
  assert.match(verification, /genuinely observed/);
  assert.match(verification, /older unresolved HIGH\/MEDIUM/);
});
