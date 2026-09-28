import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const analyzer = resolve(here, "../scripts/render-taste-gate.mjs");
const collector = resolve(here, "../scripts/render-snapshot.js");

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-21T00:00:00.000Z",
    url: "http://localhost/example",
    title: "Example",
    viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
    surface: { rootTag: "main", sectionCount: 3, firstBlock: null },
    headings: [],
    kickers: [],
    numberedMeta: [],
    siblingGroups: [],
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
      topNav: {
        present: false,
        plainActionCount: 0,
        filledActionCount: 0,
        totalActionCount: 0,
      },
      footer: {
        present: false,
        columnCount: 0,
      },
      defaultActionPairs: {
        count: 0,
        sectionCount: 0,
      },
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
    surfaceMetrics: {
      cardCount: 0,
      ghostCardCount: 0,
      ghostCardRatio: 0,
    },
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

function run(value) {
  const dir = mkdtempSync(join(tmpdir(), "render-taste-"));
  const file = join(dir, "snapshot.json");
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  const result = spawnSync(process.execPath, [analyzer, "--snapshot", file, "--json"], { encoding: "utf8" });
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch { throw new Error(`Invalid JSON from render taste gate. stdout=${result.stdout}\nstderr=${result.stderr}`); }
  rmSync(dir, { recursive: true, force: true });
  return { ...result, parsed };
}

test("browser collector is dependency-free JavaScript that compiles", () => {
  const source = readFileSync(collector, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /schemaVersion\s*=\s*1/);
  assert.match(source, /getBoundingClientRect/);
  assert.doesNotMatch(source, /document\.(write|execCommand)/);
});

test("clean render snapshot passes mechanical rendered evidence", () => {
  const result = run(snapshot());
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "PASS_RENDER_EVIDENCE");
  assert.equal(result.parsed.hits.length, 0);
});

test("centered viewport hero is one contextual rendered lead, not HOLD", () => {
  const result = run(snapshot({
    surface: {
      rootTag: "main",
      sectionCount: 2,
      firstBlock: {
        sectionIndex: 0,
        heightRatio: 0.95,
        centeredHeading: true,
        headingText: "Ship faster",
        actionCount: 2,
        kickerCount: 1,
      },
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER");
  assert.deepEqual(result.parsed.hits.map((hit) => hit.id), ["G03"]);
});

test("exactly three equal structural children produce G04 evidence", () => {
  const result = run(snapshot({
    siblingGroups: [{
      count: 3,
      sectionIndex: 1,
      equalSizeScore: 0.97,
      sameStructure: true,
      childKeys: ["article|h3,p|1h|0a|1i","article|h3,p|1h|0a|1i","article|h3,p|1h|0a|1i"],
      childRects: [],
    }],
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER");
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G04"));
});

test("real ordered numbering does not produce decorative G28 evidence", () => {
  const items = [
    { text: "01 CONNECT", sectionIndex: 0, insideOrderedList: true },
    { text: "02 CHOOSE", sectionIndex: 1, insideOrderedList: true },
    { text: "03 FINISH", sectionIndex: 2, insideOrderedList: true },
  ];
  const result = run(snapshot({ kickers: items, numberedMeta: items }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G28"));
});

test("repeated decorative numbered kickers stay one semantic family", () => {
  const items = [
    { text: "01 QUICK TUNNELS", sectionIndex: 0, insideOrderedList: false },
    { text: "02 INSTANT LINKS", sectionIndex: 1, insideOrderedList: false },
    { text: "03 ZERO SETUP", sectionIndex: 2, insideOrderedList: false },
  ];
  const result = run(snapshot({ kickers: items, numberedMeta: items }));
  assert.equal(result.status, 0);
  const ids = result.parsed.hits.map((hit) => hit.id).sort();
  assert.deepEqual(ids, ["G27", "G28"]);
  assert.equal(result.parsed.cluster.independentFamilies, 1);
  assert.equal(result.parsed.cluster.families[0].family, "section-chrome");
});

test("independent rendered structure families can trigger a review cluster", () => {
  const kickers = [
    { text: "01 BUILD", sectionIndex: 0, insideOrderedList: false },
    { text: "02 SHIP", sectionIndex: 1, insideOrderedList: false },
    { text: "03 SCALE", sectionIndex: 2, insideOrderedList: false },
  ];
  const result = run(snapshot({
    surface: {
      rootTag: "main",
      sectionCount: 4,
      firstBlock: {
        sectionIndex: 0,
        heightRatio: 0.93,
        centeredHeading: true,
        headingText: "Build anything",
        actionCount: 2,
        kickerCount: 1,
      },
    },
    kickers,
    numberedMeta: kickers,
    siblingGroups: [{
      count: 3,
      sectionIndex: 1,
      equalSizeScore: 0.96,
      sameStructure: true,
      childKeys: ["article","article","article"],
      childRects: [],
    }],
    headings: [
      { text: "Build anything", inFirstViewport: true, fontSize: 56 },
      { text: "Everything you need", inFirstViewport: true, fontSize: 50 },
    ],
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER_CLUSTER");
  assert.ok(result.parsed.cluster.independentFamilies >= 3);
  assert.ok(result.parsed.cluster.score >= result.parsed.cluster.minimumScore);
});

test("nested containment produces contextual G05 evidence", () => {
  const result = run(snapshot({
    cardMetrics: { candidateCount: 8, nestedCardCount: 3, maxDepth: 2 },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G05"));
});

test("large radii across most card-like surfaces produce contextual G31 evidence", () => {
  const result = run(snapshot({
    radiusMetrics: {
      cardCount: 6,
      largeRadiusCardCount: 5,
      largeRadiusRatio: 0.83,
      medianCardRadius: 24,
      sectionCount: 2,
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER");
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G31"));
});

test("a few intentionally rounded surfaces do not trigger G31 by count alone", () => {
  const result = run(snapshot({
    radiusMetrics: {
      cardCount: 8,
      largeRadiusCardCount: 2,
      largeRadiusRatio: 0.25,
      medianCardRadius: 12,
      sectionCount: 1,
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G31"));
});

test("repeated non-interactive icon tiles produce contextual G64 evidence", () => {
  const result = run(snapshot({
    iconMetrics: {
      smallSvgCount: 5,
      iconTileCount: 4,
      iconTileSectionCount: 1,
      iconBearingCardCount: 3,
      iconBearingCardRatio: 0.5,
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G64"));
});

test("icons across most card-like content blocks produce contextual G72 evidence", () => {
  const result = run(snapshot({
    radiusMetrics: {
      cardCount: 6,
      largeRadiusCardCount: 0,
      largeRadiusRatio: 0,
      medianCardRadius: 8,
      sectionCount: 0,
    },
    iconMetrics: {
      smallSvgCount: 9,
      iconTileCount: 0,
      iconTileSectionCount: 0,
      iconBearingCardCount: 5,
      iconBearingCardRatio: 0.83,
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G72"));
});

test("radius, icon-tile, and icon-wallpaper leads remain separate contextual families", () => {
  const result = run(snapshot({
    radiusMetrics: {
      cardCount: 6,
      largeRadiusCardCount: 6,
      largeRadiusRatio: 1,
      medianCardRadius: 28,
      sectionCount: 2,
    },
    iconMetrics: {
      smallSvgCount: 10,
      iconTileCount: 5,
      iconTileSectionCount: 2,
      iconBearingCardCount: 5,
      iconBearingCardRatio: 0.83,
    },
  }));
  assert.equal(result.status, 0);
  const ids = result.parsed.hits.map((hit) => hit.id);
  for (const id of ["G31", "G64", "G72"]) assert.ok(ids.includes(id));
  assert.equal(result.parsed.cluster.independentFamilies, 3);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER");
});

test("chrome-density families can join a stronger structural lead to trigger a render cluster", () => {
  const result = run(snapshot({
    siblingGroups: [{
      count: 3,
      sectionIndex: 1,
      equalSizeScore: 0.97,
      sameStructure: true,
      childKeys: ["article","article","article"],
      childRects: [],
    }],
    radiusMetrics: {
      cardCount: 6,
      largeRadiusCardCount: 6,
      largeRadiusRatio: 1,
      medianCardRadius: 28,
      sectionCount: 2,
    },
    iconMetrics: {
      smallSvgCount: 10,
      iconTileCount: 5,
      iconTileSectionCount: 2,
      iconBearingCardCount: 5,
      iconBearingCardRatio: 0.83,
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER_CLUSTER");
  assert.ok(result.parsed.cluster.independentFamilies >= 4);
  assert.ok(result.parsed.cluster.score >= result.parsed.cluster.minimumScore);
});

test("generic top navigation pattern produces contextual G07 evidence", () => {
  const result = run(snapshot({
    shellMetrics: {
      topNav: {
        present: true,
        plainActionCount: 5,
        filledActionCount: 1,
        totalActionCount: 6,
      },
      footer: { present: false, columnCount: 0 },
      defaultActionPairs: { count: 0, sectionCount: 0 },
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G07"));
});

test("small task navigation does not trigger G07 merely for having one filled action", () => {
  const result = run(snapshot({
    shellMetrics: {
      topNav: {
        present: true,
        plainActionCount: 2,
        filledActionCount: 1,
        totalActionCount: 3,
      },
      footer: { present: false, columnCount: 0 },
      defaultActionPairs: { count: 0, sectionCount: 0 },
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G07"));
});

test("generic multi-column footer produces contextual G08 evidence", () => {
  const result = run(snapshot({
    shellMetrics: {
      topNav: {
        present: false,
        plainActionCount: 0,
        filledActionCount: 0,
        totalActionCount: 0,
      },
      footer: { present: true, columnCount: 4 },
      defaultActionPairs: { count: 0, sectionCount: 0 },
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G08"));
});

test("one filled plus outline CTA pair does not trigger G65 by itself", () => {
  const result = run(snapshot({
    shellMetrics: {
      topNav: {
        present: false,
        plainActionCount: 0,
        filledActionCount: 0,
        totalActionCount: 0,
      },
      footer: { present: false, columnCount: 0 },
      defaultActionPairs: { count: 1, sectionCount: 1 },
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G65"));
});

test("repeated filled plus outline CTA pairs across sections produce contextual G65 evidence", () => {
  const result = run(snapshot({
    shellMetrics: {
      topNav: {
        present: false,
        plainActionCount: 0,
        filledActionCount: 0,
        totalActionCount: 0,
      },
      footer: { present: false, columnCount: 0 },
      defaultActionPairs: { count: 3, sectionCount: 3 },
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G65"));
});

test("shell-pattern leads alone remain a contextual review rather than a cluster", () => {
  const result = run(snapshot({
    shellMetrics: {
      topNav: {
        present: true,
        plainActionCount: 5,
        filledActionCount: 1,
        totalActionCount: 6,
      },
      footer: { present: true, columnCount: 4 },
      defaultActionPairs: { count: 3, sectionCount: 3 },
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER");
  assert.equal(result.parsed.cluster.independentFamilies, 3);
  assert.equal(result.parsed.cluster.score, 3);
});

test("shell-pattern leads can join a stronger structural lead to trigger a render cluster", () => {
  const result = run(snapshot({
    siblingGroups: [{
      count: 3,
      sectionIndex: 1,
      equalSizeScore: 0.97,
      sameStructure: true,
      childKeys: ["article","article","article"],
      childRects: [],
    }],
    shellMetrics: {
      topNav: {
        present: true,
        plainActionCount: 5,
        filledActionCount: 1,
        totalActionCount: 6,
      },
      footer: { present: true, columnCount: 4 },
      defaultActionPairs: { count: 3, sectionCount: 3 },
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER_CLUSTER");
  assert.ok(result.parsed.cluster.independentFamilies >= 4);
  assert.ok(result.parsed.cluster.score >= result.parsed.cluster.minimumScore);
});

test("full rendered SaaS meta-template produces contextual G63 evidence", () => {
  const result = run(snapshot({
    marketingMetrics: {
      centeredHero: true,
      repeatedThreeSection: true,
      pricingHeadingCount: 1,
      priceLikeCount: 3,
      faqHeadingCount: 1,
      visibleDetailsCount: 5,
      closingActionZoneCount: 1,
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER");
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G63"));
});

test("pricing and FAQ alone do not produce G63 without the macro skeleton", () => {
  const result = run(snapshot({
    marketingMetrics: {
      centeredHero: false,
      repeatedThreeSection: false,
      pricingHeadingCount: 1,
      priceLikeCount: 3,
      faqHeadingCount: 1,
      visibleDetailsCount: 5,
      closingActionZoneCount: 1,
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G63"));
});

test("G63 can combine with independent shell families to trigger a render cluster", () => {
  const result = run(snapshot({
    marketingMetrics: {
      centeredHero: true,
      repeatedThreeSection: true,
      pricingHeadingCount: 1,
      priceLikeCount: 3,
      faqHeadingCount: 1,
      visibleDetailsCount: 5,
      closingActionZoneCount: 1,
    },
    shellMetrics: {
      topNav: {
        present: true,
        plainActionCount: 5,
        filledActionCount: 1,
        totalActionCount: 6,
      },
      footer: {
        present: true,
        columnCount: 4,
      },
      defaultActionPairs: {
        count: 0,
        sectionCount: 0,
      },
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER_CLUSTER");
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G63"));
  assert.ok(result.parsed.cluster.independentFamilies >= 3);
  assert.ok(result.parsed.cluster.score >= result.parsed.cluster.minimumScore);
});

test("border plus soft shadow across many cards produces contextual G30 evidence", () => {
  const result = run(snapshot({
    surfaceMetrics: {
      cardCount: 6,
      ghostCardCount: 4,
      ghostCardRatio: 0.67,
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G30"));
});

test("isolated bordered shadow card does not trigger G30", () => {
  const result = run(snapshot({
    surfaceMetrics: {
      cardCount: 6,
      ghostCardCount: 1,
      ghostCardRatio: 0.17,
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G30"));
});

test("flat section spacing across a long page produces contextual G55 evidence", () => {
  const result = run(snapshot({
    rhythmMetrics: {
      sectionCount: 6,
      gapCount: 5,
      dominantGap: 64,
      dominantGapCount: 4,
      dominantGapRatio: 0.8,
      dividerSectionCount: 4,
      dividerSectionRatio: 0.67,
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G55"));
});

test("short pages do not trigger G55 from repeated spacing alone", () => {
  const result = run(snapshot({
    rhythmMetrics: {
      sectionCount: 3,
      gapCount: 2,
      dominantGap: 64,
      dominantGapCount: 2,
      dominantGapRatio: 1,
      dividerSectionCount: 0,
      dividerSectionRatio: 0,
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G55"));
});

test("weak elevation and rhythm leads alone stay below the render cluster threshold", () => {
  const result = run(snapshot({
    surfaceMetrics: {
      cardCount: 6,
      ghostCardCount: 4,
      ghostCardRatio: 0.67,
    },
    rhythmMetrics: {
      sectionCount: 6,
      gapCount: 5,
      dominantGap: 64,
      dominantGapCount: 4,
      dominantGapRatio: 0.8,
      dividerSectionCount: 4,
      dividerSectionRatio: 0.67,
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER");
  assert.equal(result.parsed.cluster.score, 2);
});

test("elevation and rhythm can join stronger independent defaults to trigger a render cluster", () => {
  const result = run(snapshot({
    siblingGroups: [{
      count: 3,
      sectionIndex: 1,
      equalSizeScore: 0.97,
      sameStructure: true,
      childKeys: ["article","article","article"],
      childRects: [],
    }],
    radiusMetrics: {
      cardCount: 6,
      largeRadiusCardCount: 5,
      largeRadiusRatio: 0.83,
      medianCardRadius: 24,
      sectionCount: 2,
    },
    surfaceMetrics: {
      cardCount: 6,
      ghostCardCount: 4,
      ghostCardRatio: 0.67,
    },
    rhythmMetrics: {
      sectionCount: 6,
      gapCount: 5,
      dominantGap: 64,
      dominantGapCount: 4,
      dominantGapRatio: 0.8,
      dividerSectionCount: 4,
      dividerSectionRatio: 0.67,
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER_CLUSTER");
  for (const id of ["G04","G30","G31","G55"]) {
    assert.ok(result.parsed.hits.some((hit) => hit.id === id));
  }
  assert.ok(result.parsed.cluster.score >= result.parsed.cluster.minimumScore);
});

test("one fully overloaded card produces contextual G66 evidence", () => {
  const result = run(snapshot({
    cardCompositionMetrics: {
      cardCount: 3,
      denseCardCount: 1,
      fullKitchenSinkCardCount: 1,
      maxAdornmentKinds: 5,
      cards: [{
        facetCount: 5,
        facets: { icon: true, pills: true, price: true, status: true, action: true },
        iconCount: 1,
        pillCount: 2,
        actionCount: 1,
        statusCount: 1,
        priceLike: true,
      }],
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER");
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G66"));
});

test("one rich card with only four adornment kinds does not trigger G66 by itself", () => {
  const result = run(snapshot({
    cardCompositionMetrics: {
      cardCount: 4,
      denseCardCount: 1,
      fullKitchenSinkCardCount: 0,
      maxAdornmentKinds: 4,
      cards: [{ facetCount: 4 }],
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G66"));
});

test("repeated four-facet cards produce contextual G66 evidence", () => {
  const result = run(snapshot({
    cardCompositionMetrics: {
      cardCount: 4,
      denseCardCount: 2,
      fullKitchenSinkCardCount: 0,
      maxAdornmentKinds: 4,
      cards: [{ facetCount: 4 }, { facetCount: 4 }],
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(result.parsed.hits.some((hit) => hit.id === "G66"));
});

test("simple pricing cards with price and action only do not trigger G66", () => {
  const result = run(snapshot({
    cardCompositionMetrics: {
      cardCount: 3,
      denseCardCount: 0,
      fullKitchenSinkCardCount: 0,
      maxAdornmentKinds: 2,
      cards: [
        { facetCount: 2, facets: { icon: false, pills: false, price: true, status: false, action: true } },
        { facetCount: 2, facets: { icon: false, pills: false, price: true, status: false, action: true } },
      ],
    },
  }));
  assert.equal(result.status, 0);
  assert.ok(!result.parsed.hits.some((hit) => hit.id === "G66"));
});

test("G66 can join independent structure and radius families to trigger a render cluster", () => {
  const result = run(snapshot({
    siblingGroups: [{
      count: 3,
      sectionIndex: 1,
      equalSizeScore: 0.97,
      sameStructure: true,
      childKeys: ["article","article","article"],
      childRects: [],
    }],
    radiusMetrics: {
      cardCount: 6,
      largeRadiusCardCount: 5,
      largeRadiusRatio: 0.83,
      medianCardRadius: 24,
      sectionCount: 2,
    },
    cardCompositionMetrics: {
      cardCount: 6,
      denseCardCount: 2,
      fullKitchenSinkCardCount: 0,
      maxAdornmentKinds: 4,
      cards: [{ facetCount: 4 }, { facetCount: 4 }],
    },
  }));
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_RENDER_CLUSTER");
  for (const id of ["G04","G31","G66"]) {
    assert.ok(result.parsed.hits.some((hit) => hit.id === id));
  }
  assert.ok(result.parsed.cluster.score >= result.parsed.cluster.minimumScore);
});

test("invalid render snapshot fails closed with exit 2", () => {
  const result = run({ schemaVersion: 999 });
  assert.equal(result.status, 2);
  assert.match(result.parsed.error, /schemaVersion/);
});
