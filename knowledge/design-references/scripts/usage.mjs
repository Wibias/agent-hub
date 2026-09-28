import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_USAGE_LOG = join(
  homedir(),
  ".agents",
  ".cache",
  "design-references",
  "usage.jsonl",
);

export function recordUsage(selected, request, file = DEFAULT_USAGE_LOG) {
  if (!selected.length) return;
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(
    target,
    JSON.stringify({
      queriedAt: new Date().toISOString(),
      profile: request.profile,
      surface: request.surface,
      platform: request.platform,
      recordIds: selected.map((record) => record.id),
    }) + "\n",
    "utf8",
  );
}

export function loadUsageCounts(file = DEFAULT_USAGE_LOG) {
  const counts = new Map();
  if (!existsSync(file)) return counts;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(event.recordIds)) continue;
    for (const id of new Set(event.recordIds)) {
      if (typeof id === "string") counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}
