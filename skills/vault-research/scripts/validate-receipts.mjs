#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) {
  console.error("usage: node validate-receipts.mjs <receipts.jsonl>");
  process.exit(2);
}

const allowedClaimTypes = new Set([
  "direct-fact",
  "performance",
  "community-sentiment",
  "analysis",
  "other",
]);
const allowedStatuses = new Set([
  "VERIFIED",
  "SUPPORTED",
  "CONTESTED",
  "UNCONFIRMED",
  "STALE",
  "BLOCKED",
]);
const allowedGates = new Set(["pass", "fail", "blocked"]);
const allowedEvidenceRoles = new Set(["lead", "proof"]);
const allowedEvidenceClasses = new Set([
  "primary",
  "direct-measurement",
  "independent-secondary",
  "practitioner",
  "aggregator",
]);
const allowedStances = new Set(["supports", "contradicts", "context"]);
const allowedCoverage = new Set([
  "ok",
  "no-results",
  "partial",
  "rate-limited",
  "auth-failed",
  "unreachable",
  "timeout",
  "schema-drift",
  "skipped-unconfigured",
  "error",
]);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function parseDate(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    fail(`${label} must be an ISO-like date or null`);
    return null;
  }
  return new Date(value);
}

const path = resolve(input);
let text;
try {
  text = readFileSync(path, "utf8");
} catch (error) {
  console.error(`cannot read ${path}: ${error.message}`);
  process.exit(2);
}

const rows = [];
for (const [index, raw] of text.split(/\r?\n/).entries()) {
  if (!raw.trim()) continue;
  try {
    rows.push({ line: index + 1, row: JSON.parse(raw) });
  } catch (error) {
    fail(`line ${index + 1}: invalid JSON: ${error.message}`);
  }
}

if (rows.length === 0) {
  fail("receipt file is empty");
}

const claims = new Map();
const evidence = [];
const coverage = [];

for (const { line, row } of rows) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    fail(`line ${line}: record must be an object`);
    continue;
  }

  if (row.record_type === "claim") {
    if (typeof row.claim_id !== "string" || !row.claim_id.trim()) {
      fail(`line ${line}: claim_id is required`);
      continue;
    }
    if (claims.has(row.claim_id)) fail(`line ${line}: duplicate claim_id ${row.claim_id}`);
    if (typeof row.claim !== "string" || !row.claim.trim()) fail(`line ${line}: claim text is required`);
    if (!allowedClaimTypes.has(row.claim_type)) fail(`line ${line}: invalid claim_type`);
    if (typeof row.material !== "boolean") fail(`line ${line}: material must be boolean`);
    if (!allowedStatuses.has(row.verification_status)) fail(`line ${line}: invalid verification_status`);
    if (typeof row.counterevidence_checked !== "boolean") fail(`line ${line}: counterevidence_checked must be boolean`);
    for (const key of ["correctness_gate", "recency_gate", "source_quality_gate"]) {
      if (!allowedGates.has(row[key])) fail(`line ${line}: ${key} must be pass, fail, or blocked`);
    }
    parseDate(row.expires_at ?? null, `line ${line}: expires_at`);
    claims.set(row.claim_id, { line, row });
    continue;
  }

  if (row.record_type === "evidence") {
    if (typeof row.claim_id !== "string" || !row.claim_id.trim()) fail(`line ${line}: evidence claim_id is required`);
    if (!allowedEvidenceRoles.has(row.evidence_role)) fail(`line ${line}: invalid evidence_role`);
    if (!allowedEvidenceClasses.has(row.evidence_class)) fail(`line ${line}: invalid evidence_class`);
    if (typeof row.surface !== "string" || !row.surface.trim()) fail(`line ${line}: surface is required`);
    if (typeof row.source_url !== "string" || !/^https?:\/\//.test(row.source_url)) fail(`line ${line}: source_url must be http(s)`);
    if (typeof row.independence_group !== "string" || !row.independence_group.trim()) fail(`line ${line}: independence_group is required`);
    if (!allowedStances.has(row.stance)) fail(`line ${line}: invalid stance`);
    parseDate(row.observed_at, `line ${line}: observed_at`);
    parseDate(row.last_verified_at, `line ${line}: last_verified_at`);
    if (row.source_published_at !== undefined) parseDate(row.source_published_at, `line ${line}: source_published_at`);
    evidence.push({ line, row });
    continue;
  }

  if (row.record_type === "coverage") {
    if (typeof row.surface !== "string" || !row.surface.trim()) fail(`line ${line}: coverage surface is required`);
    if (!allowedCoverage.has(row.source_status)) fail(`line ${line}: invalid source_status`);
    parseDate(row.observed_at, `line ${line}: observed_at`);
    coverage.push({ line, row });
    continue;
  }

  fail(`line ${line}: record_type must be claim, evidence, or coverage`);
}

const now = new Date();

for (const [claimId, { line, row: claim }] of claims) {
  const related = evidence.filter(({ row }) => row.claim_id === claimId);
  if (related.length === 0) fail(`claim ${claimId}: no evidence records`);

  const proofSupports = related.filter(
    ({ row }) => row.evidence_role === "proof" && row.stance === "supports",
  );
  const supportGroups = new Set(proofSupports.map(({ row }) => row.independence_group));
  const surfaces = new Set(proofSupports.map(({ row }) => row.surface));
  const classes = new Set(proofSupports.map(({ row }) => row.evidence_class));
  const hasPrimary = classes.has("primary");
  const hasMeasurement = classes.has("direct-measurement");
  const hasIndependentSecondary = classes.has("independent-secondary");
  const expires = claim.expires_at === null ? null : parseDate(claim.expires_at, `claim ${claimId}: expires_at`);

  if (claim.verification_status === "VERIFIED") {
    for (const key of ["correctness_gate", "recency_gate", "source_quality_gate"]) {
      if (claim[key] !== "pass") fail(`claim ${claimId}: VERIFIED requires ${key}=pass`);
    }
    if (claim.material && !claim.counterevidence_checked) {
      fail(`claim ${claimId}: material VERIFIED claim requires counterevidence_checked=true`);
    }
    if (expires && expires < now) fail(`claim ${claimId}: VERIFIED claim is expired`);
    if (proofSupports.length === 0) fail(`claim ${claimId}: VERIFIED claim has no supporting proof evidence`);

    if (claim.claim_type === "direct-fact" && !hasPrimary && supportGroups.size < 2) {
      fail(`claim ${claimId}: direct-fact VERIFIED requires primary proof or two independent proof lineages`);
    }

    if (claim.claim_type === "performance") {
      const independentPath = supportGroups.size >= 2 && (hasIndependentSecondary || hasMeasurement);
      if (!hasMeasurement && !independentPath) {
        fail(`claim ${claimId}: performance VERIFIED requires direct measurement or two independent proof lineages with independent evidence`);
      }
    }

    if (claim.claim_type === "community-sentiment") {
      if (supportGroups.size < 3) fail(`claim ${claimId}: community-sentiment VERIFIED requires at least three independent lineages`);
      if (surfaces.size < 2) fail(`claim ${claimId}: community-sentiment VERIFIED requires at least two surfaces`);
    }

    if ((claim.claim_type === "analysis" || claim.claim_type === "other") && !hasPrimary && supportGroups.size < 2) {
      fail(`claim ${claimId}: VERIFIED analysis/other claim requires primary proof or two independent proof lineages`);
    }
  }

  const contradicts = related.some(({ row }) => row.evidence_role === "proof" && row.stance === "contradicts");
  if (contradicts && claim.verification_status === "VERIFIED") {
    fail(`claim ${claimId}: VERIFIED claim has contradictory proof; reconcile or mark CONTESTED`);
  }

  if (claim.verification_status === "STALE" && expires && expires >= now) {
    fail(`claim ${claimId}: STALE claim has not expired`);
  }

  if (claim.verification_status === "BLOCKED" && claim.source_quality_gate === "pass" && claim.recency_gate === "pass" && claim.correctness_gate === "pass") {
    fail(`claim ${claimId}: BLOCKED claim cannot have every hard gate pass`);
  }

}

for (const { line, row } of evidence) {
  if (!claims.has(row.claim_id)) fail(`line ${line}: evidence references unknown claim_id ${row.claim_id}`);
  if (row.evidence_role === "lead" && row.evidence_class !== "aggregator" && row.stance === "supports") {
    // This is allowed, but it remains a lead and never counts toward verification.
  }
}

if (!process.exitCode) {
  console.log(
    `validated ${claims.size} claims, ${evidence.length} evidence records, and ${coverage.length} coverage records`,
  );
}
