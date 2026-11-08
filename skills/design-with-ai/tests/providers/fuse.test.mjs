import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assertFusion, fuseProviderEvidence } from "../../scripts/providers/fuse.mjs";
import { Capability, ProviderStatus } from "../../scripts/providers/contract.mjs";

const src = Capability.STATIC_AUDIT, rendered = Capability.RENDERED_AUDIT;
const finding = ({ id, rule = "G05", file = "src/page.tsx", route = "/",
  line = 12, priority = "P2", msg = "Nested boxes", provider = "native-dwa",
  width, selector } = {}) => ({
  id, providerRuleId: rule, priority, message: msg,
  location: { route, file, line, ...(width ? { width } : {}),
    ...(selector ? { selector } : {}) },
  evidence: [{ kind: provider === "taste-skill" ? "rendered-report" : "source",
    ref: "fixture/" + id + ".json" }],
});
const report = (provider, findings = [], {
  capability = provider === "taste-skill" ? rendered : src,
  status = findings.length ? ProviderStatus.FINDINGS : ProviderStatus.PASS,
  reason,
  verdict,
} = {}) => ({ provider, capability, status, findings, ...(reason ? { reason } : {}),
  ...(verdict ? { verdict } : {}) });
const config = { required: ["native-dwa"], optional: ["impeccable", "taste-skill"] };

test("scoped green reports are not product-completion evidence", () => {
  const fusion = fuseProviderEvidence([
    report("native-dwa"), report("impeccable"), report("taste-skill"),
  ], config);
  assert.equal(fusion.status, "SCOPED_CLEAR");
  assert.equal(fusion.completionEligible, false);
  assert.equal(fusion.coverage.complete, true);
  assert.equal(fusion.counts.groups, 0);
  assertFusion(JSON.parse(JSON.stringify(fusion)));
});

test("required missing or failed blocks; optional missing remains INCOMPLETE", () => {
  assert.equal(fuseProviderEvidence([], config).status, "BLOCKED");
  const optionalMissing = fuseProviderEvidence([report("native-dwa")], config);
  assert.equal(optionalMissing.status, "INCOMPLETE");
  assert.equal(optionalMissing.coverage.complete, false);
  assert.deepEqual(optionalMissing.coverage.statuses.filter((x) => x.status === "MISSING")
    .map((x) => x.provider), ["impeccable", "taste-skill"]);
  const blocked = fuseProviderEvidence([
    report("native-dwa", [], { status: "ERROR", reason: "not ready" }),
    report("impeccable"),
  ], config);
  assert.equal(blocked.status, "BLOCKED");
});

test("canonical native HOLD remains blocked even with empty normalized findings", () => {
  const fusion = fuseProviderEvidence([
    report("native-dwa", [], { verdict: "HOLD" }),
    report("impeccable"), report("taste-skill"),
  ], config);
  assert.equal(fusion.status, "BLOCKED");
  assert.equal(fusion.completionEligible, false);
});

test("same-location but non-equivalent source rules remain separate and contextual", () => {
  // DWA G12 and Impeccable ai-color-palette differ in the evidence each
  // detector requires; the same source line alone proves no equivalence.
  const native = finding({ id: "n1", rule: "G12" });
  const impeccable = finding({ id: "i1", rule: "ai-color-palette",
    provider: "impeccable", msg: "Similar color signal" });
  const fusion = fuseProviderEvidence([
    report("native-dwa", [native], { verdict: "REVIEW" }),
    report("impeccable", [impeccable]),
    report("taste-skill"),
  ], config);
  assert.equal(fusion.status, "REVIEW");
  assert.equal(fusion.groups.length, 2);
  assert.ok(fusion.groups.every((g) => g.members.length === 1));
  assert.equal(fusion.counts.duplicatesConservativelyGrouped, 0);
  assert.equal(fusion.correlations.length, 1);
  assert.equal(fusion.correlations[0].relation, "POTENTIALLY_RELATED_NOT_DEDUPLICATED");
});

test("hard native P0 is never obscured by a related external observation", () => {
  const fusion = fuseProviderEvidence([
    report("native-dwa", [finding({ id: "p0", rule: "G22", priority: "P0" })],
      { verdict: "HOLD" }),
    report("impeccable", [finding({ id: "im", provider: "impeccable",
      rule: "layout-transition", priority: "P2" })]),
  ], { required: ["native-dwa"], optional: ["impeccable"] });
  assert.equal(fusion.status, "BLOCKED");
  assert.equal(fusion.groups.length, 2);
  assert.ok(fusion.groups.some((g) => g.providers.includes("native-dwa") &&
    g.priority === "P0"));
  assert.ok(fusion.correlations.some((x) => x.theme === "motion-layout"));
});

test("different source locations, different rules and placeholder locations remain separate", () => {
  const fusion = fuseProviderEvidence([
    report("native-dwa", [
      finding({ id: "n1" }),
      finding({ id: "n2", line: 15 }),
      finding({ id: "n3", file: "<surface>", line: null }),
      finding({ id: "n4", rule: "G12" }),
    ]),
    report("impeccable", [
      finding({ id: "i1", rule: "nested-cards", line: 21,
        provider: "impeccable" }),
      finding({ id: "i2", file: "<surface>", line: null, rule: "nested-cards",
        provider: "impeccable" }),
      finding({ id: "i3", rule: "ai-color-palette",
        provider: "impeccable" }),
    ]),
  ], { required: ["native-dwa"], optional: ["impeccable"] });
  assert.equal(fusion.groups.length, 7);
  assert.ok(fusion.correlations.some((x) => x.theme === "palette-default"));
  assert.equal(fusion.counts.duplicatesConservativelyGrouped, 0);
});

test("repeated rendered rule at same DOM selector groups widths, keeping each viewport", () => {
  const items = [1440, 768, 390].map((width) => finding({
    id: "render-" + width, rule: "off-viewport",
    provider: "taste-skill", file: "dist/index.html", line: null,
    width, selector: "main > section:nth-child(2)", priority: "P1",
  }));
  const fusion = fuseProviderEvidence([
    report("taste-skill", items),
  ], { required: ["taste-skill"] });
  assert.equal(fusion.groups.length, 1);
  assert.deepEqual(fusion.groups[0].widths, [390, 768, 1440]);
  assert.equal(fusion.groups[0].observationCount, 3);
  assert.equal(fusion.groups[0].evidence.length, 3);
  assert.equal(fusion.groups[0].priority, "P1");
});

test("Taste FAIL/P2 and WARN/P1 contradictions are rejected before evidence grouping", () => {
  for (const [severity, priority] of [
    ["FAIL", "P2"], ["WARN", "P1"], ["FAIL", "P0"],
  ]) {
    const raw = {
      ...finding({
        id: "taste-" + severity + "-" + priority,
        provider: "taste-skill", rule: "spill", file: "dist/index.html",
        line: null, width: 390, selector: ".stage", priority,
      }),
      upstreamSeverity: severity,
      reviewClass: "GEOMETRY_NEEDS_VISUAL_REVIEW",
    };
    assert.throws(() => fuseProviderEvidence([
      report("taste-skill", [raw]),
    ], { required: ["taste-skill"] }), /severity contradicts normalized priority/);
  }
  const valid = {
    ...finding({
      id: "taste-valid", provider: "taste-skill",
      file: "dist/index.html", line: null, width: 390,
      selector: ".stage", priority: "P1",
    }),
    upstreamSeverity: "FAIL",
  };
  const fused = fuseProviderEvidence([
    report("taste-skill", [valid]),
  ], { required: ["taste-skill"] });
  assert.equal(fused.groups[0].priority, "P1");
  assert.equal(fused.groups[0].members[0].upstreamSeverity, "FAIL");
});

test("Taste triage and unverified game state survive fusion without severity downgrades", () => {
  const a = {
    ...finding({
      id: "taste-spill", provider: "taste-skill", rule: "spill",
      file: "dist/index.html", line: null, selector: ".scene", width: 390,
      priority: "P1",
    }),
    reviewClass: "GEOMETRY_NEEDS_VISUAL_REVIEW",
    upstreamSeverity: "FAIL",
  };
  const b = {
    ...finding({
      id: "taste-caption", provider: "taste-skill", rule: "visual-caption",
      file: "dist/index.html", line: null, selector: "figure", width: 768,
      priority: "P2",
    }),
    reviewClass: "CONTEXTUAL_HOUSE_RULE",
    upstreamSeverity: "WARN",
  };
  const taste = {
    ...report("taste-skill", [a, b]),
    summary: {
      renderedStateVerified: false,
      reviewClassCounts: {
        POTENTIAL_USABILITY: 0,
        GEOMETRY_NEEDS_VISUAL_REVIEW: 1,
        CONTEXTUAL_HOUSE_RULE: 1,
        UNCLASSIFIED_HEURISTIC: 0,
      },
    },
  };
  const fusion = fuseProviderEvidence([taste], { required: ["taste-skill"] });
  assert.equal(fusion.status, "REVIEW");
  assert.equal(fusion.completionEligible, false);
  const merged = fusion.groups.flatMap((g) => g.members);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((x) => x.id === "taste-spill").reviewClass,
    "GEOMETRY_NEEDS_VISUAL_REVIEW");
  assert.equal(merged.find((x) => x.id === "taste-spill").upstreamSeverity, "FAIL");
  assert.equal(merged.find((x) => x.id === "taste-spill").priority, "P1");
  assert.equal(merged.find((x) => x.id === "taste-caption").priority, "P2");
  assert.equal(fusion.reports[0].renderedStateVerified, false);
  assert.equal(fusion.reports[0].renderedStateProof, "NOT_PROVIDED_BY_UPSTREAM");
  assert.deepEqual(fusion.reports[0].reviewClassCounts,
    taste.summary.reviewClassCounts);
  assertFusion(JSON.parse(JSON.stringify(fusion)));

  const corruptCounts = structuredClone(taste);
  corruptCounts.summary.reviewClassCounts.CONTEXTUAL_HOUSE_RULE = 0;
  assert.throws(() => fuseProviderEvidence([corruptCounts], {
    required: ["taste-skill"],
  }), /Taste class summary/);

  const unknownTag = structuredClone(taste);
  unknownTag.findings[0].reviewClass = "ACCEPTED_PRODUCT_DEFECT";
  assert.throws(() => fuseProviderEvidence([unknownTag], {
    required: ["taste-skill"],
  }), /Taste class summary|Invalid Taste review class/);
});

test("same rule and selector on different routes or pages is not merged", () => {
  const fusion = fuseProviderEvidence([
    report("taste-skill", [
      finding({ id: "a", provider: "taste-skill", rule: "off-viewport",
        file: "dist/a.html", route: "/a", line: null, width: 390, selector: "main" }),
      finding({ id: "b", provider: "taste-skill", rule: "off-viewport",
        file: "dist/b.html", route: "/b", line: null, width: 390, selector: "main" }),
    ]),
  ], { required: ["taste-skill"] });
  assert.equal(fusion.groups.length, 2);
});

test("input report order cannot change group IDs or fusion content digest", () => {
  const a = report("native-dwa", [finding({ id: "a" })]);
  const b = report("impeccable", [finding({ id: "b", rule: "nested-cards",
    provider: "impeccable" })]);
  const first = fuseProviderEvidence([a, b], {
    required: ["native-dwa"], optional: ["impeccable"],
  });
  const reverse = fuseProviderEvidence([b, a], {
    optional: ["impeccable"], required: ["native-dwa"],
  });
  assert.deepEqual(reverse, first);
});

test("unselected, duplicate, malformed and overly many reports fail closed", () => {
  const a = report("native-dwa");
  assert.throws(() => fuseProviderEvidence([a, a], {
    required: ["native-dwa"],
  }), /duplicate/);
  assert.throws(() => fuseProviderEvidence([a], {
    required: ["taste-skill"],
  }), /Unselected/);
  assert.throws(() => fuseProviderEvidence([report("native-dwa", [
    finding({ id: "a" }), finding({ id: "a" }),
  ])], { required: ["native-dwa"] }), /Duplicate provider finding ID/);
  assert.throws(() => fuseProviderEvidence([], {
    required: ["native-dwa"], optional: ["native-dwa"],
  }), /disjoint/);
  assert.throws(() => fuseProviderEvidence([], {
    optional: [], required: [],
  }), /nonempty/);
});

test("signed fusion snapshots still reject forged Taste member metadata", () => {
  const valid = {
    ...finding({
      id: "taste-integrity", provider: "taste-skill",
      file: "dist/index.html", line: null, width: 390,
      selector: ".stage", priority: "P1",
    }),
    upstreamSeverity: "FAIL",
    reviewClass: "GEOMETRY_NEEDS_VISUAL_REVIEW",
  };
  const fusion = fuseProviderEvidence([
    report("taste-skill", [valid]),
  ], { required: ["taste-skill"] });
  assertFusion(structuredClone(fusion));

  const signed = (change) => {
    const mutated = structuredClone(fusion);
    change(mutated.groups[0].members[0]);
    const { contentSha256, ...payload } = mutated;
    mutated.contentSha256 = createHash("sha256")
      .update(JSON.stringify(payload)).digest("hex");
    return mutated;
  };
  const cases = [
    [(m) => { m.priority = "P2"; }, /severity contradicts normalized priority/],
    [(m) => { m.upstreamSeverity = "WARN"; }, /severity contradicts normalized priority/],
    [(m) => { m.upstreamSeverity = "ACCEPT"; }, /Invalid Taste upstream severity/],
    [(m) => { m.reviewClass = "APPROVED"; }, /Invalid Taste review class/],
  ];
  for (const [change, error] of cases) {
    assert.throws(() => assertFusion(signed(change)), error);
  }
  assert.throws(() => assertFusion(signed((m) => {
    m.reviewClass = null;
  })), /Invalid Taste review class/);
});

test("re-signed fusion snapshots cannot contradict Taste member class totals", () => {
  const item = {
    ...finding({
      id: "taste-count-integrity", provider: "taste-skill",
      file: "dist/index.html", line: null, width: 390,
      selector: ".stage", priority: "P1",
    }),
    reviewClass: "GEOMETRY_NEEDS_VISUAL_REVIEW",
    upstreamSeverity: "FAIL",
  };
  const summary = {
    reviewClassCounts: {
      POTENTIAL_USABILITY: 0,
      GEOMETRY_NEEDS_VISUAL_REVIEW: 1,
      CONTEXTUAL_HOUSE_RULE: 0,
      UNCLASSIFIED_HEURISTIC: 0,
    },
  };
  const fusion = fuseProviderEvidence([{
    ...report("taste-skill", [item]), summary,
  }], { required: ["taste-skill"] });
  assertFusion(structuredClone(fusion));

  const reSign = (mutate) => {
    const changed = structuredClone(fusion);
    mutate(changed);
    const { contentSha256, ...payload } = changed;
    changed.contentSha256 = createHash("sha256")
      .update(JSON.stringify(payload)).digest("hex");
    return changed;
  };
  assert.throws(() => assertFusion(reSign((snapshot) => {
    snapshot.groups[0].members[0].reviewClass = "CONTEXTUAL_HOUSE_RULE";
  })), /Taste class summary does not match observations/);
  assert.throws(() => assertFusion(reSign((snapshot) => {
    snapshot.reports[0].reviewClassCounts.GEOMETRY_NEEDS_VISUAL_REVIEW = 0;
    snapshot.reports[0].reviewClassCounts.CONTEXTUAL_HOUSE_RULE = 1;
  })), /Taste class summary does not match observations/);
  assert.throws(() => assertFusion(reSign((snapshot) => {
    snapshot.reports[0].count = 2;
  })), /Taste class summary does not match observations/);
  assert.throws(() => assertFusion(reSign((snapshot) => {
    snapshot.reports[0].renderedStateVerified = true;
  })), /Taste readiness proof is invalid/);
  assert.throws(() => assertFusion(reSign((snapshot) => {
    snapshot.reports[0].renderedStateProof = "VERIFIED_AUTHENTICATED_GAME";
  })), /Taste readiness proof is invalid/);
});

test("tampered fusion data fails the content digest check", () => {
  const fusion = fuseProviderEvidence([report("native-dwa")], {
    required: ["native-dwa"],
  });
  fusion.status = "REVIEW";
  assert.throws(() => assertFusion(fusion), /digest mismatch/);
});

test("fusion rejects successful reports that claim different source snapshots", () => {
  const scope = { sourceSha256: "a".repeat(64), route: "/", target: "src", gitHead: null };
  const a = { ...report("native-dwa"), auditScope: scope };
  const b = { ...report("impeccable"), auditScope: { ...scope, sourceSha256: "b".repeat(64) } };
  assert.throws(() => fuseProviderEvidence([a, b], {
    required: ["native-dwa"], optional: ["impeccable"], scope,
  }), /scope|fingerprint|snapshot/i);
});

test("fusion derives a common evidence scope from standalone report files", () => {
  const scope = { sourceSha256: "a".repeat(64), route: "/setup", target: "src", gitHead: null };
  const a = { ...report("native-dwa"), auditScope: scope };
  const b = { ...report("impeccable"), auditScope: scope };
  const result = fuseProviderEvidence([a, b], {
    required: ["native-dwa"], optional: ["impeccable"],
  });
  assert.equal(result.scope.sourceSha256, scope.sourceSha256);
});
