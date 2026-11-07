#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const USAGE_MESSAGE = "Usage: taste-evidence-receipt.mjs --path <file-or-directory> [--snapshot <render-snapshot.json> --route </route>] [--intent <intent.json>] [--extensions .tsx,.css] [--json] OR --manifest <receipt-manifest.json> [--cross-surface-report <compare-render-snapshots.json>] [--json]";

// This CLI joins output from independently executed audit tools. Inputs,
// child stdout/stderr and JSON parser exceptions are untrusted and may include
// credential-bearing file paths, URLs or arbitrary token fragments. Only
// explicitly fixed, authored error categories may leave the process.
function safePublicError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const allowed = new Set([
    USAGE_MESSAGE,
    "--manifest is mutually exclusive with --path/--snapshot/--route/--intent/--extensions",
    "Render snapshot viewport is invalid",
    "Receipt temporary cleanup failed",
    "Invalid or unexpected CLI argument",
    "Receipt child emitted invalid JSON",
    "Receipt child audit failed",
    "Receipt child audit emitted invalid report",
    "Required receipt input file not found",
    "Receipt input contains invalid JSON",
    "Render snapshot route mismatch",
    "Cross-surface report must cover exactly the route-bound rendered candidates in the receipt manifest",
    "Cross-surface report has unsupported verdict",
    "Cross-surface report has inconsistent evidence",
    "--snapshot requires --route",
    "--route requires --snapshot",
  ]);
  if (allowed.has(message)) return message;
  if (message.startsWith("--snapshot requires --route")) return "--snapshot requires --route";
  if (message.startsWith("--route requires --snapshot")) return "--route requires --snapshot";
  if (message.startsWith("Render snapshot route mismatch:")) return "Render snapshot route mismatch";
  return "Taste evidence receipt failed; untrusted details redacted";
}

function parseArgs(argv) {
  const args = {
    path: null,
    snapshot: null,
    route: null,
    manifest: null,
    intent: null,
    extensions: null,
    crossSurfaceReport: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") args.json = true;
    else if (token === "--path") args.path = argv[++i];
    else if (token === "--snapshot") args.snapshot = argv[++i];
    else if (token === "--route") args.route = argv[++i];
    else if (token === "--manifest") args.manifest = argv[++i];
    else if (token === "--intent") args.intent = argv[++i];
    else if (token === "--extensions") args.extensions = argv[++i];
    else if (token === "--cross-surface-report") args.crossSurfaceReport = argv[++i];
    else if (!token.startsWith("-") && !args.path && !args.manifest) args.path = token;
    else throw new Error("Invalid or unexpected CLI argument");
  }

  if (args.manifest && (args.path || args.snapshot || args.route || args.intent || args.extensions)) {
    throw new Error("--manifest is mutually exclusive with --path/--snapshot/--route/--intent/--extensions");
  }
  if (!args.manifest && !args.path) {
    throw new Error(USAGE_MESSAGE);
  }
  if (args.snapshot && !args.route) {
    throw new Error("--snapshot requires --route so source/render evidence cannot be fused without an explicit candidate binding");
  }
  if (args.route && !args.snapshot) {
    throw new Error("--route requires --snapshot");
  }
  if (args.crossSurfaceReport && !args.manifest) {
    throw new Error("--cross-surface-report requires --manifest so cross-surface evidence is bound to an explicit multi-candidate set");
  }
  return args;
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Receipt child emitted invalid JSON");
  }
}

const SOURCE_VERDICTS = new Set(["HOLD", "REVIEW_CLUSTER", "REVIEW", "PASS_MECHANICAL"]);
const RENDER_VERDICTS = new Set(["PASS_RENDER_EVIDENCE", "REVIEW_RENDER", "REVIEW_RENDER_CLUSTER"]);
const FUSION_VERDICTS = new Set(["HOLD", "REVIEW_FUSED", "REVIEW_FUSED_CLUSTER", "PASS_FUSED_EVIDENCE"]);

// The source gate derives counters from unsuppressed hits, not from separate
// untrusted summaries. A falsified zero P0 must never soften a hard HOLD.
function sourceHitCountsMatch(report) {
  if (!Array.isArray(report.hits)) return false;
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const hit of report.hits) {
    if (!hit || typeof hit !== "object" || Array.isArray(hit) ||
        !Object.hasOwn(counts, hit.severity)) return false;
    counts[hit.severity] += 1;
  }
  return counts.P0 === report.p0 && counts.P1 === report.p1 &&
    counts.P2 === report.p2 &&
    ["p0", "p1", "p2"].every((name) =>
      Number.isSafeInteger(report[name]) && report[name] >= 0);
}

// Do not treat an error envelope or JSON scalar from a child with exit 0 as
// proof that its audit completed successfully. Never echo rejected JSON.
function assertGateOutput(parsed, kind, exitStatus, expected = {}) {
  const object = parsed && typeof parsed === "object" && !Array.isArray(parsed);
  const verdicts = kind === "source" ? SOURCE_VERDICTS
    : kind === "render" ? RENDER_VERDICTS : FUSION_VERDICTS;
  const cluster = parsed?.cluster;
  const validCluster = cluster && typeof cluster === "object" &&
    !Array.isArray(cluster) && Array.isArray(cluster.families);
  const valid = object && !Object.hasOwn(parsed, "error") &&
    verdicts.has(parsed.verdict) && validCluster &&
    (kind === "fusion"
      ? parsed.channels && typeof parsed.channels === "object" &&
        SOURCE_VERDICTS.has(parsed.channels.sourceVerdict) &&
        RENDER_VERDICTS.has(parsed.channels.renderVerdict)
      : Array.isArray(parsed.hits)) &&
    (kind !== "source" || (
      sourceHitCountsMatch(parsed) &&
      parsed.intent && typeof parsed.intent === "object" &&
      !Array.isArray(parsed.intent) &&
      parsed.intent.path === (expected.intentPath == null ? null : resolve(expected.intentPath)) &&
      (parsed.p0 > 0) === (parsed.verdict === "HOLD") &&
      (parsed.p1 === 0 || parsed.verdict !== "PASS_MECHANICAL") &&
      (parsed.p1 > 0 || parsed.verdict !== "REVIEW") &&
      (exitStatus === 1) === (parsed.verdict === "HOLD") &&
      parsed.path === resolve(expected.sourcePath) &&
      Number.isSafeInteger(parsed.filesScanned) && parsed.filesScanned > 0
    )) &&
    (kind !== "render" || (
      (parsed.hits.length === 0) === (parsed.verdict === "PASS_RENDER_EVIDENCE") &&
      parsed.snapshot === resolve(expected.snapshotPath) &&
      parsed.url === expected.snapshotUrl &&
      parsed.viewport && typeof parsed.viewport === "object" &&
      !Array.isArray(parsed.viewport) &&
      Number.isFinite(parsed.viewport.width) &&
      Number.isFinite(parsed.viewport.height) &&
      parsed.viewport.width === expected.viewport.width &&
      parsed.viewport.height === expected.viewport.height &&
      (expected.viewport.devicePixelRatio === undefined ||
        parsed.viewport.devicePixelRatio === expected.viewport.devicePixelRatio)
    )) &&
    (kind !== "fusion" || (
      (exitStatus === 1) === (parsed.verdict === "HOLD") &&
      parsed.channels.sourceVerdict === expected.sourceVerdict &&
      parsed.channels.renderVerdict === expected.renderVerdict &&
      parsed.reports && typeof parsed.reports === "object" &&
      !Array.isArray(parsed.reports) &&
      parsed.reports.source === resolve(expected.sourceReportPath) &&
      parsed.reports.render === resolve(expected.renderReportPath) &&
      (parsed.verdict === "HOLD") === (expected.sourceVerdict === "HOLD") &&
      (parsed.verdict !== "PASS_FUSED_EVIDENCE" ||
        (expected.sourceHits === 0 && expected.renderHits === 0)) &&
      (parsed.verdict === "PASS_FUSED_EVIDENCE" || parsed.verdict === "HOLD" ||
        expected.sourceHits > 0 || expected.renderHits > 0)
    ));
  if (!valid) throw new Error("Receipt child audit emitted invalid report");
}

function runNode(script, args, label, accepted = new Set([0]), kind = "source", expected = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const parsed = parseJsonOutput(result, label);
  if (!accepted.has(result.status)) {
    // Child-reported errors are not trusted diagnostic text.
    // Keep the nonzero fail-closed status without copying child JSON fields.
    throw new Error("Receipt child audit failed");
  }
  assertGateOutput(parsed, kind, result.status, expected);
  return { status: result.status, parsed };
}

function readJsonFile(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error("Required receipt input file not found");
  try {
    return { path: absolute, value: JSON.parse(readFileSync(absolute, "utf8")) };
  } catch {
    // Node parser errors can embed untrusted JSON bytes and physical paths.
    throw new Error("Receipt input contains invalid JSON");
  }
}

function normalizeRoute(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Candidate route must be a non-empty string");
  let pathname = value.trim();
  try {
    pathname = new URL(pathname, "http://receipt.local").pathname;
  } catch {
    // Keep the declared route text and normalize it below.
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}

function readSnapshotBinding(path, declaredRoute) {
  const snapshot = readJsonFile(path, "Render snapshot");
  if (snapshot.value?.schemaVersion !== 1) {
    throw new Error(`Unsupported or missing render snapshot schemaVersion: ${snapshot.path}`);
  }
  if (typeof snapshot.value?.url !== "string" || !snapshot.value.url.trim()) {
    throw new Error(`Render snapshot is missing url for route binding: ${snapshot.path}`);
  }
  const viewport = snapshot.value.viewport;
  if (!Number.isFinite(viewport?.width) || viewport.width <= 0 ||
      !Number.isFinite(viewport?.height) || viewport.height <= 0 ||
      (viewport.devicePixelRatio !== undefined &&
        (!Number.isFinite(viewport.devicePixelRatio) ||
         viewport.devicePixelRatio <= 0))) {
    throw new Error("Render snapshot viewport is invalid");
  }
  const expectedViewport = {
    width: viewport.width,
    height: viewport.height,
    ...(viewport.devicePixelRatio === undefined
      ? {} : { devicePixelRatio: viewport.devicePixelRatio }),
  };
  const expectedRoute = normalizeRoute(declaredRoute);
  const snapshotRoute = normalizeRoute(snapshot.value.url);
  if (snapshotRoute !== expectedRoute) {
    throw new Error(`Render snapshot route mismatch: declared ${expectedRoute}, snapshot ${snapshotRoute} (${snapshot.path})`);
  }
  return {
    binding: {
      snapshotPath: snapshot.path,
      snapshotUrl: snapshot.value.url,
      declaredRoute: expectedRoute,
      snapshotRoute,
      verified: true,
    },
    expectedViewport,
  };
}

function resolveMaybeRelative(baseDir, value) {
  if (value == null) return null;
  return resolve(baseDir, value);
}

function readManifest(path) {
  const manifest = readJsonFile(path, "Receipt manifest");
  const baseDir = dirname(manifest.path);
  if (manifest.value?.schemaVersion !== 1) {
    throw new Error("Receipt manifest requires schemaVersion 1");
  }
  if (!Array.isArray(manifest.value.candidates) || manifest.value.candidates.length < 1) {
    throw new Error("Receipt manifest requires at least one candidate");
  }

  const ids = new Set();
  const candidates = manifest.value.candidates.map((candidate, index) => {
    const id = String(candidate?.id ?? "").trim();
    if (!id) throw new Error(`Receipt manifest candidate ${index + 1} requires a non-empty id`);
    if (ids.has(id)) throw new Error(`Receipt manifest candidate id is duplicated: ${id}`);
    ids.add(id);

    const sourcePath = String(candidate?.path ?? "").trim();
    if (!sourcePath) throw new Error(`Receipt manifest candidate '${id}' requires path`);

    const snapshot = candidate.snapshot == null ? null : String(candidate.snapshot).trim();
    const route = candidate.route == null ? null : String(candidate.route).trim();
    if (snapshot && !route) throw new Error(`Receipt manifest candidate '${id}' snapshot requires route`);
    if (route && !snapshot) throw new Error(`Receipt manifest candidate '${id}' route requires snapshot`);

    return {
      id,
      path: resolveMaybeRelative(baseDir, sourcePath),
      snapshot: snapshot ? resolveMaybeRelative(baseDir, snapshot) : null,
      route: route ? normalizeRoute(route) : null,
      intent: candidate.intent ? resolveMaybeRelative(baseDir, String(candidate.intent)) : null,
      extensions: candidate.extensions == null ? null : String(candidate.extensions),
    };
  });

  const crossSurfaceReport = manifest.value.crossSurfaceReport
    ? resolveMaybeRelative(baseDir, String(manifest.value.crossSurfaceReport))
    : null;

  return { path: manifest.path, candidates, crossSurfaceReport };
}

function readCrossSurface(path) {
  const report = readJsonFile(path, "Cross-surface report");
  const value = report.value;
  if (!["PASS_CROSS_SURFACE_EVIDENCE", "REVIEW_CROSS_SURFACE"].includes(value?.verdict)) {
    throw new Error("Cross-surface report has unsupported verdict");
  }
  if (!Array.isArray(value?.hits) || !Array.isArray(value?.comparisons) || !Array.isArray(value?.snapshots)) {
    throw new Error("Cross-surface report missing hits/comparisons/snapshots");
  }
  // The cross-surface comparator emits one hit per triggered pair and REVIEW
  // exactly when at least one pair triggered. Never let an externally provided
  // PASS verdict erase real evidence already present in that same report.
  const comparisonsValid = value.comparisons.every((row) =>
    row && typeof row === "object" && !Array.isArray(row) &&
    typeof row.triggered === "boolean");
  const triggeredCount = value.comparisons.filter((row) => row?.triggered === true).length;
  const shouldReview = value.hits.length > 0;
  if (!comparisonsValid || triggeredCount !== value.hits.length ||
      (value.verdict === "REVIEW_CROSS_SURFACE") !== shouldReview) {
    throw new Error("Cross-surface report has inconsistent evidence");
  }
  return { path: report.path, value };
}

function verifyCrossSurfaceBinding(cross, candidates) {
  if (!cross) return null;
  const renderedCandidates = candidates.filter((candidate) => candidate.binding?.verified === true);
  if (renderedCandidates.length < 2) {
    throw new Error("Cross-surface report requires at least two route-bound rendered candidates");
  }

  const byRouteAndPath = new Set(
    renderedCandidates.map((candidate) => `${candidate.binding.declaredRoute}\n${resolve(candidate.binding.snapshotPath)}`)
  );
  for (const snapshot of cross.value.snapshots) {
    const route = normalizeRoute(snapshot.route);
    const path = resolve(snapshot.path);
    if (!byRouteAndPath.has(`${route}\n${path}`)) {
      throw new Error(`Cross-surface snapshot is not bound to a receipt candidate: ${route} (${path})`);
    }
  }

  const crossKeys = new Set(
    cross.value.snapshots.map((snapshot) => `${normalizeRoute(snapshot.route)}\n${resolve(snapshot.path)}`)
  );
  if (cross.value.snapshots.length !== renderedCandidates.length ||
      crossKeys.size !== renderedCandidates.length ||
      renderedCandidates.some((candidate) => !crossKeys.has(`${candidate.binding.declaredRoute}\n${resolve(candidate.binding.snapshotPath)}`))) {
    throw new Error("Cross-surface report must cover exactly the route-bound rendered candidates in the receipt manifest");
  }

  // The comparator must emit every i < j snapshot pair, in snapshot order.
  // Missing, repeated or misattributed pairs cannot count as cross-surface
  // coverage even when the snapshot list itself is complete.
  const snapshots = cross.value.snapshots;
  const comparisons = cross.value.comparisons;
  if (comparisons.length !== (snapshots.length * (snapshots.length - 1)) / 2) {
    throw new Error("Cross-surface report has inconsistent evidence");
  }
  let comparisonIndex = 0;
  for (let i = 0; i < snapshots.length; i += 1) {
    for (let j = i + 1; j < snapshots.length; j += 1) {
      const pair = comparisons[comparisonIndex++];
      if (pair.left !== snapshots[i].route || pair.right !== snapshots[j].route) {
        throw new Error("Cross-surface report has inconsistent evidence");
      }
    }
  }

  // This is externally supplied evidence. Re-run the trusted local comparator
  // on the exact candidate-bound snapshot files; structurally complete rows
  // alone cannot prove similarity, eligibility, thresholds or hit provenance.
  // Never echo child stdout, stderr, argv or filesystem errors.
  const comparator = resolve(dirname(fileURLToPath(import.meta.url)), "compare-render-snapshots.mjs");
  const comparatorArgs = snapshots.flatMap((snapshot) => ["--snapshot", resolve(snapshot.path)]);
  const computed = spawnSync(process.execPath, [comparator, ...comparatorArgs, "--json"], {
    encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (computed.error || computed.status !== 0) {
    throw new Error("Cross-surface report has inconsistent evidence");
  }
  let trusted;
  try {
    trusted = JSON.parse(computed.stdout);
  } catch {
    throw new Error("Cross-surface report has inconsistent evidence");
  }
  if (["verdict", "snapshots", "comparisons", "hits"].some((field) =>
    !isDeepStrictEqual(cross.value[field], trusted?.[field]))) {
    throw new Error("Cross-surface report has inconsistent evidence");
  }

  return {
    verified: true,
    candidateCount: renderedCandidates.length,
    snapshotCount: cross.value.snapshots.length,
  };
}

function runCandidate(candidate, tools, tempRoot) {
  const sourceArgs = ["--path", candidate.path, "--json"];
  if (candidate.intent) sourceArgs.push("--intent", candidate.intent);
  if (candidate.extensions) sourceArgs.push("--extensions", candidate.extensions);

  const source = runNode(tools.sourceGate, sourceArgs, `Source taste gate [${candidate.id}]`,
    new Set([0, 1]), "source", {
      sourcePath: candidate.path, intentPath: candidate.intent,
    });

  let render = null;
  let fused = null;
  let binding = null;
  if (candidate.snapshot) {
    const snapshotInfo = readSnapshotBinding(candidate.snapshot, candidate.route);
    binding = snapshotInfo.binding;
    render = runNode(
      tools.renderGate,
      ["--snapshot", candidate.snapshot, "--json"],
      `Rendered taste gate [${candidate.id}]`,
      new Set([0]), "render", {
        snapshotPath: candidate.snapshot, snapshotUrl: binding.snapshotUrl,
        viewport: snapshotInfo.expectedViewport,
      },
    );

    // Manifest ids "." and ".." must not escape the temporary directory.
    const safeId = createHash("sha256").update(candidate.id).digest("hex");
    const candidateTemp = join(tempRoot, `candidate-${safeId}`);
    const sourcePath = `${candidateTemp}-source.json`;
    const renderPath = `${candidateTemp}-render.json`;
    writeFileSync(sourcePath, JSON.stringify(source.parsed, null, 2), "utf8");
    writeFileSync(renderPath, JSON.stringify(render.parsed, null, 2), "utf8");

    fused = runNode(
      tools.fusionGate,
      ["--source-report", sourcePath, "--render-report", renderPath, "--json"],
      `Taste evidence fusion [${candidate.id}]`,
      new Set([0, 1]), "fusion", {
        sourceVerdict: source.parsed.verdict,
        renderVerdict: render.parsed.verdict,
        sourceReportPath: sourcePath,
        renderReportPath: renderPath,
        sourceHits: source.parsed.hits.length,
        renderHits: render.parsed.hits.length,
      },
    );
  }

  const sourceHold = source.status === 1 || source.parsed.verdict === "HOLD" || Number(source.parsed.p0 ?? 0) > 0;
  const contextualReview =
    source.parsed.verdict === "REVIEW"
    || source.parsed.verdict === "REVIEW_CLUSTER"
    || render?.parsed?.verdict === "REVIEW_RENDER"
    || render?.parsed?.verdict === "REVIEW_RENDER_CLUSTER"
    || fused?.parsed?.verdict === "REVIEW_FUSED"
    || fused?.parsed?.verdict === "REVIEW_FUSED_CLUSTER";

  const state = sourceHold
    ? "BLOCKED_SOURCE_HARD_GATE"
    : contextualReview
      ? "REVIEW_CONTEXTUAL_EVIDENCE"
      : render
        ? "MECHANICAL_EVIDENCE_CLEAR"
        : "SOURCE_CLEAR_RENDER_NOT_MEASURED";

  return {
    id: candidate.id,
    sourcePath: resolve(candidate.path),
    route: candidate.route,
    state,
    coverage: {
      source: "measured",
      render: render ? "measured" : "not_measured",
      fusion: fused ? "measured" : "not_applicable",
    },
    binding: binding ?? {
      verified: false,
      declaredRoute: null,
      snapshotRoute: null,
      snapshotPath: null,
      snapshotUrl: null,
      note: "No rendered snapshot was supplied; route binding is not applicable.",
    },
    verdicts: {
      source: source.parsed.verdict,
      render: render?.parsed?.verdict ?? null,
      fused: fused?.parsed?.verdict ?? null,
    },
    blocking: sourceHold
      ? {
          active: true,
          channel: "source",
          p0: Number(source.parsed.p0 ?? 0),
          note: "A source hard gate remains blocking. Rendered contextual evidence cannot soften it.",
        }
      : { active: false },
    review: {
      contextualEvidencePresent: Boolean(contextualReview),
      renderedMeasurementMissing: !render,
    },
    reports: {
      source: source.parsed,
      render: render?.parsed ?? null,
      fused: fused?.parsed ?? null,
    },
  };
}

function aggregateReceipt({ target, candidates, cross, crossBinding }) {
  const sourceHoldCandidates = candidates.filter((candidate) => candidate.blocking.active);
  const anyCandidateReview = candidates.some((candidate) => candidate.review.contextualEvidencePresent);
  const crossReview = cross?.value?.verdict === "REVIEW_CROSS_SURFACE";
  const anyRenderMissing = candidates.some((candidate) => candidate.coverage.render === "not_measured");
  const renderedCount = candidates.filter((candidate) => candidate.coverage.render === "measured").length;

  const state = sourceHoldCandidates.length
    ? "BLOCKED_SOURCE_HARD_GATE"
    : anyCandidateReview || crossReview
      ? "REVIEW_CONTEXTUAL_EVIDENCE"
      : anyRenderMissing
        ? "SOURCE_CLEAR_RENDER_NOT_MEASURED"
        : "MECHANICAL_EVIDENCE_CLEAR";

  const renderCoverage = renderedCount === candidates.length
    ? "measured"
    : renderedCount === 0
      ? "not_measured"
      : "partial";

  const receipt = {
    schemaVersion: 1,
    target,
    state,
    coverage: {
      source: "measured",
      render: renderCoverage,
      fusion: renderCoverage === "measured" ? "measured" : renderCoverage === "partial" ? "partial" : "not_applicable",
      crossSurface: cross ? "provided" : "not_provided",
    },
    candidates,
    crossSurfaceBinding: crossBinding,
    verdicts: {
      candidates: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.verdicts])),
      crossSurface: cross?.value?.verdict ?? null,
    },
    blocking: sourceHoldCandidates.length
      ? {
          active: true,
          channel: "source",
          candidates: sourceHoldCandidates.map((candidate) => candidate.id),
          note: "At least one candidate has a source hard gate. Rendered or cross-surface contextual evidence cannot soften it.",
        }
      : { active: false },
    review: {
      contextualEvidencePresent: Boolean(anyCandidateReview || crossReview),
      renderedMeasurementMissing: anyRenderMissing,
      crossSurfaceReviewPresent: crossReview,
    },
    reports: {
      candidates: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.reports])),
      crossSurface: cross?.value ?? null,
    },
    note: "This is a mechanical evidence receipt, not a visual quality verdict. Candidate source/render pairs are explicit and rendered pairs are route-bound to snapshot.url. SOURCE_CLEAR_RENDER_NOT_MEASURED means at least one candidate lacks rendered DOM measurement. Cross-surface evidence is attached separately and never contributes to source/render fusion scoring. Contextual review states still require the actual render, surface role, project intent, and applicable anti-slop gates. Never infer AI authorship from this receipt.",
  };

  return { receipt, sourceHold: sourceHoldCandidates.length > 0 };
}

function singleCandidateReceipt(candidate, cross) {
  const receipt = {
    schemaVersion: 1,
    target: candidate.sourcePath,
    state: candidate.state,
    coverage: {
      ...candidate.coverage,
      crossSurface: "not_provided",
    },
    binding: candidate.binding,
    verdicts: {
      ...candidate.verdicts,
      crossSurface: null,
    },
    blocking: candidate.blocking,
    review: {
      ...candidate.review,
      crossSurfaceReviewPresent: false,
    },
    reports: {
      ...candidate.reports,
      crossSurface: null,
    },
    note: "This is a mechanical evidence receipt, not a visual quality verdict. When rendered evidence is supplied, --route is mandatory and must match snapshot.url before source/render fusion can run. SOURCE_CLEAR_RENDER_NOT_MEASURED means rendered DOM evidence was not measured. Contextual review states still require the actual render, surface role, project intent, and applicable anti-slop gates. Never infer AI authorship from this receipt.",
  };
  return { receipt, sourceHold: candidate.blocking.active };
}

function main() {
  const argv = process.argv.slice(2);
  let args = { json: argv.includes("--json") };
  let tempDir = null;
  let output;
  let failure = null;
  try {
    args = parseArgs(argv);
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const tools = {
      sourceGate: resolve(scriptDir, "taste-gate.mjs"),
      renderGate: resolve(scriptDir, "render-taste-gate.mjs"),
      fusionGate: resolve(scriptDir, "taste-evidence-fusion.mjs"),
    };
    tempDir = mkdtempSync(join(tmpdir(), "taste-evidence-receipt-"));

    if (args.manifest) {
      const manifest = readManifest(args.manifest);
      const crossPath = args.crossSurfaceReport || manifest.crossSurfaceReport;
      const candidates = manifest.candidates.map((candidate) => runCandidate(candidate, tools, tempDir));
      const cross = crossPath ? readCrossSurface(crossPath) : null;
      const crossBinding = verifyCrossSurfaceBinding(cross, candidates);
      output = aggregateReceipt({
        target: manifest.path,
        candidates,
        cross,
        crossBinding,
      });
    } else {
      const candidate = runCandidate({
        id: "candidate",
        path: resolve(args.path),
        snapshot: args.snapshot ? resolve(args.snapshot) : null,
        route: args.route ? normalizeRoute(args.route) : null,
        intent: args.intent ? resolve(args.intent) : null,
        extensions: args.extensions,
      }, tools, tempDir);
      output = singleCandidateReceipt(candidate, null);
    }

  } catch (error) {
    failure = error;
  } finally {
    // Cleanup happens before the success receipt is emitted. Even an OS-level
    // EACCES/EPERM failure may contain private temp paths, so never echo it.
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        failure = new Error("Receipt temporary cleanup failed");
      }
    }
  }

  if (failure) {
    const message = safePublicError(failure);
    if (args?.json) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else console.error(message);
    process.exitCode = 2;
    return;
  }

  try {
    if (args.json) {
      process.stdout.write(`${JSON.stringify(output.receipt, null, 2)}\n`);
    } else {
      console.log("");
      console.log("design-with-ai taste evidence receipt");
      console.log(` target: ${output.receipt.target}`);
      console.log(` state: ${output.receipt.state}`);
      console.log(` render coverage: ${output.receipt.coverage.render}`);
      console.log(` cross-surface: ${output.receipt.coverage.crossSurface}`);
      console.log(` ${output.receipt.note}`);
    }
    process.exitCode = output.sourceHold ? 1 : 0;
  } catch (error) {
    const message = safePublicError(error);
    if (args?.json) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else console.error(message);
    process.exitCode = 2;
  }
}

main();
