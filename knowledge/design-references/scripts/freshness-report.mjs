#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import {
  daysSince,
  isFresh,
  loadRecords,
  parseArgs,
} from "./lib.mjs";
import { loadUsageCounts } from "./usage.mjs";

const args = parseArgs(process.argv.slice(2));
const records = loadRecords();
const offline = Boolean(args.offline);
const concurrency = Math.max(1, Math.min(10, Number(args.concurrency || 6)));
const usageCounts = loadUsageCounts(args["usage-log"]);
const queue = records.map((record) => ({
  id: record.id,
  url: record.canonicalUrl,
  ageDays: daysSince(record.lastVerifiedAt),
  ttlDays: record.ttlDays,
  staleByPolicy: !isFresh(record),
  reviewStatus: record.reviewStatus,
  usageCount: usageCounts.get(record.id) || 0,
  riskScore:
    Number(record.accessStatus === "PAYWALLED") * 2 +
    Number(record.storagePolicy === "local-cache-permitted") * 2 +
    Number(record.ttlDays <= 60) * 2 +
    Number(record.evidenceClass === "MARKETING_CLAIM"),
  httpStatus: null,
  finalUrl: null,
  linkError: null,
}));

async function inspectLink(item) {
  if (offline) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    let response = await fetch(item.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "design-reference-health-check/1.0" },
    });
    if ([403, 405].includes(response.status)) {
      response = await fetch(item.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "design-reference-health-check/1.0",
          range: "bytes=0-1023",
        },
      });
    }
    item.httpStatus = response.status;
    item.finalUrl = response.url;
  } catch (error) {
    item.linkError = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timeout);
  }
}

let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const item = queue[cursor];
    cursor += 1;
    await inspectLink(item);
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const maintainable = queue.filter((item) => item.reviewStatus !== "archived");
const quarterlyTarget = Math.ceil(maintainable.length * 0.15);
const reviewQueue = [...maintainable]
  .sort(
    (left, right) =>
      Number(right.staleByPolicy) - Number(left.staleByPolicy) ||
      right.riskScore - left.riskScore ||
      right.usageCount - left.usageCount ||
      right.ageDays - left.ageDays ||
      left.id.localeCompare(right.id),
  )
  .slice(0, quarterlyTarget);
const report = {
  generatedAt: new Date().toISOString(),
  mode: offline ? "offline" : "live",
  total: records.length,
  archived: queue.filter((item) => item.reviewStatus === "archived").length,
  stale: queue.filter((item) => item.staleByPolicy).length,
  linkFailures: queue.filter(
    (item) =>
      item.linkError ||
      (item.httpStatus !== null && item.httpStatus >= 400),
  ).length,
  quarterlyTarget,
  reviewQueue,
  records: queue,
};
const payload = JSON.stringify(report, null, 2) + "\n";
if (args.out) writeFileSync(String(args.out), payload, "utf8");
console.log(payload.trimEnd());
