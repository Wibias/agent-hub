import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fusion = resolve(here, "../scripts/taste-evidence-fusion.mjs");

function sourceReport(overrides = {}) {
  return {
    verdict: "PASS_MECHANICAL",
    p0: 0,
    p1: 0,
    p2: 0,
    hits: [],
    cluster: {
      independentFamilies: 0,
      score: 0,
      minimumIndependentFamilies: 3,
      minimumScore: 5,
      families: [],
    },
    ...overrides,
  };
}

function renderReport(overrides = {}) {
  return {
    verdict: "PASS_RENDER_EVIDENCE",
    hits: [],
    cluster: {
      independentFamilies: 0,
      score: 0,
      minimumIndependentFamilies: 3,
      minimumScore: 5,
      families: [],
    },
    ...overrides,
  };
}

function run(source, render) {
  const dir = mkdtempSync(join(tmpdir(), "taste-fusion-"));
  const sourcePath = join(dir, "source.json");
  const renderPath = join(dir, "render.json");
  writeFileSync(sourcePath, JSON.stringify(source, null, 2), "utf8");
  writeFileSync(renderPath, JSON.stringify(render, null, 2), "utf8");
  const result = spawnSync(process.execPath, [
    fusion,
    "--source-report", sourcePath,
    "--render-report", renderPath,
    "--json",
  ], { encoding: "utf8" });

  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Invalid JSON from taste fusion. stdout=${result.stdout}\nstderr=${result.stderr}`);
  }

  rmSync(dir, { recursive: true, force: true });
  return { ...result, parsed };
}

test("clean source and render reports fuse to PASS_FUSED_EVIDENCE", () => {
  const result = run(sourceReport(), renderReport());
  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "PASS_FUSED_EVIDENCE");
  assert.equal(result.parsed.cluster.independentFamilies, 0);
  assert.equal(result.parsed.cluster.score, 0);
});

test("the same semantic family across source and render is counted once at max score", () => {
  const result = run(
    sourceReport({
      verdict: "REVIEW",
      p1: 1,
      hits: [{ id: "G31", family: "surface-radius" }],
      cluster: {
        independentFamilies: 1,
        score: 1,
        minimumIndependentFamilies: 3,
        minimumScore: 5,
        families: [{
          family: "surface-radius",
          score: 1,
          ruleIds: ["G31"],
          files: ["card.tsx"],
        }],
      },
    }),
    renderReport({
      verdict: "REVIEW_RENDER",
      hits: [{ id: "G31", family: "surface-radius" }],
      cluster: {
        independentFamilies: 1,
        score: 1,
        minimumIndependentFamilies: 3,
        minimumScore: 5,
        families: [{
          family: "surface-radius",
          weight: 1,
          ruleIds: ["G31"],
        }],
      },
    }),
  );

  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_FUSED");
  assert.equal(result.parsed.cluster.independentFamilies, 1);
  assert.equal(result.parsed.cluster.score, 1);
  assert.deepEqual(result.parsed.cluster.families[0].channels, ["render", "source"]);
});

test("complementary source and render families can trigger one fused contextual cluster", () => {
  const result = run(
    sourceReport({
      verdict: "REVIEW",
      p1: 1,
      hits: [{ id: "G12", family: "palette-gradient-default" }],
      cluster: {
        independentFamilies: 1,
        score: 2,
        minimumIndependentFamilies: 3,
        minimumScore: 5,
        families: [{
          family: "palette-gradient-default",
          score: 2,
          ruleIds: ["G12"],
          files: ["home.tsx"],
        }],
      },
    }),
    renderReport({
      verdict: "REVIEW_RENDER",
      hits: [
        { id: "G04", family: "repeated-card-structure" },
        { id: "G31", family: "surface-radius" },
      ],
      cluster: {
        independentFamilies: 2,
        score: 3,
        minimumIndependentFamilies: 3,
        minimumScore: 5,
        families: [
          { family: "repeated-card-structure", weight: 2, ruleIds: ["G04"] },
          { family: "surface-radius", weight: 1, ruleIds: ["G31"] },
        ],
      },
    }),
  );

  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_FUSED_CLUSTER");
  assert.equal(result.parsed.cluster.independentFamilies, 3);
  assert.equal(result.parsed.cluster.score, 5);
});

test("source P0 remains HOLD even when rendered evidence is clean", () => {
  const result = run(
    sourceReport({
      verdict: "HOLD",
      p0: 1,
      hits: [{ id: "G22", family: "motion-safety", hardGate: true }],
    }),
    renderReport(),
  );

  assert.equal(result.status, 1);
  assert.equal(result.parsed.verdict, "HOLD");
  assert.equal(result.parsed.hardGate.channel, "source");
  assert.equal(result.parsed.hardGate.p0, 1);
});

test("rendered contextual evidence can never create HOLD by itself", () => {
  const result = run(
    sourceReport(),
    renderReport({
      verdict: "REVIEW_RENDER_CLUSTER",
      hits: [
        { id: "G03", family: "hero-structure" },
        { id: "G04", family: "repeated-card-structure" },
        { id: "G71", family: "hierarchy" },
      ],
      cluster: {
        independentFamilies: 3,
        score: 6,
        minimumIndependentFamilies: 3,
        minimumScore: 5,
        families: [
          { family: "hero-structure", weight: 2, ruleIds: ["G03"] },
          { family: "repeated-card-structure", weight: 2, ruleIds: ["G04"] },
          { family: "hierarchy", weight: 2, ruleIds: ["G71"] },
        ],
      },
    }),
  );

  assert.equal(result.status, 0);
  assert.equal(result.parsed.verdict, "REVIEW_FUSED_CLUSTER");
  assert.equal(result.parsed.hardGate, null);
});

test("source repeat bonus is preserved but not added again when render confirms the same family", () => {
  const result = run(
    sourceReport({
      verdict: "REVIEW",
      p1: 3,
      hits: [{ id: "G31", family: "surface-radius" }],
      cluster: {
        independentFamilies: 1,
        score: 2,
        minimumIndependentFamilies: 3,
        minimumScore: 5,
        families: [{
          family: "surface-radius",
          score: 2,
          baseWeight: 1,
          repeatBonus: 1,
          ruleIds: ["G31"],
          files: ["a.tsx", "b.tsx", "c.tsx"],
        }],
      },
    }),
    renderReport({
      verdict: "REVIEW_RENDER",
      hits: [{ id: "G31", family: "surface-radius" }],
      cluster: {
        independentFamilies: 1,
        score: 1,
        minimumIndependentFamilies: 3,
        minimumScore: 5,
        families: [{
          family: "surface-radius",
          weight: 1,
          ruleIds: ["G31"],
        }],
      },
    }),
  );

  assert.equal(result.status, 0);
  assert.equal(result.parsed.cluster.score, 2);
  assert.equal(result.parsed.cluster.families[0].channelScores.source, 2);
  assert.equal(result.parsed.cluster.families[0].channelScores.render, 1);
});

test("mismatched source and render cluster thresholds fail closed", () => {
  const render = renderReport();
  render.cluster.minimumScore = 6;
  const result = run(sourceReport(), render);
  assert.equal(result.status, 2);
  assert.match(result.parsed.error, /different cluster thresholds/);
});

test("invalid source or render report shape fails closed", () => {
  const result = run({ verdict: "banana" }, renderReport());
  assert.equal(result.status, 2);
  assert.match(result.parsed.error, /Source report/);
});
