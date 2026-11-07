// Evidence-only fusion. Never substitutes for taste-evidence-fusion.mjs or DWA receipts.
import { createHash } from "node:crypto";
import { assertProviderReport, ProviderStatus } from "./contract.mjs";

const filled = (x) => typeof x === "string" && x.trim().length > 0;
const hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const allowedProviders = new Set(["native-dwa", "impeccable", "taste-skill"]);
const prio = { P0: 3, P1: 2, P2: 1 };
const success = new Set([ProviderStatus.PASS, ProviderStatus.FINDINGS]);
const TASTE_CLASSES = new Set([
  "POTENTIAL_USABILITY", "GEOMETRY_NEEDS_VISUAL_REVIEW",
  "CONTEXTUAL_HOUSE_RULE", "UNCLASSIFIED_HEURISTIC",
]);

// Taste's extra fields are review labels, not acceptance or de-duplication
// keys. Never let arbitrary strings from a provider enter the fused record.
function tasteMemberMetadata(report, finding) {
  if (report.provider !== "taste-skill") return {};
  const metadata = {};
  if (finding.reviewClass !== undefined) {
    if (!TASTE_CLASSES.has(finding.reviewClass)) {
      throw new TypeError("Invalid Taste review class");
    }
    metadata.reviewClass = finding.reviewClass;
  }
  if (finding.upstreamSeverity !== undefined) {
    if (!["FAIL", "WARN"].includes(finding.upstreamSeverity)) {
      throw new TypeError("Invalid Taste upstream severity");
    }
    const expectedPriority = finding.upstreamSeverity === "FAIL" ? "P1" : "P2";
    if (finding.priority !== expectedPriority) {
      throw new TypeError("Taste upstream severity contradicts normalized priority");
    }
    metadata.upstreamSeverity = finding.upstreamSeverity;
  }
  return metadata;
}

function tasteFusionSummary(report) {
  if (report.provider !== "taste-skill") return {};
  // The pinned Taste 2.5.0 checker does not prove SPA hydration or game phase.
  // Never treat an upstream PASS as a ready-state assertion.
  const result = {
    renderedStateVerified: false,
    renderedStateProof: "NOT_PROVIDED_BY_UPSTREAM",
  };
  const counts = report.summary?.reviewClassCounts;
  if (counts !== undefined) {
    if (!counts || typeof counts !== "object" || Array.isArray(counts) ||
        Object.keys(counts).length !== TASTE_CLASSES.size ||
        Object.keys(counts).some((k) => !TASTE_CLASSES.has(k) ||
          !Number.isSafeInteger(counts[k]) || counts[k] < 0)) {
      throw new TypeError("Invalid Taste review class counts");
    }
    const counted = Object.fromEntries([...TASTE_CLASSES].map((id) => [id, 0]));
    for (const item of report.findings) {
      if (!TASTE_CLASSES.has(item.reviewClass)) {
        throw new TypeError("Taste class summary does not match observations");
      }
      counted[item.reviewClass]++;
    }
    if ([...TASTE_CLASSES].some((id) => counts[id] !== counted[id])) {
      throw new TypeError("Taste class summary does not match observations");
    }
    result.reviewClassCounts = structuredClone(counts);
  }
  return result;
}

// Source scanners do not have any proven rule-equivalent pair yet. Even
// identical source locations with visually related rules stay separate.

const relatedTheme = new Map([
  ["native-dwa:G22", "motion-layout"],
  ["impeccable:layout-transition", "motion-layout"],
  ["native-dwa:G12", "palette-default"],
  ["impeccable:ai-color-palette", "palette-default"],
  ["native-dwa:G13", "typography-default"],
  ["impeccable:overused-font", "typography-default"],
]);
const stableCompare = (a, b) => a.localeCompare(b, "en");

function validateSelection(required, optional) {
  for (const entry of [required, optional]) {
    if (!Array.isArray(entry) || !entry.every((id) =>
      filled(id) && allowedProviders.has(id)) || new Set(entry).size !== entry.length) {
      throw new TypeError("Provider selection requires unique known IDs");
    }
  }
  if (!required.length && !optional.length ||
      required.some((id) => optional.includes(id))) {
    throw new TypeError("Require nonempty, disjoint required/optional selection");
  }
}

function bucket(report, finding) {
  const loc = finding.location;
  if (!filled(loc.route) || !filled(loc.file) || !filled(finding.providerRuleId)) {
    throw new TypeError("Cannot fuse a finding without route, file and rule ID");
  }
  if (report.capability === "static-audit") {
    // Pseudo source files and unlocated findings are intentionally distinct.
    if (loc.file === "<surface>" || !Number.isInteger(loc.line) || loc.line <= 0) {
      return "individual:" + report.provider + ":" + finding.id;
    }
    return "individual:" + report.provider + ":" + finding.id;
  }
  // An identical rendered rule and DOM selector across viewports may be one
  // review topic, but each viewport remains a separate retained observation.
  if (report.capability === "rendered-audit" && filled(loc.selector)) {
    return JSON.stringify(["rendered", loc.route, loc.file, report.provider, finding.providerRuleId, loc.selector]);
  }
  return "individual:" + report.provider + ":" + finding.id;
}

function memberOf(report, finding) {
  return {
    provider: report.provider,
    capability: report.capability,
    id: finding.id,
    ruleId: finding.providerRuleId,
    priority: finding.priority,
    advisory: finding.advisory === true,
    message: finding.message,
    location: structuredClone(finding.location),
    evidence: structuredClone(finding.evidence),
    ...tasteMemberMetadata(report, finding),
  };
}

function groupOf(key, members) {
  const all = [...members].sort((a, b) =>
    stableCompare(a.provider + ":" + a.id, b.provider + ":" + b.id));
  const route = all[0].location.route;
  const evidence = new Map();
  for (const member of all) for (const item of member.evidence) {
    evidence.set(JSON.stringify([item.kind, item.ref]), { kind: item.kind, ref: item.ref });
  }
  return {
    id: "PG-" + hash(key).slice(0, 20),
    route,
    priority: all.reduce((best, m) => prio[m.priority] > prio[best] ? m.priority : best, "P2"),
    providers: [...new Set(all.map((m) => m.provider))].sort(stableCompare),
    widths: [...new Set(all.map((m) => m.location.width).filter((v) =>
      Number.isInteger(v) && v > 0))].sort((a, b) => a - b),
    observationCount: all.length,
    members: all,
    evidence: [...evidence.values()].sort((a, b) =>
      stableCompare(a.kind + ":" + a.ref, b.kind + ":" + b.ref)),
    requiresAdjudication: true,
  };
}

function correlationsFor(groups) {
  const links = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      if (a.route !== b.route || a.providers.some((p) => b.providers.includes(p))) continue;
      const aThemes = new Set(a.members.map((m) => relatedTheme.get(m.provider + ":" + m.ruleId)).filter(Boolean));
      const bThemes = new Set(b.members.map((m) => relatedTheme.get(m.provider + ":" + m.ruleId)).filter(Boolean));
      for (const theme of aThemes) if (bThemes.has(theme)) {
        links.push({ left: a.id, right: b.id, theme,
          relation: "POTENTIALLY_RELATED_NOT_DEDUPLICATED" });
      }
    }
  }
  return links.sort((a, b) => stableCompare(a.left + "|" + a.right, b.left + "|" + b.right));
}

export function assertFusion(fusion) {
  if (!fusion || fusion.schemaVersion !== 1 ||
      fusion.kind !== "dwa/provider-evidence-fusion" ||
      !Array.isArray(fusion.reports) || !Array.isArray(fusion.groups) ||
      !Array.isArray(fusion.correlations) ||
      !fusion.coverage || typeof fusion.coverage !== "object" ||
      !["BLOCKED", "INCOMPLETE", "REVIEW", "SCOPED_CLEAR"].includes(fusion.status) ||
      fusion.completionEligible !== false ||
      !filled(fusion.inputSha256) || !filled(fusion.contentSha256)) {
    throw new TypeError("Invalid provider evidence fusion envelope");
  }
  const { contentSha256, ...payload } = fusion;
  if (hash(payload) !== contentSha256) {
    throw new TypeError("Provider evidence fusion content digest mismatch");
  }
  const ids = new Set();
  for (const g of fusion.groups) {
    if (!filled(g.id) || !filled(g.route) || !["P0", "P1", "P2"].includes(g.priority) ||
        !Array.isArray(g.members) || !g.members.length ||
        !Array.isArray(g.evidence) || !g.evidence.length ||
        ids.has(g.id)) throw new TypeError("Malformed or duplicate fused group");
    ids.add(g.id);
    // The JSON digest protects accidental corruption, not a writer who can
    // recompute it. Revalidate externally supplied Taste members here, too.
    for (const member of g.members) {
      if (member?.provider === "taste-skill") {
        tasteMemberMetadata({ provider: "taste-skill" }, member);
      }
    }
  }
  return fusion;
}

// Standalone evidence CLI calls may not have the run's full source manifest.
// Derive the common minimum scope from attached per-provider attestations.
// Never fuse a mixture of different or missing claims under a green scope.
function commonScope(reports, supplied) {
  const claimed = reports.filter((r) => r.auditScope !== undefined);
  if (!supplied && !claimed.length) return null; // legacy v1 report support
  if (claimed.length !== reports.length || !reports.length) {
    throw new TypeError("Cannot fuse mixed scoped and unscoped provider reports");
  }
  const expected = supplied ?? claimed[0].auditScope;
  if (!expected || !/^[0-9a-f]{64}$/.test(expected.sourceSha256 ?? "") ||
      !filled(expected.route) || !filled(expected.target)) {
    throw new TypeError("Provider audit scope is missing a valid source fingerprint");
  }
  for (const r of reports) {
    const s = r.auditScope;
    if (!s || s.sourceSha256 !== expected.sourceSha256 ||
        s.target !== expected.target || s.route !== expected.route ||
        (s.gitHead ?? null) !== (expected.gitHead ?? null)) {
      throw new TypeError("Provider report scope or source fingerprint mismatch");
    }
    if (r.capability === "rendered-audit" &&
        JSON.stringify(s.rendered ?? null) !== JSON.stringify(expected.rendered ?? s.rendered ?? null)) {
      throw new TypeError("Provider rendered source fingerprint mismatch");
    }
  }
  const rendered = claimed.map((r) => r.auditScope.rendered).filter(Boolean);
  if (rendered.length > 1 &&
      rendered.some((v) => JSON.stringify(v) !== JSON.stringify(rendered[0]))) {
    throw new TypeError("Conflicting rendered source scope");
  }
  return structuredClone(supplied ?? {
    sourceSha256: expected.sourceSha256,
    route: expected.route, target: expected.target,
    gitHead: expected.gitHead ?? null,
    ...(rendered.length ? { rendered: rendered[0] } : {}),
  });
}

export function fuseProviderEvidence(reports, { required = [], optional = [], scope = null } = {}) {
  validateSelection(required, optional);
  if (!Array.isArray(reports) || reports.length > 10) {
    throw new TypeError("Provider reports must be a bounded array");
  }
  const resolvedScope = commonScope(reports, scope);
  const selected = new Set([...required, ...optional]);
  const byId = new Map();
  const checked = [];
  let total = 0;
  for (const report of reports) {
    assertProviderReport(report);
    if (!selected.has(report.provider) || byId.has(report.provider)) {
      throw new TypeError("Unselected or duplicate provider report: " + report.provider);
    }
    total += report.findings.length;
    if (total > 2000) throw new TypeError("Too many provider observations to fuse safely");
    const normalized = structuredClone(report);
    byId.set(report.provider, normalized);
    checked.push(normalized);
  }
  checked.sort((a, b) => stableCompare(a.provider, b.provider));
  const statuses = [...selected].sort(stableCompare).map((id) =>
    ({ provider: id, required: required.includes(id),
      status: byId.get(id)?.status ?? "MISSING",
      reason: byId.get(id)?.reason ?? (byId.has(id) ? null : "No report supplied") }));
  const failedRequired = statuses.filter((x) =>
    x.required && !success.has(x.status));
  const incompleteOptional = statuses.filter((x) =>
    !x.required && !success.has(x.status));

  const grouped = new Map();
  for (const report of checked) {
    if (!success.has(report.status)) continue;
    for (const finding of report.findings) {
      const key = bucket(report, finding);
      const members = grouped.get(key) ?? [];
      members.push(memberOf(report, finding));
      grouped.set(key, members);
    }
  }
  const groups = [...grouped].map(([key, members]) =>
    groupOf(key, members)).sort((a, b) => stableCompare(a.id, b.id));
  const correlations = correlationsFor(groups);
  // A canonical native HOLD is a hard blocker even if an upstream report
  // accidentally carries no normalizable findings. External providers cannot
  // cancel, outweigh or downgrade the source gate's original verdict.
  const native = byId.get("native-dwa");
  const nativeHold = native?.verdict === "HOLD" ||
    Number(native?.summary?.p0 ?? 0) > 0;
  const nativeReview = ["REVIEW", "REVIEW_CLUSTER"].includes(native?.verdict) ||
    native?.summary?.requiresAdjudication === true;
  const status = failedRequired.length || nativeHold ? "BLOCKED"
    : incompleteOptional.length ? "INCOMPLETE"
      : groups.length || nativeReview ? "REVIEW" : "SCOPED_CLEAR";
  const payload = {
    schemaVersion: 1,
    kind: "dwa/provider-evidence-fusion",
    status,
    completionEligible: false,
    inputSha256: hash(resolvedScope ? { reports: checked, scope: resolvedScope } : checked),
    ...(resolvedScope ? { scope: resolvedScope } : {}),
    coverage: {
      complete: !failedRequired.length && !incompleteOptional.length,
      required: [...required].sort(stableCompare),
      optional: [...optional].sort(stableCompare),
      statuses,
    },
    reports: checked.map((r) => ({
      provider: r.provider, capability: r.capability, status: r.status,
      reason: r.reason ?? null, count: r.findings.length,
      // No embedded filesystem access or executable instructions are needed.
      provenance: r.provenance ?? null,
      verdict: r.verdict ?? null,
      ...tasteFusionSummary(r),
    })),
    counts: {
      observations: total,
      groups: groups.length,
      duplicatesConservativelyGrouped:
        groups.reduce((s, g) => s + g.observationCount - 1, 0),
      potentialCorrelations: correlations.length,
    },
    groups, correlations,
    limitation: "Evidence only. No automatic product pass, DWA gate override or legacy ledger promotion.",
  };
  return assertFusion({ ...payload, contentSha256: hash(payload) });
}
