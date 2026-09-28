import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../scripts/taste-gate.mjs");

function fixture(files, intent = null) {
  const root = mkdtempSync(join(tmpdir(), "taste-gate-"));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  let intentPath = null;
  if (intent) {
    intentPath = join(root, "intent.json");
    writeFileSync(intentPath, JSON.stringify(intent, null, 2), "utf8");
  }
  return { root, intentPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(root, intentPath = null) {
  const args = [script, "--path", root, "--json"];
  if (intentPath) args.push("--intent", intentPath);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch { throw new Error(`Invalid JSON from taste gate. stdout=${result.stdout}\nstderr=${result.stderr}`); }
  return { ...result, parsed };
}

test("transition-all remains a mechanically decisive P0", () => {
  const fx = fixture({ "src/a.tsx": `<button className="transition-all">Save</button>` });
  try {
    const result = run(fx.root);
    assert.equal(result.status, 1);
    assert.equal(result.parsed.verdict, "HOLD");
    assert.ok(result.parsed.hits.some((hit) => hit.id === "G22" && hit.hardGate === true));
  } finally { fx.cleanup(); }
});

test("a single purple signal is review evidence, not a cluster conviction", () => {
  const fx = fixture({ "src/a.tsx": `<div className="bg-gradient-to-r from-purple-500 to-indigo-500">Brand</div>` });
  try {
    const result = run(fx.root);
    assert.equal(result.status, 0);
    assert.equal(result.parsed.verdict, "REVIEW");
    assert.equal(result.parsed.cluster.independentFamilies, 1);
    assert.ok(result.parsed.cluster.score < result.parsed.cluster.minimumScore);
  } finally { fx.cleanup(); }
});

test("documented brand intent suppresses contextual purple leads", () => {
  const fx = fixture(
    { "src/a.tsx": `<div className="bg-gradient-to-r from-purple-500 to-indigo-500">Brand</div>` },
    { exceptions: [{ rule: "G12", scope: "*", reason: "Purple and indigo are established brand tokens." }] },
  );
  try {
    const result = run(fx.root, fx.intentPath);
    assert.equal(result.status, 0);
    assert.equal(result.parsed.verdict, "PASS_MECHANICAL");
    assert.equal(result.parsed.p1, 0);
    assert.ok(result.parsed.intent.suppressed >= 1);
  } finally { fx.cleanup(); }
});

test("decorative numbered kicker stays one semantic family", () => {
  const fx = fixture({
    "src/a.tsx": `<span className="uppercase tracking-widest">01 · QUICK TUNNELS</span>`,
  });
  try {
    const result = run(fx.root);
    assert.equal(result.status, 0);
    assert.equal(result.parsed.verdict, "REVIEW");
    assert.equal(result.parsed.cluster.independentFamilies, 1);
    assert.ok(result.parsed.hits.some((hit) => hit.id === "G27"));
    assert.ok(result.parsed.hits.some((hit) => hit.id === "G28"));
    assert.deepEqual(result.parsed.cluster.families[0].ruleIds, ["G27", "G28"]);
  } finally { fx.cleanup(); }
});

test("real numbered process can document a section-chrome exception", () => {
  const fx = fixture(
    { "src/onboarding.tsx": `<span className="uppercase tracking-widest">01 · CONNECT ACCOUNT</span>` },
    { exceptions: [{ family: "section-chrome", scope: "src/*", reason: "These are actual ordered onboarding steps." }] },
  );
  try {
    const result = run(fx.root, fx.intentPath);
    assert.equal(result.status, 0);
    assert.equal(result.parsed.verdict, "PASS_MECHANICAL");
    assert.equal(result.parsed.cluster.independentFamilies, 0);
    assert.ok(result.parsed.intent.suppressed >= 2);
  } finally { fx.cleanup(); }
});

test("three independent default families trigger REVIEW_CLUSTER", () => {
  const fx = fixture({
    "src/a.tsx": [
      `<main className="bg-gradient-to-r from-purple-500 to-indigo-500">`,
      `<h1 className="font-['Inter']">Dashboard</h1>`,
      `<section className="rounded-3xl">Content</section>`,
      `</main>`,
    ].join("\n"),
  });
  try {
    const result = run(fx.root);
    assert.equal(result.status, 0);
    assert.equal(result.parsed.verdict, "REVIEW_CLUSTER");
    assert.ok(result.parsed.cluster.independentFamilies >= 3);
    assert.ok(result.parsed.cluster.score >= result.parsed.cluster.minimumScore);
  } finally { fx.cleanup(); }
});

test("cream plus expressive serif plus sage is a contextual replacement-default lead", () => {
  const fx = fixture({
    "src/a.tsx": [
      `<main className="bg-stone-100 text-emerald-800">`,
      `<h1 style={{ fontFamily: 'Instrument Serif' }}>Journal</h1>`,
      `</main>`,
    ].join("\n"),
  });
  try {
    const result = run(fx.root);
    assert.equal(result.status, 0);
    assert.notEqual(result.parsed.verdict, "HOLD");
    const hit = result.parsed.hits.find((item) => item.id === "G67");
    assert.ok(hit);
    assert.equal(hit.derived, true);
    assert.ok(hit.probes.length >= 2);
  } finally { fx.cleanup(); }
});
