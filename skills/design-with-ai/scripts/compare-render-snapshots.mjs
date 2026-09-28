#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = { snapshots: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--snapshot") {
      const value = argv[++i];
      if (!value) throw new Error("--snapshot requires a path");
      args.snapshots.push(value);
      continue;
    }
    if (!token.startsWith("-")) {
      args.snapshots.push(token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (args.snapshots.length < 2) {
    throw new Error("Usage: compare-render-snapshots.mjs --snapshot <a.json> --snapshot <b.json> [--snapshot <more.json>] [--json]");
  }
  return args;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${path}: ${error.message}`);
  }
}

function validateSnapshot(snapshot, path) {
  if (!snapshot || snapshot.schemaVersion !== 1) {
    throw new Error(`Unsupported or missing render snapshot schemaVersion: ${path}`);
  }
  if (!(snapshot.viewport?.width > 0) || !(snapshot.viewport?.height > 0)) {
    throw new Error(`Render snapshot viewport is missing or invalid: ${path}`);
  }
  if (!Array.isArray(snapshot.macroZones)) {
    throw new Error(`Render snapshot missing macroZones; recapture with the current render-snapshot.js: ${path}`);
  }
}

function viewportBand(width) {
  if (width <= 767) return "mobile";
  if (width <= 1100) return "tablet";
  return "desktop";
}

function routeKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname || "/";
  } catch {
    return String(url || "unknown");
  }
}

function zoneTokens(snapshot) {
  return snapshot.macroZones.map((zone) => `${zone.archetype}:${zone.widthBand}`);
}

function repeatedTokens(snapshot) {
  const tokens = [];
  for (const zone of snapshot.macroZones) {
    for (const count of zone.repeatedCounts ?? []) {
      tokens.push(`${zone.archetype}:${count}`);
    }
  }
  return [...new Set(tokens)].sort();
}

function lcsLength(a, b) {
  const cols = b.length + 1;
  const row = new Array(cols).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      if (a[i - 1] === b[j - 1]) row[j] = diagonal + 1;
      else row[j] = Math.max(row[j], row[j - 1]);
      diagonal = previous;
    }
  }
  return row[b.length];
}

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 0.5;
  const union = new Set([...left, ...right]);
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return union.size ? intersection / union.size : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function comparePair(left, right, rule) {
  const leftZones = zoneTokens(left.snapshot);
  const rightZones = zoneTokens(right.snapshot);
  const maxZones = Math.max(leftZones.length, rightZones.length, 1);
  const sequenceSimilarity = lcsLength(leftZones, rightZones) / maxZones;
  const repeatedSimilarity = jaccard(repeatedTokens(left.snapshot), repeatedTokens(right.snapshot));
  const zoneCountSimilarity = Math.min(leftZones.length, rightZones.length) / maxZones;
  const leftHero = leftZones[0]?.startsWith("hero-") ?? false;
  const rightHero = rightZones[0]?.startsWith("hero-") ?? false;
  const heroSimilarity = leftHero === rightHero ? 1 : 0;

  const similarity = round(
    sequenceSimilarity * 0.6
    + repeatedSimilarity * 0.2
    + heroSimilarity * 0.1
    + zoneCountSimilarity * 0.1,
  );

  const eligible = left.band === right.band
    && left.route !== right.route
    && leftZones.length >= rule.minimumZones
    && rightZones.length >= rule.minimumZones;

  const triggered = eligible && similarity >= rule.minimumSimilarity;

  return {
    left: left.route,
    right: right.route,
    viewportBand: left.band === right.band ? left.band : "mixed",
    eligible,
    triggered,
    similarity,
    minimumSimilarity: rule.minimumSimilarity,
    sequenceSimilarity: round(sequenceSimilarity),
    repeatedSimilarity: round(repeatedSimilarity),
    zoneCountSimilarity: round(zoneCountSimilarity),
    heroSimilarity,
    leftZones,
    rightZones,
  };
}

function loadRule(registry) {
  const rule = (registry.crossSurfaceRules ?? []).find((candidate) => candidate.id === "G02");
  if (!rule) throw new Error("Signal registry missing cross-surface G02 metadata");
  return {
    ...rule,
    minimumZones: Number(rule.minimumZones ?? 3),
    minimumSimilarity: Number(rule.minimumSimilarity ?? 0.84),
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const registry = readJson(resolve(scriptDir, "../references/slop-signals.json"), "Signal registry");
    const rule = loadRule(registry);

    const snapshots = args.snapshots.map((input) => {
      const path = resolve(input);
      if (!existsSync(path)) throw new Error(`Snapshot path not found: ${path}`);
      const snapshot = readJson(path, "Render snapshot");
      validateSnapshot(snapshot, path);
      return {
        path,
        snapshot,
        route: routeKey(snapshot.url),
        band: viewportBand(snapshot.viewport.width),
      };
    });

    const comparisons = [];
    for (let i = 0; i < snapshots.length; i += 1) {
      for (let j = i + 1; j < snapshots.length; j += 1) {
        comparisons.push(comparePair(snapshots[i], snapshots[j], rule));
      }
    }

    const hits = comparisons
      .filter((comparison) => comparison.triggered)
      .map((comparison) => ({
        id: rule.id,
        name: rule.name,
        family: rule.family,
        severity: rule.severity,
        evidenceGrade: rule.evidence?.grade ?? "unknown",
        left: comparison.left,
        right: comparison.right,
        viewportBand: comparison.viewportBand,
        similarity: comparison.similarity,
        minimumSimilarity: comparison.minimumSimilarity,
        sequenceSimilarity: comparison.sequenceSimilarity,
        repeatedSimilarity: comparison.repeatedSimilarity,
        leftZones: comparison.leftZones,
        rightZones: comparison.rightZones,
        note: rule.note,
      }));

    const result = {
      verdict: hits.length ? "REVIEW_CROSS_SURFACE" : "PASS_CROSS_SURFACE_EVIDENCE",
      snapshots: snapshots.map((item) => ({
        path: item.path,
        route: item.route,
        viewportBand: item.band,
        macroFingerprint: item.snapshot.macroFingerprint ?? null,
        zoneCount: item.snapshot.macroZones.length,
      })),
      hits,
      comparisons,
      note: "Cross-surface macro similarity is contextual evidence only. Shared shells, related workflow steps, and intentionally repeated systems can be valid. Adjudicate G02 against each surface's role, content assignment, and project design intent. Never infer AI authorship from this result.",
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      console.log("");
      console.log("design-with-ai cross-surface render review");
      console.log(` verdict: ${result.verdict}`);
      console.log(` snapshots: ${result.snapshots.length}`);
      console.log(` comparisons: ${result.comparisons.length}`);
      console.log(` G02 leads: ${result.hits.length}`);
      console.log(` ${result.note}`);
      console.log("");
      for (const hit of result.hits) {
        console.log(`${hit.id} ${hit.left} <-> ${hit.right} similarity=${hit.similarity}`);
      }
    }

    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args?.json) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else console.error(message);
    process.exitCode = 2;
  }
}

main();
