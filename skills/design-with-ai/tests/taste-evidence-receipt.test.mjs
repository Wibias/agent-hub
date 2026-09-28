import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const receipt = resolve(here, "../scripts/taste-evidence-receipt.mjs");

function cleanSnapshot({ url = "http://localhost/example", ...overrides } = {}) {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-21T00:00:00.000Z",
    url,
    title: "Example",
    viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
    surface: { rootTag: "main", sectionCount: 3, firstBlock: null },
    headings: [],
    kickers: [],
    numberedMeta: [],
    siblingGroups: [],
    macroZones: [
      { index: 0, archetype: "content", widthBand: "wide", repeatedCounts: [], actionCount: 0 },
      { index: 1, archetype: "content", widthBand: "wide", repeatedCounts: [], actionCount: 0 },
      { index: 2, archetype: "content", widthBand: "wide", repeatedCounts: [], actionCount: 0 },
    ],
    macroFingerprint: "content:wide|content:wide|content:wide",
    cardMetrics: { candidateCount: 0, nestedCardCount: 0, maxDepth: 0 },
    radiusMetrics: {
      cardCount: 0,
      largeRadiusCardCount: 0,
      largeRadiusRatio: 0,
      medianCardRadius: 0,
      sectionCount: 0,
    },
    iconMetrics: {
      smallSvgCount: 0,
      iconTileCount: 0,
      iconTileSectionCount: 0,
      iconBearingCardCount: 0,
      iconBearingCardRatio: 0,
    },
    shellMetrics: {
      topNav: { present: false, plainActionCount: 0, filledActionCount: 0, totalActionCount: 0 },
      footer: { present: false, columnCount: 0 },
      defaultActionPairs: { count: 0, sectionCount: 0 },
    },
    marketingMetrics: {
      centeredHero: false,
      repeatedThreeSection: false,
      pricingHeadingCount: 0,
      priceLikeCount: 0,
      faqHeadingCount: 0,
      visibleDetailsCount: 0,
      closingActionZoneCount: 0,
    },
    surfaceMetrics: { cardCount: 0, ghostCardCount: 0, ghostCardRatio: 0 },
    cardCompositionMetrics: {
      cardCount: 0,
      denseCardCount: 0,
      fullKitchenSinkCardCount: 0,
      maxAdornmentKinds: 0,
      cards: [],
    },
    rhythmMetrics: {
      sectionCount: 0,
      gapCount: 0,
      dominantGap: 0,
      dominantGapCount: 0,
      dominantGapRatio: 0,
      dividerSectionCount: 0,
      dividerSectionRatio: 0,
    },
    ...overrides,
  };
}

function parseResult(result, dir) {
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Invalid JSON from receipt runner. stdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  rmSync(dir, { recursive: true, force: true });
  return { ...result, parsed };
}

function runSingle({ source, snapshot = null, route = null, extraArgs = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "taste-receipt-single-"));
  const sourcePath = join(dir, "surface.tsx");
  writeFileSync(sourcePath, source, "utf8");

  const args = [receipt, "--path", sourcePath, "--json", ...extraArgs];
  if (snapshot) {
    const snapshotPath = join(dir, "snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
    args.push("--snapshot", snapshotPath);
  }
  if (route) args.push("--route", route);

  return parseResult(spawnSync(process.execPath, args, { encoding: "utf8" }), dir);
}

function runManifest({ candidates, cross = null }) {
  const dir = mkdtempSync(join(tmpdir(), "taste-receipt-manifest-"));
  const manifestCandidates = [];
  const snapshotRecords = [];

  for (const candidate of candidates) {
    const sourceName = `${candidate.id}.tsx`;
    writeFileSync(join(dir, sourceName), candidate.source, "utf8");
    const row = { id: candidate.id, path: sourceName };

    if (candidate.snapshot) {
      const snapshotName = `${candidate.id}.snapshot.json`;
      const snapshotPath = join(dir, snapshotName);
      writeFileSync(snapshotPath, JSON.stringify(candidate.snapshot, null, 2), "utf8");
      row.snapshot = snapshotName;
      row.route = candidate.route;
      snapshotRecords.push({
        id: candidate.id,
        route: candidate.route,
        path: snapshotPath,
        snapshot: candidate.snapshot,
      });
    }
    manifestCandidates.push(row);
  }

  let crossPath = null;
  if (cross) {
    crossPath = join(dir, "cross.json");
    const value = typeof cross === "function" ? cross(snapshotRecords) : cross;
    writeFileSync(crossPath, JSON.stringify(value, null, 2), "utf8");
  }

  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    candidates: manifestCandidates,
  }, null, 2), "utf8");

  const args = [receipt, "--manifest", manifestPath, "--json"];
  if (crossPath) args.push("--cross-surface-report", crossPath);
  return parseResult(spawnSync(process.execPath, args, { encoding: "utf8" }), dir);
}

test("source-only clear receipt labels rendered DOM evidence not measured", () => {
  const result = runSingle({
    source: "export default function Example(){ return <main>Plain product content</main>; }",
  });
  assert.equal(result.status, 0);
  assert.equal(result.parsed.state, "SOURCE_CLEAR_RENDER_NOT_MEASURED");
  assert.equal(result.parsed.coverage.source, "measured");
  assert.equal(result.parsed.coverage.render, "not_measured");
  assert.equal(result.parsed.review.renderedMeasurementMissing, true);
  assert.equal(result.parsed.binding.verified, false);
  assert.match(result.parsed.note, /not a visual quality verdict/i);
});

test("source hard gate remains blocking even without rendered evidence", () => {
  const result = runSingle({
    source: "export default function Example(){ return <div className='transition-all'>Unsafe</div>; }",
  });
  assert.equal(result.status, 1);
  assert.equal(result.parsed.state, "BLOCKED_SOURCE_HARD_GATE");
  assert.equal(result.parsed.blocking.active, true);
  assert.equal(result.parsed.blocking.channel, "source");
  assert.equal(result.parsed.verdicts.source, "HOLD");
});

test("rendered single-candidate receipt requires an explicit route binding", () => {
  const result = runSingle({
    source: "export default function Example(){ return <main>Plain product content</main>; }",
    snapshot: cleanSnapshot(),
  });
  assert.equal(result.status, 2);
  assert.match(result.parsed.error, /--snapshot requires --route/);
});

test("rendered single-candidate receipt fails closed on route mismatch", () => {
  const result = runSingle({
    source: "export default function Example(){ return <main>Plain product content</main>; }",
    snapshot: cleanSnapshot({ url: "http://localhost/pricing" }),
    route: "/home",
  });
  assert.equal(result.status, 2);
  assert.match(result.parsed.error, /route mismatch/);
});

test("clean source plus route-bound clean render produces clear mechanical evidence", () => {
  const result = runSingle({
    source: "export default function Example(){ return <main>Plain product content</main>; }",
    snapshot: cleanSnapshot({ url: "http://localhost/example?preview=1" }),
    route: "/example/",
  });
  assert.equal(result.status, 0);
  assert.equal(result.parsed.state, "MECHANICAL_EVIDENCE_CLEAR");
  assert.equal(result.parsed.coverage.render, "measured");
  assert.equal(result.parsed.coverage.fusion, "measured");
  assert.equal(result.parsed.verdicts.fused, "PASS_FUSED_EVIDENCE");
  assert.equal(result.parsed.binding.verified, true);
  assert.equal(result.parsed.binding.declaredRoute, "/example");
  assert.equal(result.parsed.binding.snapshotRoute, "/example");
});

test("same route-bound source/render G31 family is fused once and remains contextual", () => {
  const result = runSingle({
    source: "export default function Example(){ return <section className='rounded-2xl'>Card</section>; }",
    snapshot: cleanSnapshot({
      url: "http://localhost/example",
      radiusMetrics: {
        cardCount: 6,
        largeRadiusCardCount: 5,
        largeRadiusRatio: 0.83,
        medianCardRadius: 24,
        sectionCount: 2,
      },
    }),
    route: "/example",
  });
  assert.equal(result.status, 0);
  assert.equal(result.parsed.state, "REVIEW_CONTEXTUAL_EVIDENCE");
  assert.equal(result.parsed.verdicts.fused, "REVIEW_FUSED");
  const family = result.parsed.reports.fused.cluster.families.find((row) => row.family === "surface-radius");
  assert.ok(family);
  assert.equal(family.score, 1);
  assert.deepEqual(family.channels, ["render", "source"]);
});

test("manifest receipt binds two routes and attaches exact cross-surface snapshots separately", () => {
  const result = runManifest({
    candidates: [
      {
        id: "home",
        source: "export default function Home(){ return <main>Home</main>; }",
        route: "/home",
        snapshot: cleanSnapshot({ url: "http://localhost/home" }),
      },
      {
        id: "pricing",
        source: "export default function Pricing(){ return <main>Pricing</main>; }",
        route: "/pricing",
        snapshot: cleanSnapshot({ url: "http://localhost/pricing" }),
      },
    ],
    cross: (snapshots) => ({
      verdict: "REVIEW_CROSS_SURFACE",
      snapshots: snapshots.map((item) => ({
        path: item.path,
        route: item.route,
        viewportBand: "desktop",
        macroFingerprint: item.snapshot.macroFingerprint,
        zoneCount: item.snapshot.macroZones.length,
      })),
      hits: [{ id: "G02", family: "macro-reuse" }],
      comparisons: [{ eligible: true, triggered: true, similarity: 0.93 }],
      note: "contextual",
    }),
  });

  assert.equal(result.status, 0);
  assert.equal(result.parsed.state, "REVIEW_CONTEXTUAL_EVIDENCE");
  assert.equal(result.parsed.coverage.render, "measured");
  assert.equal(result.parsed.coverage.crossSurface, "provided");
  assert.equal(result.parsed.crossSurfaceBinding.verified, true);
  assert.equal(result.parsed.candidates.length, 2);
  assert.ok(result.parsed.candidates.every((candidate) => candidate.binding.verified));
  assert.equal(result.parsed.reports.crossSurface.verdict, "REVIEW_CROSS_SURFACE");
  for (const reports of Object.values(result.parsed.reports.candidates)) {
    assert.equal(reports.fused.cluster.score, 0);
  }
});

test("manifest receipt reports partial rendered coverage instead of rounding up", () => {
  const result = runManifest({
    candidates: [
      {
        id: "home",
        source: "export default function Home(){ return <main>Home</main>; }",
        route: "/home",
        snapshot: cleanSnapshot({ url: "http://localhost/home" }),
      },
      {
        id: "settings",
        source: "export default function Settings(){ return <main>Settings</main>; }",
      },
    ],
  });
  assert.equal(result.status, 0);
  assert.equal(result.parsed.state, "SOURCE_CLEAR_RENDER_NOT_MEASURED");
  assert.equal(result.parsed.coverage.render, "partial");
  assert.equal(result.parsed.coverage.fusion, "partial");
  assert.equal(result.parsed.review.renderedMeasurementMissing, true);
});

test("cross-surface report must cover exactly the route-bound manifest snapshots", () => {
  const result = runManifest({
    candidates: [
      {
        id: "home",
        source: "export default function Home(){ return <main>Home</main>; }",
        route: "/home",
        snapshot: cleanSnapshot({ url: "http://localhost/home" }),
      },
      {
        id: "pricing",
        source: "export default function Pricing(){ return <main>Pricing</main>; }",
        route: "/pricing",
        snapshot: cleanSnapshot({ url: "http://localhost/pricing" }),
      },
    ],
    cross: (snapshots) => ({
      verdict: "PASS_CROSS_SURFACE_EVIDENCE",
      snapshots: [{
        path: snapshots[0].path,
        route: snapshots[0].route,
        viewportBand: "desktop",
        macroFingerprint: snapshots[0].snapshot.macroFingerprint,
        zoneCount: snapshots[0].snapshot.macroZones.length,
      }],
      hits: [],
      comparisons: [],
      note: "incomplete",
    }),
  });
  assert.equal(result.status, 2);
  assert.match(result.parsed.error, /cover exactly the route-bound rendered candidates/);
});

test("invalid cross-surface report fails closed in manifest mode", () => {
  const result = runManifest({
    candidates: [
      {
        id: "home",
        source: "export default function Home(){ return <main>Home</main>; }",
        route: "/home",
        snapshot: cleanSnapshot({ url: "http://localhost/home" }),
      },
      {
        id: "pricing",
        source: "export default function Pricing(){ return <main>Pricing</main>; }",
        route: "/pricing",
        snapshot: cleanSnapshot({ url: "http://localhost/pricing" }),
      },
    ],
    cross: { verdict: "HOLD", snapshots: [], hits: [], comparisons: [] },
  });
  assert.equal(result.status, 2);
  assert.match(result.parsed.error, /Cross-surface report has unsupported verdict/);
});
