#!/usr/bin/env node
import {
  TAXONOMY,
  loadPatterns,
  loadRecords,
  parseArgs,
} from "./lib.mjs";
import { selectRecords } from "./selection.mjs";
import { selectPatterns } from "./pattern-selection.mjs";
import { recordUsage } from "./usage.mjs";

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
const { selected, selectedByStratum, coverageGaps, coverage } = selectRecords(
  loadRecords(),
  request,
);
const patterns = selectPatterns(loadPatterns(), selected, request);
let usageWarning = null;
if (!args["no-record-usage"]) {
  try {
    recordUsage(selected, request, args["usage-log"]);
  } catch (error) {
    usageWarning =
      "Selected records are valid, but local usage recording failed: " +
      (error instanceof Error ? error.message : String(error));
  }
}

console.log(
  JSON.stringify(
    {
      profile,
      requested: {
        surface: request.surface || null,
        platform: request.platform || null,
        job: args.job || null,
        dimensions: args.dimensions
          ? String(args.dimensions).split(",").filter(Boolean)
          : [],
        limit,
      },
      countsByStratum: selectedByStratum,
      coverage,
      coverageGaps,
      requiresTargetedResearch: coverageGaps.length > 0,
      usageWarning,
      records: selected,
      patterns,
    },
    null,
    2,
  ),
);
process.exitCode = coverageGaps.length ? 2 : 0;
