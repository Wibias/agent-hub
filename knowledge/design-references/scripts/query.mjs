#!/usr/bin/env node
import {
  TAXONOMY,
  loadPatterns,
  loadRecords,
  parseArgs,
} from "./lib.mjs";
import { fetchP10QuickCandidatePool } from "../../../reference-graph/p10-runtime-client.mjs";
import { runP11RuntimeQuery } from "../../../reference-graph/p11-runtime-router.mjs";

const args = parseArgs(process.argv.slice(2));
for (const required of ["surface", "job", "platform", "dimensions"]) {
  if (!args[required]) throw new Error("Missing --" + required);
}
const profile = args.profile || "standard";
const profilePolicy = TAXONOMY.profiles[profile];
if (!profilePolicy) {
  throw new Error("Unknown profile: " + profile);
}
const limit = Number(args.limit || profilePolicy.default);
if (
  !Number.isInteger(limit) ||
  limit < profilePolicy.min ||
  limit > profilePolicy.max
) {
  throw new Error(
    "Limit for " +
      profile +
      " must be " +
      profilePolicy.min +
      "-" +
      profilePolicy.max,
  );
}

const request = {
  profile,
  limit,
  surface: args.surface || "",
  platform: args.platform || "",
  job: args.job || "",
  dimensions: args.dimensions || "",
};
const now = new Date();
const graphMode = process.env.REFERENCE_GRAPH_QUICK_RUNTIME || "legacy";
const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();

let fetchCandidatePool;
if (
  request.profile === "quick" &&
  graphMode === "graph" &&
  supabaseUrl &&
  publishableKey
) {
  const expectedDate = now.toISOString().slice(0, 10);
  fetchCandidatePool = () =>
    fetchP10QuickCandidatePool({
      supabaseUrl,
      publishableKey,
      timeoutMs: 1500,
      expectedDate,
    });
}

const { result } = await runP11RuntimeQuery({
  records: loadRecords(),
  patterns: loadPatterns(),
  request,
  graphMode,
  fetchCandidatePool,
  recordUsageEnabled: !args["no-record-usage"],
  usageLogPath: args["usage-log"],
  now,
});

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.coverageGaps.length ? 2 : 0;
