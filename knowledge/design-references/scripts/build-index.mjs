#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  PATTERN_DIR,
  analysisSignature,
  countBy,
  loadRecords,
  listJsonlFiles,
  normalizeUrl,
  readJsonl,
  recordSearchText,
  stripInternal,
} from "./lib.mjs";

const records = loadRecords()
  .map((record) => ({
    ...stripInternal(record),
    canonicalUrl: normalizeUrl(record.canonicalUrl),
    analysisSignature: analysisSignature(record),
    searchText: recordSearchText(record).toLowerCase().replace(/\s+/g, " "),
  }))
  .sort((left, right) => left.id.localeCompare(right.id));
const patterns = listJsonlFiles(PATTERN_DIR)
  .flatMap((file) => readJsonl(file))
  .sort((left, right) => left.id.localeCompare(right.id));

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  counts: {
    total: records.length,
    status: countBy(records, "reviewStatus"),
    strata: countBy(records, "primaryStratum"),
    surfaces: countBy(records, "surfaceFamily"),
    platforms: countBy(records, "platform"),
  },
  records,
  patterns,
};

const lines = [
  "# Design Reference Index",
  "",
  "Generated: " + index.generatedAt,
  "",
  "Records: " + records.length,
  "Patterns: " + patterns.length,
  "",
  "## Counts",
  "",
  "- Status: " + JSON.stringify(index.counts.status),
  "- Strata: " + JSON.stringify(index.counts.strata),
  "- Platforms: " + JSON.stringify(index.counts.platforms),
  "",
  "## Surface families",
  "",
  ...Object.entries(index.counts.surfaces)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([surface, count]) => "- " + surface + ": " + count),
  "",
];

writeFileSync(
  join(ROOT, "index.json"),
  JSON.stringify(index, null, 2) + "\n",
  "utf8",
);
writeFileSync(join(ROOT, "INDEX.md"), lines.join("\n"), "utf8");
console.log(
  JSON.stringify(
    {
      ok: true,
      records: records.length,
      index: join(ROOT, "index.json"),
      markdown: join(ROOT, "INDEX.md"),
    },
    null,
    2,
  ),
);
