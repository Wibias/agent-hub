import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  analysisSignature,
  duplicateKey,
  validateRecord,
} from "../scripts/lib.mjs";
import {
  allocateDeep,
  selectRecords,
} from "../scripts/selection.mjs";
import { loadUsageCounts, recordUsage } from "../scripts/usage.mjs";
import { selectPatterns } from "../scripts/pattern-selection.mjs";

const today = new Date().toISOString().slice(0, 10);

function makeRecord(index, stratum, overrides = {}) {
  return {
    id: "ref-fixture-" + stratum + "-" + index,
    title: "Fixture " + index,
    canonicalUrl: "https://example.com/" + stratum + "/" + index,
    product: "Product " + index,
    surfaceFamily: "operator-control",
    primaryStratum: stratum,
    platform: "web-responsive",
    flowStates: ["initial", "active"],
    evidenceClass: stratum === "evidence-craft" ? "TESTED" : "OBSERVED",
    accessStatus: "AVAILABLE",
    accessMethod: "public web",
    storagePolicy: "text-link-only",
    pageRole: "Operator console " + index,
    firstScreenJob: "Launch and resume work " + index,
    topology: "Rundown topology " + index,
    traversal: "Scan status then launch tool " + index,
    density: "high",
    responsiveBehavior: "Stacks controls below status on narrow screens " + index,
    motion: "State changes use restrained transitions " + index,
    visualWorld: "Broadcast utility " + index,
    strengths: ["Immediate operational priority " + index],
    weaknesses: ["Dense for first-time users " + index],
    transferableDecisions: ["Keep active work above catalog " + index],
    tags: ["operator", "broadcast", "launch"],
    sourceFamily: "fixture-source-" + index,
    sourceKind: "underlying-product",
    observedAt: today,
    lastVerifiedAt: today,
    ttlDays: 90,
    reviewStatus: "reviewed",
    researchedBy: "researcher",
    reviewedBy: "reviewer",
    reviewedAt: today,
    rightsNote: "Text and link only.",
    provenanceNote: "Synthetic test fixture.",
    ordinaryOrFailureProne: index % 5 === 0,
    multiStateFlow: index % 3 === 0,
    replacementFor: null,
    ...overrides,
  };
}

test("deep quota allocation is bounded and sums to requested size", () => {
  for (const total of [20, 28, 40]) {
    const quotas = allocateDeep(total);
    assert.equal(
      Object.values(quotas).reduce((sum, count) => sum + count, 0),
      total,
    );
    assert.ok(quotas["direct-domain"] >= 6);
    assert.ok(quotas["adjacent-domain"] >= 5);
    assert.ok(quotas["outside-domain"] >= 4);
    assert.ok(quotas["evidence-craft"] >= 5);
  }
});

test("selector returns deterministic, fresh, reviewed deep sample", () => {
  const quotas = allocateDeep(28);
  const records = Object.entries(quotas).flatMap(([stratum, count]) =>
    Array.from({ length: count + 2 }, (_, index) =>
      makeRecord(index, stratum),
    ),
  );
  records.push(
    makeRecord(90, "direct-domain", { reviewStatus: "candidate" }),
    makeRecord(91, "direct-domain", {
      lastVerifiedAt: "2020-01-01",
      ttlDays: 60,
    }),
    makeRecord(92, "direct-domain", { accessStatus: "BLOCKED" }),
  );
  const request = {
    profile: "deep",
    limit: 28,
    surface: "operator-control",
    platform: "web-responsive",
    job: "launch resume operator",
    dimensions: "ia,visual-world,responsive",
  };
  const first = selectRecords(records, request);
  const second = selectRecords([...records].reverse(), request);
  assert.equal(first.selected.length, 28);
  assert.deepEqual(first.coverageGaps, []);
  assert.deepEqual(
    first.selected.map((record) => record.id),
    second.selected.map((record) => record.id),
  );
  assert.ok(
    first.selected.every(
      (record) =>
        record.reviewStatus === "reviewed" &&
        record.lastVerifiedAt !== "2020-01-01" &&
        record.accessStatus !== "BLOCKED",
    ),
  );
  assert.deepEqual(first.selectedByStratum, quotas);
});

test("selector reports surface and platform relevance gaps", () => {
  const quotas = allocateDeep(20);
  const records = Object.entries(quotas).flatMap(([stratum, count]) =>
    Array.from({ length: count }, (_, index) =>
      makeRecord(index, stratum, {
        surfaceFamily: "editorial-experimental",
        platform: "native-mobile",
      }),
    ),
  );
  const result = selectRecords(records, {
    profile: "deep",
    limit: 20,
    surface: "operator-control",
    platform: "web-responsive",
    job: "operate a live production",
    dimensions: "ia,density",
  });
  assert.ok(result.coverageGaps.some((gap) => gap.kind === "surface"));
  assert.ok(result.coverageGaps.some((gap) => gap.kind === "platform"));
});

test("record validation enforces independent review and rights basis", () => {
  const valid = makeRecord(1, "direct-domain");
  assert.deepEqual(validateRecord(valid, { requireReviewed: true }), []);
  const invalid = {
    ...valid,
    storagePolicy: "local-cache-permitted",
    rightsNote: "Unknown",
    reviewedBy: valid.researchedBy,
  };
  const errors = validateRecord(invalid, { requireReviewed: true });
  assert.ok(errors.some((error) => error.includes("rights basis")));
  assert.ok(errors.some((error) => error.includes("reviewer must differ")));
});

test("record validation accepts the access and pricing TTL policy", () => {
  const record = makeRecord(2, "direct-domain", { ttlDays: 30 });
  assert.deepEqual(validateRecord(record, { requireReviewed: true }), []);
});

test("record validation rejects schema drift in dates, arrays, and source kind", () => {
  const invalid = makeRecord(8, "direct-domain", {
    flowStates: ["active", "active"],
    sourceKind: "gallery",
    observedAt: "2026-02-30",
    replacementFor: "not-a-reference",
  });
  const errors = validateRecord(invalid, { requireReviewed: true });
  assert.ok(errors.some((error) => error.includes("duplicate values")));
  assert.ok(errors.some((error) => error.includes("sourceKind")));
  assert.ok(errors.some((error) => error.includes("observedAt")));
  assert.ok(errors.some((error) => error.includes("replacementFor")));
});

test("review batch rejects duplicate and unknown review decisions", () => {
  const directory = mkdtempSync(join(tmpdir(), "design-reference-review-"));
  const input = join(directory, "input.jsonl");
  const reviews = join(directory, "reviews.jsonl");
  const output = join(directory, "output.jsonl");
  const reviewScript = fileURLToPath(
    new URL("../scripts/review-batch.mjs", import.meta.url),
  );
  const candidate = makeRecord(3, "direct-domain", {
    reviewStatus: "candidate",
    reviewedBy: null,
    reviewedAt: null,
  });
  writeFileSync(input, JSON.stringify(candidate) + "\n", "utf8");
  const decision = {
    id: candidate.id,
    verdict: "approve",
    reviewer: "independent-reviewer",
    reviewedAt: today,
    sourceChecked: true,
    rightsChecked: true,
    duplicateChecked: true,
    notes: "Source and analysis checked independently.",
  };
  writeFileSync(
    reviews,
    [decision, decision].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  const duplicate = spawnSync(
    process.execPath,
    [
      reviewScript,
      "--input",
      input,
      "--review-log",
      reviews,
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /duplicate review decision/);

  writeFileSync(
    reviews,
    JSON.stringify({ ...decision, id: "ref-not-in-input" }) + "\n",
    "utf8",
  );
  const unknown = spawnSync(
    process.execPath,
    [
      reviewScript,
      "--input",
      input,
      "--review-log",
      reviews,
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /without candidates/);
  assert.equal(readFileSync(input, "utf8").trim().length > 0, true);
});

test("review batch rejects duplicate candidate IDs", () => {
  const directory = mkdtempSync(join(tmpdir(), "design-reference-candidates-"));
  const input = join(directory, "input.jsonl");
  const reviews = join(directory, "reviews.jsonl");
  const output = join(directory, "output.jsonl");
  const candidate = makeRecord(7, "outside-domain", {
    reviewStatus: "candidate",
    reviewedBy: null,
    reviewedAt: null,
  });
  writeFileSync(
    input,
    [candidate, candidate].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    reviews,
    JSON.stringify({
      id: candidate.id,
      verdict: "approve",
      reviewer: "independent-reviewer",
      reviewedAt: today,
      sourceChecked: true,
      rightsChecked: true,
      duplicateChecked: true,
      notes: "Source and analysis checked independently.",
    }) + "\n",
    "utf8",
  );
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/review-batch.mjs", import.meta.url)),
      "--input",
      input,
      "--review-log",
      reviews,
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Duplicate candidate IDs/);
});

test("duplicate keys and analysis signatures are stable", () => {
  const first = makeRecord(1, "direct-domain");
  const reordered = {
    ...first,
    flowStates: [...first.flowStates].reverse(),
    canonicalUrl: first.canonicalUrl + "#fragment",
  };
  assert.equal(duplicateKey(first), duplicateKey(reordered));
  assert.equal(analysisSignature(first), analysisSignature(reordered));
});

test("usage events count each selected record once per query", () => {
  const directory = mkdtempSync(join(tmpdir(), "design-reference-usage-"));
  const usageLog = join(directory, "usage.jsonl");
  const selected = [
    makeRecord(1, "direct-domain"),
    makeRecord(2, "adjacent-domain"),
    makeRecord(1, "direct-domain"),
  ];
  recordUsage(
    selected,
    { profile: "deep", surface: "operator-control", platform: "web-responsive" },
    usageLog,
  );
  recordUsage(
    [selected[0]],
    { profile: "quick", surface: "operator-control", platform: "web-responsive" },
    usageLog,
  );
  const counts = loadUsageCounts(usageLog);
  assert.equal(counts.get(selected[0].id), 2);
  assert.equal(counts.get(selected[1].id), 1);
});

test("pattern selection excludes unreviewed cards and favors linked evidence", () => {
  const records = [makeRecord(1, "direct-domain")];
  const base = {
    name: "Resume first",
    problem: "Users need to continue interrupted work.",
    worksWhen: ["A resumable state exists."],
    failsWhen: ["There is no saved state."],
    examples: [records[0].id],
    counterexamples: ["ref-other"],
    evidenceStrength: "medium",
    lastSynthesizedAt: today,
    tags: ["resume", "home"],
    synthesizedBy: "synthesizer",
    reviewedBy: "reviewer",
    reviewedAt: today,
  };
  const selected = selectPatterns(
    [
      { ...base, id: "pattern-reviewed", reviewStatus: "reviewed" },
      { ...base, id: "pattern-candidate", reviewStatus: "candidate" },
    ],
    records,
    {
      profile: "deep",
      surface: "authenticated-home",
      job: "resume work",
      dimensions: "ia",
    },
  );
  assert.deepEqual(selected.map((pattern) => pattern.id), ["pattern-reviewed"]);
});

test("pattern review promotes an independently approved candidate", () => {
  const directory = mkdtempSync(join(tmpdir(), "design-pattern-review-"));
  const input = join(directory, "input.jsonl");
  const reviews = join(directory, "reviews.jsonl");
  const output = join(directory, "output.jsonl");
  const candidate = {
    id: "pattern-resume-before-catalog",
    name: "Resume before catalog",
    problem: "Returning users need to continue interrupted work quickly.",
    worksWhen: ["A trustworthy resumable state exists."],
    failsWhen: ["The saved state is invalid or unsafe to restore."],
    examples: ["ref-example"],
    counterexamples: ["ref-counterexample"],
    evidenceStrength: "medium",
    lastSynthesizedAt: today,
    tags: ["resume", "home"],
    reviewStatus: "candidate",
    synthesizedBy: "pattern-synthesizer",
    reviewedBy: null,
    reviewedAt: null,
  };
  writeFileSync(input, JSON.stringify(candidate) + "\n", "utf8");
  writeFileSync(
    reviews,
    JSON.stringify({
      id: candidate.id,
      verdict: "approve",
      reviewer: "pattern-reviewer",
      reviewedAt: today,
      sourceChecked: true,
      rightsChecked: true,
      duplicateChecked: true,
      notes: "Examples and counterexamples checked against their source records.",
    }) + "\n",
    "utf8",
  );
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/review-patterns.mjs", import.meta.url)),
      "--input",
      input,
      "--review-log",
      reviews,
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const [reviewed] = readFileSync(output, "utf8")
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
  assert.equal(reviewed.reviewStatus, "reviewed");
  assert.equal(reviewed.reviewedBy, "pattern-reviewer");
});
