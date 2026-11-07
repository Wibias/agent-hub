#!/usr/bin/env node
// Real Chrome/CDP smoke against a reviewed, pinned upstream checkout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQualityAudit } from "../../scripts/providers/quality-audit.mjs";

const skillRoot = process.env.TASTE_SKILL_ROOT;
if (!skillRoot) {
  process.stderr.write("TASTE_SKILL_ROOT must point to the reviewed Taste Skill 2.5.0 checkout\n");
  process.exit(2);
}
const root = mkdtempSync(join(tmpdir(), "dwa-browser-live-"));
const built = join(root, "dist");
mkdirSync(join(built, "settings"), { recursive: true });
const page = join(built, "settings", "index.html");
const stylesheet = join(built, "settings", "fixture.css");
// Exercise the combined Impeccable DESIGN.md path as well as its
// completed-source-file receipt in the real three-provider smoke.
writeFileSync(join(root, "DESIGN.md"),
  "---\ntypography:\n  body:\n    fontFamily: Arial\n---\n");
// The stylesheet is served with the fixture and is the static source target.
// This exercises a complete vendored CSS scan without optional HTML parsers.
writeFileSync(stylesheet, [
  ":root { color-scheme: light; font-family: Arial, sans-serif }",
  "* { box-sizing: border-box }",
  "body { margin: 0; background: #fafafa; color: #171717 }",
  "header { padding: 24px clamp(16px, 5vw, 70px); border-bottom: 1px solid #ddd }",
  "nav { display: flex; gap: 24px; flex-wrap: wrap }",
  "a { color: #165890 }",
  "main { max-width: 1040px; margin: 0 auto; padding: 28px 20px 100px }",
  "section { padding: 20px 0 52px }",
  "h1 { font-size: clamp(30px, 4vw, 46px); margin: 0 0 12px }",
  "h2 { font-size: 24px } p { max-width: 58ch; line-height: 1.55 }",
  "label { display: block; margin: 16px 0 4px }",
  "input { display: block; width: min(100%, 460px); padding: 12px; border: 1px solid #999 }",
  "button { margin-top: 20px; padding: 12px 20px; border: 0; background: #194d86; color: white }",
  "footer { padding: 28px 20px; border-top: 1px solid #ccc }",
].join("\n"));
writeFileSync(page, [
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
  "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
  "<title>Account Settings - Browser Verification Fixture</title>",
  "<link rel=\"stylesheet\" href=\"./fixture.css\"></head><body>",
  "<header><nav aria-label=\"Primary\"><a href=\"#settings\">Settings</a>",
  "<a href=\"#activity\">Activity</a><a href=\"#help\">Help</a></nav></header>",
  "<main><section id=\"settings\"><h1>Account settings</h1>",
  "<p>Review your preferences and update your contact information.</p>",
  "<form><label for=\"email\">Email address</label>",
  "<input type=\"email\" id=\"email\" value=\"person@example.test\" autocomplete=\"email\">",
  "<label for=\"name\">Display name</label>",
  "<input id=\"name\" value=\"Test account\"><button type=\"button\">Save changes</button></form>",
  "</section><section id=\"activity\"><h2>Recent activity</h2>",
  "<p>Account updated on Monday.</p></section>",
  "<section id=\"help\"><h2>Need help?</h2>",
  "<p>Contact support from your account dashboard.</p></section>",
  "</main><footer>Browser fixture: no external assets or scripts</footer>",
  "</body></html>",
].join("\n"));

try {
  const result = await runQualityAudit([
    "--profile", "deep",
    "--path", stylesheet, "--project-root", root,
    "--route", "/settings", "--output-root", root,
    "--require-taste", "--html", page, "--browser-root", built, "--taste-root", skillRoot,
    "--page-kind", "software", "--category", "Account settings",
    "--primary", "Save changes",
  ]);
  const statuses = result.coverage.statuses;
  const failures = statuses.filter((s) => !["PASS", "FINDINGS"].includes(s.status));
  if (failures.length) {
    throw new Error("Incomplete real browser/provider evidence: " +
      JSON.stringify({ failures, artifacts: result.artifacts }));
  }
  assert.deepEqual(statuses.map((s) => s.provider),
    ["impeccable", "native-dwa", "taste-skill"]);
  assert.equal(result.coverage.complete, true);
  assert.ok(["SCOPED_CLEAR", "REVIEW", "BLOCKED"].includes(result.status));
  assert.equal(result.completionEligible, false);
  // Joint integration assertions: an upstream success is only a scoped
  // completed scan, not a verified game state or permission to ship.
  const readArtifact = (file) => JSON.parse(readFileSync(file, "utf8"));
  const impeccable = readArtifact(result.artifacts.reports.impeccable);
  const taste = readArtifact(result.artifacts.reports["taste-skill"]);
  const fusion = readArtifact(result.artifacts.fusion);
  const scope = readArtifact(result.artifacts.sourceScope);
  // The real fixture's DESIGN.md lives outside the selected CSS file. Its
  // policy hash must still be bound to the shared source-fingerprint receipt.
  assert.ok(scope.detectorContext?.some((dependency) =>
    dependency.path === "DESIGN.md" &&
    /^[a-f0-9]{64}$/.test(dependency.sha256)), "External DESIGN.md dependency missing from source fingerprint");
  // The CSS file is served to Chrome and must also be bound to the shared
  // fingerprint, even though the source target is just that stylesheet.
  assert.equal(scope.rendered.assetCoverage, "COMPLETE_LOCAL_TREE_BOUNDED");
  assert.equal(scope.renderedAssets.fileCount, 2);
  assert.deepEqual(scope.renderedAssets.files.map((x) => x.path),
    ["dist/settings/fixture.css", "dist/settings/index.html"]);
  const linkedCss = scope.renderedAssets.files.find((x) =>
    x.path === "dist/settings/fixture.css");
  assert.equal(linkedCss.sha256,
    createHash("sha256").update(readFileSync(stylesheet)).digest("hex"));
  assert.equal(scope.rendered.assetTreeSha256, scope.renderedAssets.filesSha256);
  assert.equal(taste.auditScope.rendered.assetTreeSha256,
    scope.rendered.assetTreeSha256);
  assert.equal(fusion.scope.rendered.assetTreeSha256,
    scope.rendered.assetTreeSha256);
  assert.equal(impeccable.auditScope.sourceSha256, result.scope.sourceSha256);
  assert.equal(taste.auditScope.sourceSha256, result.scope.sourceSha256);
  assert.equal(impeccable.summary.coverageCountVerified, true);
  assert.equal(impeccable.summary.filesScanned, 1);
  assert.equal(impeccable.summary.degradedFiles, 0);
  assert.equal(impeccable.summary.designSystemEnabled, true);
  assert.equal(taste.summary.renderedStateVerified, false);
  assert.equal(taste.summary.renderedStateProof, "NOT_PROVIDED_BY_UPSTREAM");
  assert.equal(taste.summary.productCompletionEligible, false);
  const classes = [
    "POTENTIAL_USABILITY", "GEOMETRY_NEEDS_VISUAL_REVIEW",
    "CONTEXTUAL_HOUSE_RULE", "UNCLASSIFIED_HEURISTIC",
  ];
  assert.equal(classes.reduce((n, id) => {
    const count = taste.summary.reviewClassCounts[id];
    assert.ok(Number.isSafeInteger(count) && count >= 0);
    return n + count;
  }, 0), taste.findings.length);
  const tasteSummary = fusion.reports.find((r) => r.provider === "taste-skill");
  assert.ok(tasteSummary);
  assert.deepEqual(tasteSummary.reviewClassCounts, taste.summary.reviewClassCounts);
  assert.equal(tasteSummary.renderedStateVerified, false);
  assert.equal(tasteSummary.renderedStateProof, "NOT_PROVIDED_BY_UPSTREAM");
  const rawById = new Map(taste.findings.map((f) => [f.id, f]));
  const fusedTaste = fusion.groups.flatMap((g) => g.members)
    .filter((member) => member.provider === "taste-skill");
  assert.equal(fusedTaste.length, taste.findings.length);
  for (const member of fusedTaste) {
    const original = rawById.get(member.id);
    assert.ok(original, "A fused Taste finding must match a raw observation");
    assert.equal(member.reviewClass, original.reviewClass);
    assert.equal(member.upstreamSeverity, original.upstreamSeverity);
    assert.equal(member.priority, original.priority);
  }
  assert.equal(fusion.completionEligible, false);
  process.stdout.write(JSON.stringify({
    status: result.status, coverage: statuses,
    artifactDirectory: result.artifacts.directory,
    browser: "real Chrome / upstream consistency.mjs, 1440/768/390",
    productCompletionEligible: false,
    integratedEvidence: {
      impeccableFilesScanned: impeccable.summary.filesScanned,
      impeccableCoverageVerified: impeccable.summary.coverageCountVerified,
      boundDesignDependencies: scope.detectorContext?.map((x) => x.path) ?? [],
      renderedAssetCount: scope.renderedAssets.fileCount,
      renderedAssetDigest: scope.rendered.assetTreeSha256,
      tasteRawObservations: taste.findings.length,
      tasteFusedObservations: fusedTaste.length,
      tasteReviewClassCounts: taste.summary.reviewClassCounts,
      tasteRenderedStateVerified: tasteSummary.renderedStateVerified,
      allProviderEvidenceProductCompletionEligible: fusion.completionEligible,
    },
  }, null, 2) + "\n");
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
