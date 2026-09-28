import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const analyzer = resolve(here, "../scripts/compare-render-snapshots.mjs");

function makeSnapshot(url, zones, width = 1440) {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-21T00:00:00.000Z",
    url,
    title: url,
    viewport: { width, height: width <= 767 ? 780 : 900, devicePixelRatio: 1 },
    surface: { rootTag: "main", sectionCount: zones.length, firstBlock: null },
    headings: [],
    kickers: [],
    numberedMeta: [],
    siblingGroups: [],
    macroZones: zones.map((zone, index) => ({
      index,
      archetype: zone.archetype,
      widthBand: zone.widthBand ?? "full",
      repeatedCounts: zone.repeatedCounts ?? [],
    })),
    macroFingerprint: zones.map((zone) =>
      `${zone.archetype}:${zone.widthBand ?? "full"}:${(zone.repeatedCounts ?? []).join(".") || "-"}`
    ).join(">"),
    cardMetrics: { candidateCount: 0, nestedCardCount: 0, maxDepth: 0 },
    iconMetrics: { smallSvgCount: 0 },
  };
}

function run(snapshots) {
  const dir = mkdtempSync(join(tmpdir(), "cross-surface-"));
  const args = [analyzer];
  snapshots.forEach((snapshot, index) => {
    const file = join(dir, `snapshot-${index}.json`);
    writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
    args.push("--snapshot", file);
  });
  args.push("--json");
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid JSON from cross-surface analyzer. stdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  rmSync(dir, { recursive: true, force: true });
  return { ...result, parsed };
}

const reused = [
  { archetype: "hero-centered", widthBand: "full", repeatedCounts: [] },
  { archetype: "repeat-3", widthBand: "wide", repeatedCounts: [3] },
  { archetype: "content-action", widthBand: "wide", repeatedCounts: [] },
  { archetype: "content", widthBand: "full", repeatedCounts: [] },
];

test("different routes with the same non-trivial macro fingerprint produce contextual G02 evidence", () => {
  const result = run([
    makeSnapshot("http://localhost/dashboard", reused),
    makeSnapshot("http://localhost/settings", reused),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_CROSS_SURFACE");
  assert.equal(result.parsed.hits.length, 1);
  assert.equal(result.parsed.hits[0].id, "G02");
  assert.ok(result.parsed.hits[0].similarity >= 0.84);
  assert.doesNotMatch(JSON.stringify(result.parsed), /"HOLD"/);
});

test("same route snapshots are not eligible for cross-route macro reuse", () => {
  const result = run([
    makeSnapshot("http://localhost/dashboard?state=a", reused),
    makeSnapshot("http://localhost/dashboard?state=b", reused),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "PASS_CROSS_SURFACE_EVIDENCE");
  assert.equal(result.parsed.comparisons[0].eligible, false);
});

test("mixed viewport bands are reported but not eligible", () => {
  const result = run([
    makeSnapshot("http://localhost/dashboard", reused, 1440),
    makeSnapshot("http://localhost/settings", reused, 390),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "PASS_CROSS_SURFACE_EVIDENCE");
  assert.equal(result.parsed.comparisons[0].viewportBand, "mixed");
  assert.equal(result.parsed.comparisons[0].eligible, false);
});

test("two-zone surfaces are too small for G02 macro-reuse evidence", () => {
  const short = reused.slice(0, 2);
  const result = run([
    makeSnapshot("http://localhost/a", short),
    makeSnapshot("http://localhost/b", short),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "PASS_CROSS_SURFACE_EVIDENCE");
  assert.equal(result.parsed.comparisons[0].eligible, false);
});

test("materially different macro sequences pass the cross-surface detector", () => {
  const different = [
    { archetype: "content-action", widthBand: "narrow", repeatedCounts: [] },
    { archetype: "repeat-many", widthBand: "full", repeatedCounts: [5] },
    { archetype: "cards", widthBand: "wide", repeatedCounts: [] },
    { archetype: "repeat-many", widthBand: "full", repeatedCounts: [4] },
  ];
  const result = run([
    makeSnapshot("http://localhost/dashboard", reused),
    makeSnapshot("http://localhost/library", different),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "PASS_CROSS_SURFACE_EVIDENCE");
  assert.equal(result.parsed.hits.length, 0);
});

test("three or more snapshots compare every distinct pair without turning pair count into a verdict", () => {
  const distinct = [
    { archetype: "content", widthBand: "narrow", repeatedCounts: [] },
    { archetype: "repeat-many", widthBand: "wide", repeatedCounts: [6] },
    { archetype: "content-action", widthBand: "narrow", repeatedCounts: [] },
  ];
  const result = run([
    makeSnapshot("http://localhost/a", reused),
    makeSnapshot("http://localhost/b", reused),
    makeSnapshot("http://localhost/c", distinct),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.parsed.comparisons.length, 3);
  assert.equal(result.parsed.hits.length, 1);
});

test("snapshot without current macroZones fails closed with exit 2", () => {
  const invalid = makeSnapshot("http://localhost/a", reused);
  delete invalid.macroZones;
  const result = run([invalid, makeSnapshot("http://localhost/b", reused)]);
  assert.equal(result.status, 2);
  assert.match(result.parsed.error, /macroZones/);
});
