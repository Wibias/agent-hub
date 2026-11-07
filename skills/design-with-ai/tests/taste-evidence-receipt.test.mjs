import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

test("legacy receipt CLI redacts hostile child JSON, stderr, disk JSON and unknown argv", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwa-221-redaction-"));
  const canary = "CANARY_RECEIPT_SECRET_20261107";
  const source = join(dir, "source.tsx");
  const isolatedReceipt = join(dir, "taste-evidence-receipt.mjs");
  const fakeGate = join(dir, "taste-gate.mjs");
  writeFileSync(source, "export default function View() { return null; }\n");
  writeFileSync(isolatedReceipt, readFileSync(receipt, "utf8"));

  const launch = (entry, args) =>
    spawnSync(process.execPath, [entry, ...args], { encoding: "utf8" });
  const assertPrivateError = (result, expected) => {
    assert.equal(result.status, 2, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.error, expected);
    assert.ok(!result.stdout.includes(canary));
    assert.ok(!result.stderr.includes(canary));
  };
  try {
    // The receipt runs a sibling source gate, so this isolated copy supplies
    // synthetic invalid output without altering any repository source gate.
    writeFileSync(fakeGate,
      `process.stdout.write('{"token": ${canary}}');\n` +
      `process.stderr.write('stderr_token=${canary}');\n` +
      "process.exit(2);\n");
    assertPrivateError(
      launch(isolatedReceipt, ["--path", source, "--json"]),
      "Receipt child emitted invalid JSON",
    );

    writeFileSync(fakeGate,
      `process.stdout.write(JSON.stringify({error:"${canary}"}));\n` +
      "process.exit(2);\n");
    assertPrivateError(
      launch(isolatedReceipt, ["--path", source, "--json"]),
      "Receipt child audit failed",
    );

    // Previously, exit 0 with a JSON error envelope could be counted as
    // a completed source audit and serialized into a false success receipt.
    writeFileSync(fakeGate,
      `process.stdout.write(JSON.stringify({error:"${canary}"}));\n` +
      "process.exit(0);\n");
    assertPrivateError(
      launch(isolatedReceipt, ["--path", source, "--json"]),
      "Receipt child audit emitted invalid report",
    );

    // Valid-looking verdict text without the required audit envelope and
    // a contradictory HOLD/exit pairing must also fail closed.
    writeFileSync(fakeGate,
      "process.stdout.write(JSON.stringify({verdict:'PASS_MECHANICAL',p0:0}));\n" +
      "process.exit(0);\n");
    assertPrivateError(
      launch(isolatedReceipt, ["--path", source, "--json"]),
      "Receipt child audit emitted invalid report",
    );

    writeFileSync(fakeGate,
      `process.stdout.write(JSON.stringify({path:${JSON.stringify(resolve(source))},filesScanned:1,intent:{path:null},verdict:'HOLD',p0:1,p1:0,p2:0,hits:[{severity:'P0'}],cluster:{families:[]}}));\n` +
      "process.exit(0);\n");
    assertPrivateError(
      launch(isolatedReceipt, ["--path", source, "--json"]),
      "Receipt child audit emitted invalid report",
    );

    const maliciousManifest = join(dir, "manifest-" + canary + ".json");
    writeFileSync(maliciousManifest, `{"token": ${canary}}`);
    assertPrivateError(
      launch(receipt, ["--manifest", maliciousManifest, "--json"]),
      "Receipt input contains invalid JSON",
    );

    assertPrivateError(
      launch(receipt, ["--path", source, "--unexpected-" + canary, "--json"]),
      "Invalid or unexpected CLI argument",
    );

    const usageResult = launch(receipt, ["--json"]);
    assert.equal(usageResult.status, 2);
    assert.match(JSON.parse(usageResult.stdout).error, /^Usage: taste-evidence-receipt\.mjs /);
    assertPrivateError(
      launch(receipt, ["--manifest", maliciousManifest, "--path", source, "--json"]),
      "--manifest is mutually exclusive with --path/--snapshot/--route/--intent/--extensions",
    );
    const badViewport = join(dir, "viewport-" + canary + ".json");
    writeFileSync(badViewport, JSON.stringify(cleanSnapshot({
      viewport: { width: 0, height: 900, devicePixelRatio: 1 },
    })));
    assertPrivateError(
      launch(receipt, ["--path", source, "--snapshot", badViewport, "--route", "/example", "--json"]),
      "Render snapshot viewport is invalid",
    );

    // Inject an OS-style cleanup exception after removing the test temp dir.
    // The public failure must be redacted and no success receipt emitted.
    const pristine = readFileSync(receipt, "utf8");
    const cleanupCall = "rmSync(tempDir, { recursive: true, force: true });";
    assert.ok(pristine.includes(cleanupCall));
    writeFileSync(isolatedReceipt, pristine.replace(cleanupCall,
      cleanupCall + ` throw new Error("${canary}");`));
    writeFileSync(fakeGate,
      `process.stdout.write(JSON.stringify({path:${JSON.stringify(resolve(source))},filesScanned:1,intent:{path:null},p0:0,p1:0,p2:0,verdict:'PASS_MECHANICAL',hits:[],cluster:{families:[]}}));\n`);
    assertPrivateError(
      launch(isolatedReceipt, ["--path", source, "--json"]),
      "Receipt temporary cleanup failed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("receipt binds child proof to exact source, snapshot and fusion channels", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwa-221-scope-binding-"));
  const source = join(dir, "source.tsx");
  const snapshot = join(dir, "capture.json");
  const localReceipt = join(dir, "taste-evidence-receipt.mjs");
  const sourceGate = join(dir, "taste-gate.mjs");
  const renderGate = join(dir, "render-taste-gate.mjs");
  const fusionGate = join(dir, "taste-evidence-fusion.mjs");
  const canary = "CANARY_OTHER_SCOPE_20261107";
  const sourceReport = (path, filesScanned = 1) => ({
    path, filesScanned, intent: { path: null }, p0: 0, p1: 0, p2: 0,
    verdict: "PASS_MECHANICAL", hits: [], cluster: { families: [] },
  });
  const renderReport = (path, url, viewport = { width: 1440, height: 900, devicePixelRatio: 1 }) => ({
    snapshot: path, url, viewport,
    verdict: "PASS_RENDER_EVIDENCE", hits: [], cluster: { families: [] },
  });
  const writeGate = (file, report, code = 0) => {
    writeFileSync(file, "process.stdout.write(" +
      JSON.stringify(JSON.stringify(report)) + ");\nprocess.exit(" + code + ");\n");
  };
  const writeFusionGate = (report, code = 0) => {
    writeFileSync(fusionGate, [
      "const args=process.argv.slice(2); const arg=(key)=>args[args.indexOf(key)+1];",
      `const report=${JSON.stringify(report)};`,
      "report.reports={source:arg('--source-report'),render:arg('--render-report')};",
      "process.stdout.write(JSON.stringify(report));",
      `process.exit(${code});`,
    ].join("\n"));
  };
  const execute = (render = false, extraArgs = []) => {
    const args = [localReceipt, "--path", source, "--json", ...extraArgs];
    if (render) args.push("--snapshot", snapshot, "--route", "/example");
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const error = JSON.parse(result.stdout).error;
    assert.equal(error, "Receipt child audit emitted invalid report");
    assert.ok(!result.stdout.includes(canary));
    assert.ok(!result.stderr.includes(canary));
  };
  try {
    writeFileSync(localReceipt, readFileSync(receipt, "utf8"));
    writeFileSync(source, "export default function View(){return null;}");
    writeFileSync(snapshot, JSON.stringify(cleanSnapshot({ url: "http://localhost/example" })));

    // A convincing PASS for another file must not attest this source.
    writeGate(sourceGate, sourceReport(join(dir, canary + ".tsx")));
    execute();
    writeGate(sourceGate, sourceReport(source, 0));
    execute();
    writeGate(sourceGate, { ...sourceReport(source), intent: { path: join(dir, canary + ".json") } });
    execute();
    const intentPath = join(dir, "intent.json");
    writeFileSync(intentPath, "{}");
    writeGate(sourceGate, sourceReport(source));
    execute(false, ["--intent", intentPath]);
    writeGate(sourceGate, { ...sourceReport(source), intent: { path: intentPath } });
    const intentOk = spawnSync(process.execPath,
      [localReceipt, "--path", source, "--intent", intentPath, "--json"],
      { encoding: "utf8" });
    assert.equal(intentOk.status, 0, intentOk.stdout + intentOk.stderr);
    writeGate(sourceGate, sourceReport(source));
    // A reported zero P0 cannot hide a P0 hit in the actual hit array.
    writeGate(sourceGate, { ...sourceReport(source), hits: [{ severity: "P0" }] });
    execute();
    writeGate(sourceGate, { ...sourceReport(source), p1: 1 });
    execute();
    writeGate(sourceGate, { ...sourceReport(source), p2: 1 });
    execute();
    writeGate(sourceGate, { ...sourceReport(source), p1: 1, hits: [{ severity: "P1" }] });
    execute();

    writeGate(sourceGate, sourceReport(source));
    // A render audit of a different snapshot cannot prove this viewport.
    writeGate(renderGate, renderReport(join(dir, canary + ".json"), "http://localhost/example"));
    execute(true);
    writeGate(renderGate, renderReport(snapshot, "http://localhost/" + canary));
    execute(true);

    // A correct snapshot path and URL cannot conceal a different viewport.
    writeGate(renderGate, renderReport(snapshot, "http://localhost/example", { width: 390, height: 900, devicePixelRatio: 1 }));
    execute(true);
    writeGate(renderGate, renderReport(snapshot, "http://localhost/example", { width: 1440, height: 768, devicePixelRatio: 1 }));
    execute(true);
    writeGate(renderGate, renderReport(snapshot, "http://localhost/example", { width: 1440 }));
    execute(true);
    writeGate(renderGate, renderReport(snapshot, "http://localhost/example", { width: 1440, height: 900 }));
    execute(true);
    writeGate(renderGate, renderReport(snapshot, "http://localhost/example", { width: 1440, height: 900, devicePixelRatio: 2 }));
    execute(true);

    writeGate(renderGate, { ...renderReport(snapshot, "http://localhost/example"), hits: [{ id: "fake-render-hit" }] });
    execute(true);
    writeGate(renderGate, renderReport(snapshot, "http://localhost/example"));
    // Fusion HOLD after source PASS cannot be a clear mechanical receipt.
    writeFusionGate({
      verdict: "HOLD",
      channels: { sourceVerdict: "PASS_MECHANICAL", renderVerdict: "PASS_RENDER_EVIDENCE" },
      cluster: { families: [] },
    }, 1);
    execute(true);
    // It must also reject a fusion report claiming different input channels.
    writeFusionGate({
      verdict: "PASS_FUSED_EVIDENCE",
      channels: { sourceVerdict: "REVIEW", renderVerdict: "PASS_RENDER_EVIDENCE" },
      cluster: { families: [] },
    });
    execute(true);
    const correctChannels = { sourceVerdict: "PASS_MECHANICAL", renderVerdict: "PASS_RENDER_EVIDENCE" };
    writeGate(fusionGate, {
      verdict: "PASS_FUSED_EVIDENCE", channels: correctChannels, cluster: { families: [] },
    });
    execute(true);
    writeGate(fusionGate, {
      verdict: "PASS_FUSED_EVIDENCE", channels: correctChannels, cluster: { families: [] },
      reports: { source: join(dir, canary + ".json"), render: join(dir, "other.json") },
    });
    execute(true);

    // Compatible positive example, with actual input paths from the fusion CLI.
    writeFusionGate({
      verdict: "PASS_FUSED_EVIDENCE", channels: correctChannels, cluster: { families: [] },
    });
    // A source P2-only PASS still contains contextual hits, so the fusion
    // tool cannot claim PASS_FUSED_EVIDENCE with matching channel labels.
    writeGate(sourceGate, {
      ...sourceReport(source), p2: 1, hits: [{ severity: "P2" }],
    });
    execute(true);
    writeGate(sourceGate, sourceReport(source));

    const ok = spawnSync(process.execPath, [
      localReceipt, "--path", source, "--snapshot", snapshot, "--route", "/example", "--json",
    ], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.equal(JSON.parse(ok.stdout).state, "MECHANICAL_EVIDENCE_CLEAR");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manifest dot IDs cannot leave intermediate fusion reports outside cleanup root", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwa-221-dot-id-"));
  const childTmp = join(dir, "child-tmp");
  mkdirSync(childTmp);
  try {
    writeFileSync(join(dir, "source.tsx"), "export default function View(){return <main>Plain content</main>;}");
    writeFileSync(join(dir, "snapshot.json"), JSON.stringify(cleanSnapshot()));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      candidates: [".", ".."].map((id) => ({
        id, path: "source.tsx", snapshot: "snapshot.json", route: "/example",
      })),
    }));
    const result = spawnSync(process.execPath, [
      receipt, "--manifest", join(dir, "manifest.json"), "--json",
    ], {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).state, "MECHANICAL_EVIDENCE_CLEAR");
    assert.deepEqual(readdirSync(childTmp), [], "receipt temp root must be fully cleaned");
    assert.equal(existsSync(childTmp + "-source.json"), false);
    assert.equal(existsSync(childTmp + "-render.json"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(childTmp + "-source.json", { force: true });
    rmSync(childTmp + "-render.json", { force: true });
  }
});
