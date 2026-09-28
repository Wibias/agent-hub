#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const casesPath = resolve(root, "skills/design-with-ai/tests/evals/cases.jsonl");
const ownershipPath = resolve(root, "skills/design-with-ai/tests/evals/ui-routing-ownership.jsonl");
const regressionPath = resolve(root, "skills/design-with-ai/tests/evals/regression-cases.jsonl");
const regressionLockPath = resolve(root, "skills/design-with-ai/tests/evals/regression-lock.json");
const referencesDir = resolve(root, "skills/design-with-ai/references");
const tasteGatePath = resolve(root, "skills/design-with-ai/scripts/taste-gate.ps1");
const tasteGateEnginePath = resolve(root, "skills/design-with-ai/scripts/taste-gate.mjs");
const slopSignalsPath = resolve(root, "skills/design-with-ai/references/slop-signals.json");
const renderSnapshotPath = resolve(root, "skills/design-with-ai/scripts/render-snapshot.js");
const renderTasteGatePath = resolve(root, "skills/design-with-ai/scripts/render-taste-gate.mjs");
const tasteEvidenceFusionPath = resolve(root, "skills/design-with-ai/scripts/taste-evidence-fusion.mjs");
const tasteEvidenceReceiptPath = resolve(root, "skills/design-with-ai/scripts/taste-evidence-receipt.mjs");
const renderedSlopReviewPath = resolve(root, "skills/design-with-ai/references/rendered-slop-review.md");
const sourceCalibrationPath = resolve(root, "skills/design-with-ai/tests/source-calibration-cases.jsonl");
const renderCalibrationPath = resolve(root, "skills/design-with-ai/tests/render-calibration-cases.jsonl");
const crossSurfaceSlopReviewPath = resolve(root, "skills/design-with-ai/references/cross-surface-slop-review.md");
const compareRenderSnapshotsPath = resolve(root, "skills/design-with-ai/scripts/compare-render-snapshots.mjs");
const verificationContractPath = resolve(root, "skills/design-with-ai/references/verification-contract.md");
const antiSlopPath = resolve(root, "skills/design-with-ai/references/anti-slop-gates.md");
const hardInvariantsPath = resolve(root, "skills/design-with-ai/references/hard-invariants.md");
const designMethodsPath = resolve(root, "skills/design-with-ai/references/design-methods.md");
const impeccableSkillPath = resolve(root, "skills/impeccable/SKILL.md");
const existingUiWorkflowsPath = resolve(root, "skills/design-with-ai/references/existing-ui-workflows.md");
const motionVocabularyPath = resolve(root, "skills/design-with-ai/references/motion-vocabulary.md");
const motionVocabularySourcePath = resolve(root, "skills/design-with-ai/references/motion-vocabulary-source.md");
const guidanceCatalogPath = resolve(root, "knowledge/design-guidance/catalog.json");
const reportPath = resolve(root, "knowledge/routing-overlap-report.md");
const releaseGovernanceWorkflowPath = resolve(root, ".github/workflows/verify-skill-routing.yml");
const refreshSkillIndexWorkflowPath = resolve(root, ".github/workflows/refresh-skill-index.yml");
const checkIndex = process.argv.includes("--check-index");
const retired = [
  "design-styles",
  "baseline-ui",
  "make-interfaces-feel-better",
  "design-first-ui-prompting",
  "review-animations",
  "optimize-web-animations",
  "animation-vocabulary",
];

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: ${error.message}`);
      }
    });
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertUniqueIds(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    if (!row.id) throw new Error(`${label} case missing id`);
    if (ids.has(row.id)) throw new Error(`duplicate ${label} case id: ${row.id}`);
    ids.add(row.id);
  }
  return ids;
}

function assertNoRetiredExpectedResources(rows) {
  for (const name of retired) {
    const needle = `.agents/skills/${name}/`;
    for (const row of rows) {
      if ((row.expected_resources ?? []).some((resource) => resource.includes(needle)))
        throw new Error(`${row.id} still expects retired resource path: ${needle}`);
    }
  }
}

function assertNoRetiredLiveHandoffs() {
  const historical = /\b(source|lineage|provenance|historical|formerly?|former|retired|superseded|snapshot)\b/i;
  const files = readdirSync(referencesDir)
    .filter((name) => name.endsWith(".md") && !name.endsWith("-source.md"));

  for (const file of files) {
    const path = resolve(referencesDir, file);
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (historical.test(line)) continue;

      if (/\bemil-design-eng\.md\b/.test(line))
        throw new Error(`${file}:${index + 1} still points to retired emil-design-eng.md instead of canonical motion references`);

      for (const name of retired) {
        const escaped = escapeRegExp(name);
        const pathRef = new RegExp(`(?:\\.agents/)?skills/${escaped}/|\\.\\./${escaped}/`, "i");
        const commandRef = new RegExp(`\\b${escaped}\\s+(?:opportunities|audit|review|plan|execute|reconcile)\\b`, "i");
        const codeName = line.includes(`\`${name}\``);

        if (pathRef.test(line) || commandRef.test(line) || codeName)
          throw new Error(`${file}:${index + 1} contains retired live handoff: ${name}`);
      }
    }
  }
}

function assertTasteGateContract() {
  const wrapper = readFileSync(tasteGatePath, "utf8");
  if (wrapper.includes("design-styles taste-gate") || wrapper.includes("Mechanical anti-slop leads for design-styles"))
    throw new Error("taste gate still exposes retired design-styles ownership");
  if (!wrapper.includes("taste-gate.mjs"))
    throw new Error("PowerShell taste gate must delegate to the canonical Node engine");
  if (!wrapper.includes("[string] $IntentPath"))
    throw new Error("PowerShell taste gate must expose the contextual intent contract");
  if (!existsSync(tasteGateEnginePath))
    throw new Error("cluster-aware taste-gate engine is missing");

  const engine = readFileSync(tasteGateEnginePath, "utf8");
  for (const required of ["REVIEW_CLUSTER", "summarizeFamilies", "--intent", "suppressedHits"]) {
    if (!engine.includes(required))
      throw new Error(`taste-gate engine missing cluster/intent contract token: ${required}`);
  }

  if (!existsSync(slopSignalsPath))
    throw new Error("anti-slop signal registry is missing");
  const registry = JSON.parse(readFileSync(slopSignalsPath, "utf8"));
  if (registry.schemaVersion !== 1)
    throw new Error("anti-slop signal registry must use schemaVersion 1");

  const registrySources = registry.sources ?? [];
  const sourceIds = new Set(registrySources.map((source) => source.id));
  if (sourceIds.size !== registrySources.length)
    throw new Error("anti-slop signal registry source IDs must be unique");
  for (const required of [
    "vibecoded-design-tells",
    "signs-of-ai-design",
    "no-slop-ui",
    "design-homogenization-paper",
    "pols-slop",
    "local-policy",
  ]) {
    if (!sourceIds.has(required))
      throw new Error(`anti-slop signal registry missing source provenance: ${required}`);
  }

  for (const rule of [
    ...(registry.rules ?? []),
    ...(registry.derivedRules ?? []),
    ...(registry.renderRules ?? []),
    ...(registry.crossSurfaceRules ?? []),
  ]) {
    for (const sourceId of rule.evidence?.sources ?? []) {
      if (!sourceIds.has(sourceId))
        throw new Error(`anti-slop rule ${rule.id}/${rule.name} references unknown evidence source: ${sourceId}`);
    }
  }

  if ((registry.clusterPolicy?.minimumIndependentFamilies ?? 0) < 3)
    throw new Error("anti-slop cluster policy must require at least three independent families");
  if ((registry.clusterPolicy?.minimumScore ?? 0) < 5)
    throw new Error("anti-slop cluster policy score threshold is too weak");

  const rules = registry.rules ?? [];
  const transitionAll = rules.find((rule) => rule.id === "G22" && rule.name === "transition-all");
  if (!transitionAll || transitionAll.severity !== "P0" || transitionAll.hardGate !== true)
    throw new Error("taste gate must retain transition-all as a mechanically decisive P0 hard gate");

  const contextualNames = new Set([
    "purple-gradient-tailwind",
    "purple-hex-cluster",
    "generic-font-default",
    "generic-google-font",
    "bg-gradient-purple",
    "generic-font-extra",
    "opacity-zero-initial",
  ]);
  for (const rule of rules) {
    if (contextualNames.has(rule.name) && (rule.severity === "P0" || rule.hardGate === true))
      throw new Error(`context-dependent taste lead must not be mechanically P0: ${rule.name}`);
  }

  const g27 = rules.find((rule) => rule.id === "G27");
  const g28 = rules.find((rule) => rule.id === "G28");
  if (!g27 || !g28 || g27.family !== "section-chrome" || g28.family !== "section-chrome")
    throw new Error("tracked kickers and numbered meta must collapse into one section-chrome family");

  const g67 = (registry.derivedRules ?? []).find((rule) => rule.id === "G67");
  if (!g67 || g67.severity !== "P1" || g67.hardGate === true || (g67.requiresAny ?? 0) < 2)
    throw new Error("G67 replacement-default detection must remain a contextual multi-probe P1");

  const gates = readFileSync(antiSlopPath, "utf8");
  if (!gates.includes("## Applicability rule"))
    throw new Error("anti-slop gates must state the project/brief applicability rule");
  if (!gates.includes("## Evidence and cluster rule"))
    throw new Error("anti-slop gates must document cluster-aware evidence semantics");
  if (!gates.includes("Project design truth, explicit user direction, and the selected visual system"))
    throw new Error("anti-slop gates must preserve project/design authority over generic taste heuristics");
  if (!gates.includes("not proof of AI"))
    throw new Error("anti-slop gates must reject authorship inference from contextual visual tells");
  if (gates.includes("design-styles stamp"))
    throw new Error("anti-slop gates still contain retired design-styles execution ownership");
}

function assertRenderedTasteGateContract() {
  for (const [label, path] of [
    ["render snapshot collector", renderSnapshotPath],
    ["render taste gate", renderTasteGatePath],
    ["rendered slop review", renderedSlopReviewPath],
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing`);
  }

  const collector = readFileSync(renderSnapshotPath, "utf8");
  for (const token of ["schemaVersion = 1", "getBoundingClientRect", "insideOrderedList", "equalSizeScore", "macroZones", "macroFingerprint", "radiusMetrics", "iconTileCount", "iconBearingCardRatio", "shellMetrics", "defaultActionPairs", "footerColumnCount", "marketingMetrics", "pricingHeadingCount", "visibleDetailsCount", "closingActionZoneCount", "surfaceMetrics", "ghostCardCount", "cardCompositionMetrics", "fullKitchenSinkCardCount", "maxAdornmentKinds", "rhythmMetrics", "dominantGapRatio"]) {
    if (!collector.includes(token))
      throw new Error(`render snapshot collector missing contract token: ${token}`);
  }
  if (/document\.(?:write|execCommand)\s*\(/.test(collector))
    throw new Error("render snapshot collector must remain read-only");

  const analyzer = readFileSync(renderTasteGatePath, "utf8");
  for (const token of ["PASS_RENDER_EVIDENCE", "REVIEW_RENDER", "REVIEW_RENDER_CLUSTER", "process.exitCode = 0"]) {
    if (!analyzer.includes(token))
      throw new Error(`render taste gate missing verdict contract token: ${token}`);
  }
  if (/verdict\s*:\s*["']HOLD["']/.test(analyzer))
    throw new Error("render taste gate must not mechanically emit HOLD");

  const registry = JSON.parse(readFileSync(slopSignalsPath, "utf8"));
  const byId = new Map((registry.renderRules ?? []).map((rule) => [rule.id, rule]));
  for (const required of ["G03","G04","G05","G07","G08","G27","G28","G30","G31","G55","G63","G64","G65","G66","G71","G72"]) {
    if (!byId.has(required))
      throw new Error(`render signal registry missing ${required}`);
    if (byId.get(required).severity === "P0")
      throw new Error(`render signal must remain contextual rather than mechanically P0: ${required}`);
  }
  if (byId.get("G27").family !== "section-chrome" || byId.get("G28").family !== "section-chrome")
    throw new Error("rendered kickers and numbered meta must deduplicate into section-chrome");

  for (const [id, family] of [["G31","surface-radius"],["G64","icon-default"],["G72","icon-density"]]) {
    if (byId.get(id).family !== family)
      throw new Error(`rendered chrome-density rule ${id} must remain in family ${family}`);
  }

  for (const [id, family] of [["G07","navigation-default"],["G08","footer-default"],["G65","action-default"]]) {
    if (byId.get(id).family !== family)
      throw new Error(`rendered shell-pattern rule ${id} must remain in family ${family}`);
  }

  if (byId.get("G63").family !== "marketing-meta-template" || byId.get("G63").weight < 3)
    throw new Error("rendered G63 must remain a strong contextual marketing-meta-template lead");

  for (const [id, family] of [["G30","elevation-language"],["G55","section-rhythm"]]) {
    if (byId.get(id).family !== family)
      throw new Error(`rendered elevation/rhythm rule ${id} must remain in family ${family}`);
    if (byId.get(id).weight > 1)
      throw new Error(`rendered elevation/rhythm rule ${id} must remain a weak contextual lead`);
  }

  if (byId.get("G66").family !== "card-composition-density" || byId.get("G66").weight !== 2)
    throw new Error("rendered G66 must remain a medium contextual card-composition lead");

  const review = readFileSync(renderedSlopReviewPath, "utf8");
  for (const token of ["read-only JavaScript", "never `HOLD`", "not evidence", "not measured"]) {
    if (!review.includes(token))
      throw new Error(`rendered slop review missing safety/context token: ${token}`);
  }

  const verification = readFileSync(verificationContractPath, "utf8");
  if (!verification.includes("rendered-slop-review.md"))
    throw new Error("verification contract must route available browser evaluation through rendered-slop-review");
  if (!verification.includes("not measured"))
    throw new Error("verification contract must label unavailable DOM evidence rather than fabricate it");
}

function assertTasteEvidenceFusionContract() {
  if (!existsSync(tasteEvidenceFusionPath))
    throw new Error("taste evidence fusion script is missing");

  const source = readFileSync(tasteEvidenceFusionPath, "utf8");
  for (const token of [
    "PASS_FUSED_EVIDENCE",
    "REVIEW_FUSED",
    "REVIEW_FUSED_CLUSTER",
    "Source/render reports use different cluster thresholds",
    "Math.max(current.score, row.score)",
    "sourceHold ? 1 : 0",
  ]) {
    if (!source.includes(token))
      throw new Error(`taste evidence fusion missing contract token: ${token}`);
  }
  if (!source.includes('source.value.verdict === "HOLD"'))
    throw new Error("taste evidence fusion must preserve source HOLD");
  if (/render[^\n]{0,80}HOLD[^\n]{0,80}\?\s*1/i.test(source))
    throw new Error("rendered contextual evidence must not create a blocking exit");

  const verification = readFileSync(verificationContractPath, "utf8");
  for (const token of [
    "taste-evidence-fusion.mjs",
    "deduplicates by semantic family",
    "same G31/G64/etc. family must never count twice",
    "source `HOLD` remains blocking",
  ]) {
    if (!verification.includes(token))
      throw new Error(`verification contract missing fusion token: ${token}`);
  }

  const quality = readFileSync(resolve(root, "skills/design-with-ai/references/quality-stack.md"), "utf8");
  if (!quality.includes("semantic families are counted once across channels"))
    throw new Error("quality stack must require cross-channel family deduplication");
}

function assertTasteEvidenceReceiptContract() {
  if (!existsSync(tasteEvidenceReceiptPath))
    throw new Error("taste evidence receipt script is missing");

  const source = readFileSync(tasteEvidenceReceiptPath, "utf8");
  for (const token of [
    "BLOCKED_SOURCE_HARD_GATE",
    "REVIEW_CONTEXTUAL_EVIDENCE",
    "MECHANICAL_EVIDENCE_CLEAR",
    "SOURCE_CLEAR_RENDER_NOT_MEASURED",
    "--manifest",
    "--route",
    "Render snapshot route mismatch",
    "Cross-surface report must cover exactly the route-bound rendered candidates",
    "renderedMeasurementMissing",
    "This is a mechanical evidence receipt, not a visual quality verdict",
    "sourceHold ? 1 : 0",
  ]) {
    if (!source.includes(token))
      throw new Error(`taste evidence receipt missing contract token: ${token}`);
  }
  if (!source.includes("taste-evidence-fusion.mjs"))
    throw new Error("taste evidence receipt must delegate source/render combination to the canonical fusion script");
  if (!source.includes("Cross-surface report has unsupported verdict"))
    throw new Error("taste evidence receipt must validate cross-surface report semantics");
  if (!source.includes('render: renderCoverage') || !source.includes('"partial"'))
    throw new Error("taste evidence receipt must preserve partial rendered coverage");

  const verification = readFileSync(verificationContractPath, "utf8");
  for (const token of [
    "taste-evidence-receipt.mjs",
    "SOURCE_CLEAR_RENDER_NOT_MEASURED",
    "this is not a visual quality",
    "receipt manifest",
    "snapshot.url",
    "candidate set exactly",
  ]) {
    if (!verification.includes(token))
      throw new Error(`verification contract missing receipt token: ${token}`);
  }

  const quality = readFileSync(resolve(root, "skills/design-with-ai/references/quality-stack.md"), "utf8");
  for (const token of [
    "taste-evidence-receipt.mjs",
    "--route",
    "manifest described in",
    "render `not_measured` or",
    "route-bound rendered candidate set",
  ]) {
    if (!quality.includes(token))
      throw new Error(`quality stack missing receipt token: ${token}`);
  }
}

function assertSourceCalibrationContract() {
  if (!existsSync(sourceCalibrationPath))
    throw new Error("source calibration matrix is missing");

  const registry = JSON.parse(readFileSync(slopSignalsPath, "utf8"));
  const rows = readJsonl(sourceCalibrationPath);
  assertUniqueIds(rows, "source calibration");

  const positiveNames = new Set(rows.flatMap((row) => row.expect_names ?? []));
  const negativeIds = new Set(rows.flatMap((row) => row.forbid_ids ?? []));
  const sourceRules = [...(registry.rules ?? []), ...(registry.derivedRules ?? [])];

  for (const rule of sourceRules) {
    if (!positiveNames.has(rule.name))
      throw new Error(`source calibration missing positive coverage for ${rule.id}/${rule.name}`);
  }
  for (const id of new Set(sourceRules.map((rule) => rule.id))) {
    if (!negativeIds.has(id))
      throw new Error(`source calibration missing boundary-negative coverage for ${id}`);
  }

  for (const row of rows) {
    if (!Array.isArray(row.expect_names) || !Array.isArray(row.forbid_ids))
      throw new Error(`source calibration case ${row.id} must declare expect_names and forbid_ids`);
    if (!row.files || typeof row.files !== "object" || Array.isArray(row.files))
      throw new Error(`source calibration case ${row.id} must declare files`);
  }

  const gates = readFileSync(antiSlopPath, "utf8");
  for (const token of [
    "Source calibration contract",
    "source-calibration-cases.jsonl",
    "positive fixture",
    "boundary-negative fixture",
    "evidence.sources",
  ]) {
    if (!gates.includes(token))
      throw new Error(`anti-slop gates missing source calibration token: ${token}`);
  }
}

function assertRenderCalibrationContract() {
  if (!existsSync(renderCalibrationPath))
    throw new Error("render calibration matrix is missing");

  const registry = JSON.parse(readFileSync(slopSignalsPath, "utf8"));
  const rows = readJsonl(renderCalibrationPath);
  assertUniqueIds(rows, "render calibration");

  const positive = new Set(rows.flatMap((row) => row.expect_hits ?? []));
  const negative = new Set(rows.flatMap((row) => row.forbid_hits ?? []));
  for (const rule of registry.renderRules ?? []) {
    if (!positive.has(rule.id))
      throw new Error(`render calibration missing positive coverage for ${rule.id}`);
    if (!negative.has(rule.id))
      throw new Error(`render calibration missing boundary-negative coverage for ${rule.id}`);
  }

  for (const row of rows) {
    if (!Array.isArray(row.expect_hits) || !Array.isArray(row.forbid_hits))
      throw new Error(`render calibration case ${row.id} must declare expect_hits and forbid_hits`);
    const overlap = row.expect_hits.filter((id) => row.forbid_hits.includes(id));
    if (overlap.length)
      throw new Error(`render calibration case ${row.id} both expects and forbids: ${overlap.join(", ")}`);
  }

  const review = readFileSync(renderedSlopReviewPath, "utf8");
  for (const token of ["Calibration contract", "positive fixture", "boundary-negative fixture", "one anecdotal false positive"]) {
    if (!review.includes(token))
      throw new Error(`rendered slop review missing calibration token: ${token}`);
  }
}

function assertCrossSurfaceTasteGateContract() {
  for (const [label, path] of [
    ["cross-surface comparator", compareRenderSnapshotsPath],
    ["cross-surface slop review", crossSurfaceSlopReviewPath],
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing`);
  }

  const analyzer = readFileSync(compareRenderSnapshotsPath, "utf8");
  for (const token of ["PASS_CROSS_SURFACE_EVIDENCE", "REVIEW_CROSS_SURFACE", "minimumSimilarity", "macroZones"]) {
    if (!analyzer.includes(token))
      throw new Error(`cross-surface comparator missing contract token: ${token}`);
  }
  if (/verdict\s*:\s*["']HOLD["']/.test(analyzer))
    throw new Error("cross-surface comparator must not mechanically emit HOLD");

  const registry = JSON.parse(readFileSync(slopSignalsPath, "utf8"));
  const g02 = (registry.crossSurfaceRules ?? []).find((rule) => rule.id === "G02");
  if (!g02 || g02.severity === "P0" || g02.hardGate === true)
    throw new Error("cross-surface G02 must remain contextual rather than mechanically blocking");
  if ((g02.minimumZones ?? 0) < 3 || (g02.minimumSimilarity ?? 0) < 0.8)
    throw new Error("cross-surface G02 heuristic threshold is missing or too weak");

  const review = readFileSync(crossSurfaceSlopReviewPath, "utf8");
  for (const token of ["distinct rendered web", "same representative viewport band", "never emits `HOLD`", "common application shell"]) {
    if (!review.includes(token))
      throw new Error(`cross-surface slop review missing context/safety token: ${token}`);
  }

  const verification = readFileSync(verificationContractPath, "utf8");
  if (!verification.includes("cross-surface-slop-review.md"))
    throw new Error("verification contract must route multi-route work through cross-surface review");
  if (!verification.includes("single-route task"))
    throw new Error("verification contract must keep cross-surface review out of single-route scope");
}

function assertReleaseGovernanceWorkflowContract() {
  for (const [label, path] of [
    ["release governance workflow", releaseGovernanceWorkflowPath],
    ["generated index refresh workflow", refreshSkillIndexWorkflowPath],
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing`);
  }

  const release = readFileSync(releaseGovernanceWorkflowPath, "utf8");
  for (const token of [
    "name: Release governance",
    "pull_request:",
    "- main",
    "contents: read",
    "Test source anti-slop calibration matrix",
    "Test rendered design calibration matrix",
    "Test unified taste evidence receipt",
    "Run design skill local structural validator",
    "Require generated index to be current",
    "git diff --exit-code",
  ]) {
    if (!release.includes(token))
      throw new Error(`release governance workflow missing token: ${token}`);
  }
  if (release.includes("contents: write") || /\bgit\s+push\b/.test(release))
    throw new Error("release governance workflow must remain read-only");

  const refresh = readFileSync(refreshSkillIndexWorkflowPath, "utf8");
  for (const token of [
    "name: Refresh skill routing index",
    "agent/verify-skill-routing",
    "contents: write",
    "git push",
  ]) {
    if (!refresh.includes(token))
      throw new Error(`generated index refresh workflow missing token: ${token}`);
  }
  if (refresh.includes("pull_request:") || /branches:\s*\n\s*- main/.test(refresh))
    throw new Error("generated index refresh workflow must not become a PR/main release check");

  const verification = readFileSync(verificationContractPath, "utf8");
  for (const token of [
    "## Release governance",
    "read-only on pull",
    "Release governance / verify",
    "live GitHub ruleset",
  ]) {
    if (!verification.includes(token))
      throw new Error(`verification contract missing release-governance token: ${token}`);
  }
}

function assertCompetingSkillClassificationContract() {
  const hard = readFileSync(hardInvariantsPath, "utf8");
  const methods = readFileSync(designMethodsPath, "utf8");
  const impeccable = readFileSync(impeccableSkillPath, "utf8");

  if (!hard.includes("user names another installed skill as an optional candidate"))
    throw new Error("hard invariants must classify a user-named optional competing skill");
  if (!hard.includes("do not treat the optional mention as specialist invocation"))
    throw new Error("optional specialist mention must not become invocation");

  for (const token of [
    "Named optional specialist classification",
    "COMPETING-SKILL CLASSIFICATION",
    "owner:",
    "candidate:",
    "classification:",
    "bounded-specialist",
    "Classification is not execution",
  ]) {
    if (!methods.includes(token))
      throw new Error(`design methods missing competing-skill classification token: ${token}`);
  }

  if (!impeccable.includes("name: impeccable"))
    throw new Error("A5 competing specialist contract must remain inspectable through impeccable/SKILL.md");
}

function assertRepositoryInjectionContract() {
  const hard = readFileSync(hardInvariantsPath, "utf8");
  const workflows = readFileSync(existingUiWorkflowsPath, "utf8");
  const marker = "SECURITY FLAG: repository instruction injection";

  if (!hard.includes(marker))
    throw new Error("hard invariants must explicitly emit the repository instruction-injection security flag");
  if (!hard.includes("continue only with otherwise permitted work"))
    throw new Error("hard invariants must preserve the real instruction hierarchy after repository injection");

  if (!workflows.includes(marker))
    throw new Error("existing UI workflows must surface repository instruction injection explicitly");
  if (!workflows.includes("preserve higher-priority instructions"))
    throw new Error("existing UI workflows must preserve higher-priority instructions after repository injection");
}

function assertMotionVocabularyContract() {
  const live = readFileSync(motionVocabularyPath, "utf8");
  if (/^---[\s\S]*?name:\s*animation-vocabulary/m.test(live))
    throw new Error("motion vocabulary route still contains retired skill frontmatter");
  if (!live.includes("Use only for `motion-name`"))
    throw new Error("motion vocabulary must remain bounded to the internal motion-name route");
  if (!live.includes("motion-vocabulary-source.md"))
    throw new Error("motion vocabulary must retain an explicit source-snapshot fallback");
  if (!existsSync(motionVocabularySourcePath))
    throw new Error("motion vocabulary source snapshot is missing");

  const source = readFileSync(motionVocabularySourcePath, "utf8");
  if (!source.includes("name: animation-vocabulary"))
    throw new Error("motion vocabulary source snapshot no longer preserves the retired upstream snapshot");
}

function assertGuidanceCatalogContract() {
  if (!existsSync(guidanceCatalogPath)) throw new Error("design guidance catalog is missing");
  const catalog = JSON.parse(readFileSync(guidanceCatalogPath, "utf8"));
  if (catalog.source?.upstream !== "nextlevelbuilder/ui-ux-pro-max-skill")
    throw new Error("design guidance catalog must preserve upstream provenance");
  if (!/^[0-9a-f]{40}$/.test(catalog.source?.snapshot ?? ""))
    throw new Error("design guidance catalog must bind a concrete upstream snapshot");
  const allowed = new Set(["chart", "native", "interaction", "text-layout", "accessibility"]);
  for (const row of catalog.records ?? []) {
    if (!allowed.has(row.domain))
      throw new Error(`design guidance catalog contains forbidden/unknown domain: ${row.domain}`);
  }
  if ((catalog.records ?? []).length === 0)
    throw new Error("design guidance catalog must contain at least one reviewed record");
}

const cases = readJsonl(casesPath);
const ids = assertUniqueIds(cases, "routing");
for (const required of ["D1","D2","D3","N1","N2","N3","N4","E1","E2","E3","E4","E5","E6","E7","E8","E9","E10","E11","E12","E13","E14","E15","E16","E17","E18","E19","E20","E21","E22","E23","E24","E25","E26","E27","E28","E29","E30","A1","A2","A3","A4","A5","A6"])
  if (!ids.has(required)) throw new Error(`missing required design-with-ai case ${required}`);

const ownership = readJsonl(ownershipPath);
const ownershipIds = assertUniqueIds(ownership, "UI ownership");
for (const required of ["UIR1","UIR2","UIR3","UIR4","UIR5","UIR6","UIR7","UIR8","UIR9","UIR10"])
  if (!ownershipIds.has(required)) throw new Error(`missing UI ownership case ${required}`);

for (const name of retired) {
  if (existsSync(resolve(root, "skills", name)))
    throw new Error(`retired skill directory still exists: skills/${name}`);
}
assertNoRetiredExpectedResources(cases);
assertNoRetiredExpectedResources(ownership);
assertNoRetiredLiveHandoffs();
assertTasteGateContract();
assertRenderedTasteGateContract();
assertTasteEvidenceFusionContract();
assertTasteEvidenceReceiptContract();
assertSourceCalibrationContract();
assertRenderCalibrationContract();
assertCrossSurfaceTasteGateContract();
assertReleaseGovernanceWorkflowContract();
assertCompetingSkillClassificationContract();
assertRepositoryInjectionContract();
assertMotionVocabularyContract();
assertGuidanceCatalogContract();

const d1 = cases.find((row) => row.id === "D1");
for (const required of [
  "references/hard-invariants.md",
  "references/core-design-workflow.md",
  "references/source-evidence.md",
  "references/reference-library.md",
  "references/quality-stack.md",
  "references/taste-workflow.md",
  "references/baseline-ui.md",
  "references/micro-craft.md",
]) {
  if (!d1.expected_resources?.includes(required))
    throw new Error(`D1 missing unified design resource ${required}`);
}
for (const forbidden of ["references/data-visualization.md","references/native-mobile.md","references/design-guidance.md"])
  if (!d1.unnecessary_resources?.includes(forbidden))
    throw new Error(`D1 must prove conditional intelligence is not loaded from a generic dashboard label: ${forbidden}`);

const d2 = cases.find((row) => row.id === "D2");
if (!d2.expected_resources?.includes("references/design-first-prompting.md"))
  throw new Error("D2 must route design-spec internally");
if (d2.expected_resources?.includes("references/core-design-workflow.md"))
  throw new Error("D2 design-spec must remain a bounded route");

const d3 = cases.find((row) => row.id === "D3");
for (const required of ["references/hard-invariants.md","references/standards.md","references/audit-playbook.md"])
  if (!d3.expected_resources?.includes(required))
    throw new Error(`D3 missing internal motion audit resource ${required}`);

const n3 = cases.find((row) => row.id === "N3");
if (n3.expected_skill !== "impeccable")
  throw new Error("N3 must preserve explicit impeccable ownership");
const n4 = cases.find((row) => row.id === "N4");
if (n4.expected_skill !== null)
  throw new Error("N4 must keep standalone analytical/report chart generation outside design-with-ai");

const e2 = cases.find((row) => row.id === "E2");
for (const required of ["references/data-visualization.md","references/design-guidance.md"])
  if (!e2.expected_resources?.includes(required))
    throw new Error(`E2 missing product-UI chart intelligence resource ${required}`);
if (e2.expected_resources?.includes("references/native-mobile.md"))
  throw new Error("E2 must not load native-mobile for a web analytics surface without native evidence");

const e3 = cases.find((row) => row.id === "E3");
for (const required of ["references/native-mobile.md","references/design-guidance.md"])
  if (!e3.expected_resources?.includes(required))
    throw new Error(`E3 missing native/mobile intelligence resource ${required}`);
if (e3.expected_resources?.includes("references/data-visualization.md"))
  throw new Error("E3 must not load data visualization for a non-chart native settings surface");

const e4 = cases.find((row) => row.id === "E4");
if (!e4.expected_resources?.includes("references/durable-design-contract.md"))
  throw new Error("E4 must load the durable design contract only for explicit multi-surface persistence");

for (const [id, assertion] of [
  ["E5", "single-contextual-tell-not-conviction"],
  ["E6", "real-sequence-numbering-preserved"],
  ["E7", "cluster-review-triggered-from-combination"],
  ["E8", "replacement-default-cluster-reviewed"],
]) {
  const row = cases.find((candidate) => candidate.id === id);
  if (!row?.expected_resources?.includes("references/anti-slop-gates.md"))
    throw new Error(`${id} must load the canonical anti-slop evidence contract`);
  if (!row.assertion_ids?.includes(assertion))
    throw new Error(`${id} missing anti-slop cluster assertion: ${assertion}`);
}

const e9 = cases.find((row) => row.id === "E9");
if (!e9?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E9 must load rendered-slop-review when browser JavaScript evaluation is available");
for (const assertion of ["read-only-browser-snapshot-used","render-cluster-remains-contextual","no-ai-authorship-claim"]) {
  if (!e9.assertion_ids?.includes(assertion))
    throw new Error(`E9 missing rendered anti-slop assertion: ${assertion}`);
}

const e10 = cases.find((row) => row.id === "E10");
if (!e10?.unnecessary_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E10 must prove rendered-slop-review is not mandatory when page evaluation is unavailable");
for (const assertion of ["dom-evidence-unavailable-labelled-not-measured","no-fabricated-browser-metrics","screenshot-rendered-evidence-still-used"]) {
  if (!e10.assertion_ids?.includes(assertion))
    throw new Error(`E10 missing rendered fallback assertion: ${assertion}`);
}

const e11 = cases.find((row) => row.id === "E11");
if (!e11?.expected_resources?.includes("references/cross-surface-slop-review.md"))
  throw new Error("E11 must load cross-surface review for multi-route macro-reuse analysis");
for (const assertion of ["matching-viewport-bands-compared","distinct-route-macro-reuse-reviewed-as-G02","shared-shell-not-automatic-failure"]) {
  if (!e11.assertion_ids?.includes(assertion))
    throw new Error(`E11 missing cross-surface assertion: ${assertion}`);
}

const e12 = cases.find((row) => row.id === "E12");
if (!e12?.unnecessary_resources?.includes("references/cross-surface-slop-review.md"))
  throw new Error("E12 must prove cross-surface review stays unloaded for a single-route task");
if (!e12.assertion_ids?.includes("no-out-of-scope-route-sampling"))
  throw new Error("E12 must prevent scope expansion into unrelated routes");

const e13 = cases.find((row) => row.id === "E13");
if (!e13?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E13 must load rendered-slop-review for radius/icon contextual evidence");
for (const assertion of ["rendered-radius-and-icon-metrics-used","project-radius-authority-preserved","owned-icon-grammar-preserved"]) {
  if (!e13.assertion_ids?.includes(assertion))
    throw new Error(`E13 missing rendered chrome authority assertion: ${assertion}`);
}

const e14 = cases.find((row) => row.id === "E14");
if (!e14?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E14 must load rendered-slop-review for chrome-density cluster evidence");
for (const assertion of ["over-round-render-lead-reviewed","icon-tile-render-lead-reviewed","icon-wallpaper-render-lead-reviewed","rendered-chrome-families-kept-independent"]) {
  if (!e14.assertion_ids?.includes(assertion))
    throw new Error(`E14 missing rendered chrome-density assertion: ${assertion}`);
}

const e15 = cases.find((row) => row.id === "E15");
if (!e15?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E15 must load rendered-slop-review for shell-pattern contextual evidence");
for (const assertion of ["rendered-shell-metrics-used","documented-navigation-ia-preserved","documented-footer-ia-preserved","single-cta-pair-not-treated-as-repetition"]) {
  if (!e15.assertion_ids?.includes(assertion))
    throw new Error(`E15 missing rendered shell authority assertion: ${assertion}`);
}

const e16 = cases.find((row) => row.id === "E16");
if (!e16?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E16 must load rendered-slop-review for shell-pattern cluster evidence");
for (const assertion of ["generic-nav-render-lead-reviewed","generic-footer-render-lead-reviewed","repeated-cta-pair-render-lead-reviewed","shell-pattern-families-kept-independent","weak-shell-signals-alone-not-conviction"]) {
  if (!e16.assertion_ids?.includes(assertion))
    throw new Error(`E16 missing rendered shell-pattern assertion: ${assertion}`);
}

const e17 = cases.find((row) => row.id === "E17");
if (!e17?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E17 must load rendered-slop-review for contextual G63 evidence");
for (const assertion of ["rendered-marketing-metrics-used","required-pricing-story-preserved","required-faq-preserved","g63-remains-contextual"]) {
  if (!e17.assertion_ids?.includes(assertion))
    throw new Error(`E17 missing rendered SaaS authority assertion: ${assertion}`);
}

const e18 = cases.find((row) => row.id === "E18");
if (!e18?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E18 must load rendered-slop-review for SaaS meta-template cluster evidence");
for (const assertion of ["saas-meta-template-render-lead-reviewed","g63-strong-family-kept-distinct","render-cluster-triggered-from-meta-template-plus-shell","product-story-adjudicates-g63"]) {
  if (!e18.assertion_ids?.includes(assertion))
    throw new Error(`E18 missing rendered SaaS meta-template assertion: ${assertion}`);
}

const e19 = cases.find((row) => row.id === "E19");
if (!e19?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E19 must load rendered-slop-review for contextual elevation/rhythm evidence");
for (const assertion of ["rendered-elevation-and-rhythm-metrics-used","owned-elevation-language-preserved","documented-section-cadence-preserved","g30-g55-remain-contextual"]) {
  if (!e19.assertion_ids?.includes(assertion))
    throw new Error(`E19 missing rendered elevation/rhythm authority assertion: ${assertion}`);
}

const e20 = cases.find((row) => row.id === "E20");
if (!e20?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E20 must load rendered-slop-review for elevation/rhythm cluster evidence");
for (const assertion of ["ghost-card-render-lead-reviewed","flat-section-rhythm-render-lead-reviewed","elevation-and-rhythm-families-kept-independent","weak-elevation-rhythm-signals-alone-not-conviction"]) {
  if (!e20.assertion_ids?.includes(assertion))
    throw new Error(`E20 missing rendered elevation/rhythm assertion: ${assertion}`);
}

const e21 = cases.find((row) => row.id === "E21");
if (!e21?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E21 must load rendered-slop-review for contextual G66 evidence");
for (const assertion of ["rendered-card-composition-metrics-used","task-required-card-facets-preserved","g66-remains-contextual","card-job-adjudicates-density"]) {
  if (!e21.assertion_ids?.includes(assertion))
    throw new Error(`E21 missing rendered kitchen-sink authority assertion: ${assertion}`);
}

const e22 = cases.find((row) => row.id === "E22");
if (!e22?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E22 must load rendered-slop-review for kitchen-sink card cluster evidence");
for (const assertion of ["kitchen-sink-card-render-lead-reviewed","card-composition-family-kept-independent","decorative-facets-distinguished-from-card-job","render-cluster-triggered-with-structure-and-radius"]) {
  if (!e22.assertion_ids?.includes(assertion))
    throw new Error(`E22 missing rendered kitchen-sink assertion: ${assertion}`);
}

const e23 = cases.find((row) => row.id === "E23");
if (!e23?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E23 must load rendered-slop-review for calibration-driven threshold tuning");
for (const assertion of ["render-calibration-matrix-used","threshold-not-tuned-from-single-anecdote","positive-fixture-preserved","boundary-negative-fixture-preserved"]) {
  if (!e23.assertion_ids?.includes(assertion))
    throw new Error(`E23 missing rendered calibration assertion: ${assertion}`);
}

const e24 = cases.find((row) => row.id === "E24");
if (!e24?.expected_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E24 must load rendered-slop-review when adding rendered detectors");
for (const assertion of ["new-render-rule-requires-positive-calibration","new-render-rule-requires-boundary-negative-calibration","all-render-rules-covered-by-calibration-matrix"]) {
  if (!e24.assertion_ids?.includes(assertion))
    throw new Error(`E24 missing rendered calibration coverage assertion: ${assertion}`);
}

const e25 = cases.find((row) => row.id === "E25");
if (!e25?.expected_resources?.includes("references/verification-contract.md"))
  throw new Error("E25 must load verification-contract for source/render fusion");
for (const assertion of ["source-render-reports-fused","same-semantic-family-counted-once","maximum-family-score-preserved","contextual-fused-verdict-adjudicated"]) {
  if (!e25.assertion_ids?.includes(assertion))
    throw new Error(`E25 missing source/render fusion assertion: ${assertion}`);
}

const e26 = cases.find((row) => row.id === "E26");
if (!e26?.expected_resources?.includes("references/verification-contract.md"))
  throw new Error("E26 must load verification-contract for fused cluster evidence");
for (const assertion of ["complementary-source-render-families-can-form-fused-cluster","source-p0-remains-blocking","render-evidence-cannot-create-hold","fused-cluster-remains-contextual"]) {
  if (!e26.assertion_ids?.includes(assertion))
    throw new Error(`E26 missing fused cluster assertion: ${assertion}`);
}

const e27 = cases.find((row) => row.id === "E27");
if (!e27?.expected_resources?.includes("references/verification-contract.md"))
  throw new Error("E27 must load verification-contract for source-only final receipt");
if (!e27?.unnecessary_resources?.includes("references/rendered-slop-review.md"))
  throw new Error("E27 must not require rendered-slop-review when browser evaluation is unavailable");
for (const assertion of ["taste-evidence-receipt-runner-used","render-coverage-labelled-not-measured","source-clear-not-treated-as-visual-pass","source-hard-gate-still-blocks"]) {
  if (!e27.assertion_ids?.includes(assertion))
    throw new Error(`E27 missing unified receipt fallback assertion: ${assertion}`);
}

const e28 = cases.find((row) => row.id === "E28");
for (const required of ["references/verification-contract.md","references/rendered-slop-review.md","references/cross-surface-slop-review.md"]) {
  if (!e28?.expected_resources?.includes(required))
    throw new Error(`E28 missing unified receipt evidence resource: ${required}`);
}
for (const assertion of ["taste-evidence-receipt-runner-used","route-bound-receipt-manifest-used","source-render-fusion-preserved","cross-surface-report-attached-separately","cross-surface-exact-candidate-set-bound","cross-surface-does-not-inflate-fused-score","receipt-remains-mechanical-not-quality-verdict"]) {
  if (!e28.assertion_ids?.includes(assertion))
    throw new Error(`E28 missing unified receipt assertion: ${assertion}`);
}

const e29 = cases.find((row) => row.id === "E29");
for (const assertion of ["source-calibration-matrix-used","source-threshold-not-tuned-from-single-anecdote","source-positive-fixture-preserved","source-boundary-negative-fixture-preserved","source-hard-gates-preserved"]) {
  if (!e29?.assertion_ids?.includes(assertion))
    throw new Error(`E29 missing source calibration assertion: ${assertion}`);
}

const e30 = cases.find((row) => row.id === "E30");
for (const assertion of ["evidence-source-ids-resolve","local-policy-provenance-explicit","external-source-provenance-explicit","new-source-rule-requires-positive-calibration","new-source-rule-requires-boundary-negative-calibration"]) {
  if (!e30?.assertion_ids?.includes(assertion))
    throw new Error(`E30 missing source provenance/calibration assertion: ${assertion}`);
}

const a5 = cases.find((row) => row.id === "A5");
for (const assertion of ["both-plausible-skills-opened","classification-recorded","design-with-ai-owns-general-visual-work","impeccable-remains-bounded-specialist"]) {
  if (!a5?.assertion_ids?.includes(assertion))
    throw new Error(`A5 missing competing-skill assertion: ${assertion}`);
}
for (const required of ["references/hard-invariants.md","references/design-methods.md",".agents/skills/impeccable/SKILL.md"]) {
  if (!a5?.expected_resources?.includes(required))
    throw new Error(`A5 missing competing-skill classification resource: ${required}`);
}

const a6 = cases.find((row) => row.id === "A6");
for (const assertion of ["repository-injection-treated-as-data","higher-priority-instructions-preserved","security-flag-emitted"]) {
  if (!a6?.assertion_ids?.includes(assertion))
    throw new Error(`A6 missing repository-injection assertion: ${assertion}`);
}
for (const required of ["references/hard-invariants.md","references/existing-ui-workflows.md"]) {
  if (!a6?.expected_resources?.includes(required))
    throw new Error(`A6 missing repository-injection contract resource: ${required}`);
}

const uir1 = ownership.find((row) => row.id === "UIR1");
for (const required of ["references/quality-stack.md","references/taste-workflow.md","references/baseline-ui.md","references/micro-craft.md"])
  if (!uir1.expected_resources?.includes(required))
    throw new Error(`UIR1 missing internal quality resource ${required}`);
if (JSON.stringify(uir1.expected_leaf_sequence) !== JSON.stringify(["taste-workflow","baseline-ui","micro-craft"]))
  throw new Error("UIR1 must express the internal quality phase sequence");

const uir4 = ownership.find((row) => row.id === "UIR4");
if (uir4.expected_skill !== "impeccable" || uir4.expected_owner !== "impeccable")
  throw new Error("UIR4 must preserve explicit Impeccable ownership");

const uir6 = ownership.find((row) => row.id === "UIR6");
if (uir6.expected_skill !== "design-with-ai" || !uir6.expected_resources?.includes(".agents/skills/conversion-pages/SKILL.md"))
  throw new Error("UIR6 must preserve design-with-ai -> conversion-pages visible implementation routing");

const uir10 = ownership.find((row) => row.id === "UIR10");
if ((uir10.expected_resources ?? []).length !== 0)
  throw new Error("UIR10 unresolved target must stop before workflow references");

const regressionLines = readFileSync(regressionPath, "utf8").split(/\r?\n/).filter(Boolean);
const regressionRows = regressionLines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`${regressionPath}:${index + 1}: ${error.message}`);
  }
});
const regressionIds = new Set(regressionRows.map((row) => row.id));
if (!regressionIds.has("R5")) throw new Error("missing consolidation regression R5");
if (!regressionIds.has("R6")) throw new Error("missing repository-injection regression R6");
if (!regressionIds.has("R7")) throw new Error("missing competing-skill classification regression R7");
const lock = JSON.parse(readFileSync(regressionLockPath, "utf8"));
const lockById = new Map(lock.map((entry) => [entry.id, entry.sha256]));
for (let i = 0; i < regressionRows.length; i += 1) {
  const id = regressionRows[i].id;
  const expected = lockById.get(id);
  if (!expected) throw new Error(`regression lock missing ${id}`);
  const actual = sha256(regressionLines[i]);
  if (actual !== expected)
    throw new Error(`regression lock mismatch for ${id}: expected ${expected}, got ${actual}`);
}

if (checkIndex) {
  const indexPath = resolve(root, "knowledge/index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  for (const name of retired) {
    const stale = index.entries?.find((entry) => entry.id === `agents/${name}` && entry.status === "active");
    if (stale) throw new Error(`generated knowledge index still exposes retired skill: ${stale.id}`);
  }
  const canonical = index.entries?.find((entry) => entry.id === "agents/design-with-ai" && entry.status === "active");
  if (!canonical) throw new Error("generated knowledge index missing active agents/design-with-ai");
}

const report = `# Remaining functional overlap candidates\n\nGenerated by \`scripts/verify-skill-routing.mjs\`.\n\n## High priority\n\n- \`github-delivery\`, \`review\`, \`pre-ship-review\`, and \`security-review\`: review policy and evidence rules remain duplicated across lifecycle and leaf skills.\n- \`ceo\` and \`codex-dynamic-workflows\`: both may claim complex orchestration; host-specific execution must remain subordinate to one policy owner.\n\n## Medium priority\n\n- \`code-simplification\` and \`ponytail-review\`: preserve a read-only diagnosis versus mutation boundary.\n- \`vault-research\` and \`source-driven-development\`: preserve durable knowledge maintenance versus task-local source grounding.\n\n## Resolved\n\n- General visible UI, taste, baseline polish, micro craft, UI prompting, motion craft, runtime animation performance, motion vocabulary, bounded product-UI data visualization, native/mobile UI guidance, and design-guidance retrieval are canonical in \`design-with-ai\`.\n- The seven former UI leaf skills are retired as discovery surfaces.\n- \`impeccable\` remains an independently managed explicit/delegated specialist and is not vendored into \`design-with-ai\`.\n- Module/API interface design remains canonical in \`codebase-design\`.\n`;
writeFileSync(reportPath, report);
console.log(`validated ${cases.length} design-with-ai routing cases, ${ownership.length} UI ownership cases, ${regressionRows.length} locked regressions, retired live-reference handoffs, cluster-aware source/render/fused/receipt/cross-surface taste-gate ownership, source/render calibration, closed evidence provenance, and read-only release governance, motion-vocabulary ownership, and bounded design-guidance ownership${checkIndex ? ", plus generated index" : ""}`);
