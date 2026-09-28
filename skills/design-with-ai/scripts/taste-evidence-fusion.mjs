#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = { source: null, render: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") args.json = true;
    else if (token === "--source-report") args.source = argv[++i];
    else if (token === "--render-report") args.render = argv[++i];
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.source || !args.render) {
    throw new Error("Usage: taste-evidence-fusion.mjs --source-report <taste-gate.json> --render-report <render-taste-gate.json> [--json]");
  }
  return args;
}

function readJson(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`${label} path not found: ${absolute}`);
  try {
    return { path: absolute, value: JSON.parse(readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${absolute}: ${error.message}`);
  }
}

function validateSource(report) {
  if (!report || typeof report !== "object") throw new Error("Source report must be an object");
  if (!["HOLD","REVIEW_CLUSTER","REVIEW","PASS_MECHANICAL"].includes(report.verdict)) {
    throw new Error("Source report has unsupported verdict");
  }
  if (!report.cluster || !Array.isArray(report.cluster.families)) {
    throw new Error("Source report missing cluster families");
  }
  if (!Array.isArray(report.hits)) throw new Error("Source report missing hits");
}

function validateRender(report) {
  if (!report || typeof report !== "object") throw new Error("Render report must be an object");
  if (!["PASS_RENDER_EVIDENCE","REVIEW_RENDER","REVIEW_RENDER_CLUSTER"].includes(report.verdict)) {
    throw new Error("Render report has unsupported verdict");
  }
  if (!report.cluster || !Array.isArray(report.cluster.families)) {
    throw new Error("Render report missing cluster families");
  }
  if (!Array.isArray(report.hits)) throw new Error("Render report missing hits");
}

function thresholdPair(report, label) {
  const familyMinimum = Number(report.cluster.minimumIndependentFamilies);
  const scoreMinimum = Number(report.cluster.minimumScore);
  if (!Number.isFinite(familyMinimum) || !Number.isFinite(scoreMinimum)) {
    throw new Error(`${label} report missing cluster thresholds`);
  }
  return { familyMinimum, scoreMinimum };
}

function normalizedFamily(row, channel) {
  const score = Number(row.score ?? row.weight ?? 0);
  if (!row.family || !Number.isFinite(score)) {
    throw new Error(`Invalid ${channel} family row`);
  }
  return {
    family: row.family,
    score,
    ruleIds: [...new Set(row.ruleIds ?? [])].sort(),
    channels: [channel],
    channelScores: { [channel]: score },
  };
}

function fuseFamilies(sourceFamilies, renderFamilies) {
  const families = new Map();

  for (const row of sourceFamilies.map((value) => normalizedFamily(value, "source"))) {
    families.set(row.family, row);
  }

  for (const row of renderFamilies.map((value) => normalizedFamily(value, "render"))) {
    const current = families.get(row.family);
    if (!current) {
      families.set(row.family, row);
      continue;
    }
    current.score = Math.max(current.score, row.score);
    current.ruleIds = [...new Set([...current.ruleIds, ...row.ruleIds])].sort();
    current.channels = [...new Set([...current.channels, "render"])].sort();
    current.channelScores.render = row.score;
  }

  return [...families.values()].sort((a, b) =>
    b.score - a.score || a.family.localeCompare(b.family)
  );
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const source = readJson(args.source, "Source report");
    const render = readJson(args.render, "Render report");
    validateSource(source.value);
    validateRender(render.value);

    const sourceThresholds = thresholdPair(source.value, "Source");
    const renderThresholds = thresholdPair(render.value, "Render");
    if (
      sourceThresholds.familyMinimum !== renderThresholds.familyMinimum
      || sourceThresholds.scoreMinimum !== renderThresholds.scoreMinimum
    ) {
      throw new Error("Source/render reports use different cluster thresholds");
    }

    const families = fuseFamilies(
      source.value.cluster.families,
      render.value.cluster.families,
    );
    const score = families.reduce((sum, row) => sum + row.score, 0);
    const independentFamilies = families.length;
    const clusterTriggered =
      independentFamilies >= sourceThresholds.familyMinimum
      && score >= sourceThresholds.scoreMinimum;

    const sourceHold = source.value.verdict === "HOLD" || Number(source.value.p0 ?? 0) > 0;
    const hasContextualEvidence =
      source.value.hits.length > 0 || render.value.hits.length > 0;

    const verdict = sourceHold
      ? "HOLD"
      : clusterTriggered
        ? "REVIEW_FUSED_CLUSTER"
        : hasContextualEvidence
          ? "REVIEW_FUSED"
          : "PASS_FUSED_EVIDENCE";

    const result = {
      verdict,
      reports: {
        source: source.path,
        render: render.path,
      },
      channels: {
        sourceVerdict: source.value.verdict,
        renderVerdict: render.value.verdict,
      },
      cluster: {
        independentFamilies,
        score,
        minimumIndependentFamilies: sourceThresholds.familyMinimum,
        minimumScore: sourceThresholds.scoreMinimum,
        families,
      },
      hardGate: sourceHold
        ? {
            channel: "source",
            p0: Number(source.value.p0 ?? 0),
            note: "A mechanically decisive source P0 remains blocking and cannot be softened by rendered evidence.",
          }
        : null,
      note: "Source and rendered evidence are fused by semantic family using the maximum score per family, never by summing the same family twice. Contextual fused clusters still require project intent and rendered adjudication. This report never infers AI authorship.",
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      console.log("");
      console.log("design-with-ai taste evidence fusion");
      console.log(` verdict: ${result.verdict}`);
      console.log(` cluster: ${independentFamilies} families / score ${score}`);
      console.log(` source: ${result.channels.sourceVerdict}`);
      console.log(` render: ${result.channels.renderVerdict}`);
      console.log(` ${result.note}`);
      console.log("");
      for (const family of families) {
        console.log(`${family.family}: ${family.score} [${family.channels.join("+")}] (${family.ruleIds.join(", ")})`);
      }
    }

    process.exitCode = sourceHold ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args?.json) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else console.error(message);
    process.exitCode = 2;
  }
}

main();
