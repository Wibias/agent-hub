import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const analyzer = resolve(here, "../scripts/render-taste-gate.mjs");
const registryPath = resolve(here, "../references/slop-signals.json");
const casesPath = resolve(here, "render-calibration-cases.jsonl");

function baseSnapshot() {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-21T00:00:00.000Z",
    url: "http://localhost/calibration",
    title: "Calibration",
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
  };
}

function deepMerge(target, source) {
  if (Array.isArray(source)) return source.map((value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge({}, value)
      : value
  );
  if (!source || typeof source !== "object") return source;
  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) output[key] = deepMerge([], value);
    else if (value && typeof value === "object") {
      output[key] = deepMerge(
        output[key] && typeof output[key] === "object" && !Array.isArray(output[key]) ? output[key] : {},
        value,
      );
    } else output[key] = value;
  }
  return output;
}

function readCases() {
  return readFileSync(casesPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`${casesPath}:${index + 1}: ${error.message}`); }
    });
}

function run(snapshot) {
  const dir = mkdtempSync(join(tmpdir(), "render-calibration-"));
  const file = join(dir, "snapshot.json");
  writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  const result = spawnSync(process.execPath, [analyzer, "--snapshot", file, "--json"], { encoding: "utf8" });
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Invalid JSON from render taste gate. stdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  rmSync(dir, { recursive: true, force: true });
  return { ...result, parsed };
}

test("render calibration matrix has positive and negative coverage for every current render rule", () => {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const cases = readCases();
  const positive = new Set(cases.flatMap((row) => row.expect_hits ?? []));
  const negative = new Set(cases.flatMap((row) => row.forbid_hits ?? []));

  for (const rule of registry.renderRules ?? []) {
    assert.ok(positive.has(rule.id), `render calibration missing positive coverage for ${rule.id}`);
    assert.ok(negative.has(rule.id), `render calibration missing boundary-negative coverage for ${rule.id}`);
  }
});

for (const row of readCases()) {
  test(`${row.id} ${row.description}`, () => {
    const snapshot = deepMerge(baseSnapshot(), row.overrides ?? {});
    const result = run(snapshot);
    assert.equal(result.status, 0, result.stderr);

    const hitIds = new Set(result.parsed.hits.map((hit) => hit.id));
    for (const id of row.expect_hits ?? []) {
      assert.ok(hitIds.has(id), `${row.id} expected ${id}; got ${[...hitIds].join(", ") || "none"}`);
    }
    for (const id of row.forbid_hits ?? []) {
      assert.ok(!hitIds.has(id), `${row.id} must not produce ${id}; got ${[...hitIds].join(", ")}`);
    }
    assert.notEqual(result.parsed.verdict, "HOLD");
  });
}

test("calibration fixtures use unique stable IDs", () => {
  const cases = readCases();
  const ids = cases.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^RC\d{2,}$/);
});
