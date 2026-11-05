import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Capability, ProviderStatus } from "../../scripts/providers/contract.mjs";
import { createProviderRegistry } from "../../scripts/providers/registry.mjs";
import {
  selectProfileProviders, runProfileProviders,
} from "../../scripts/providers/workflow.mjs";

const src = Capability.STATIC_AUDIT;
const rendered = Capability.RENDERED_AUDIT;
const report = (id, capability, status = ProviderStatus.PASS, extra = {}) => ({
  provider: id, capability, status, findings: [], ...extra,
});
function provider(id, capability, status = ProviderStatus.PASS, extra = {}) {
  return {
    id, capabilities: [capability],
    async probe() { return { available: status !== ProviderStatus.UNAVAILABLE }; },
    async inspect() { return report(id, capability, status, extra); },
  };
}
async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-policy-"));
  const srcDir = join(root, "src");
  const built = join(root, "dist");
  mkdirSync(srcDir);
  mkdirSync(built);
  const target = join(srcDir, "page.tsx");
  const html = join(built, "index.html");
  writeFileSync(target, "export const Page = () => <h1>Test</h1>;");
  writeFileSync(html, "<!doctype html><h1>Test</h1>");
  try {
    return await fn({ root, srcDir, built, target, html,
      request: { target: srcDir, projectRoot: root, route: "/test" } });
  } finally { rmSync(root, { force: true, recursive: true }); }
}
const registry = () => createProviderRegistry([
  provider("native-dwa", src),
  provider("impeccable", src),
  provider("taste-skill", rendered),
]);

test("quick profile selects only DWA native; no external provider executes", async () => {
  await fixture(async (f) => {
    const seen = [];
    const r = createProviderRegistry([
      { ...provider("native-dwa", src), async inspect(x) {
        seen.push("native-dwa");
        return report("native-dwa", x.capability);
      } },
      { ...provider("impeccable", src), async inspect() {
        seen.push("impeccable");
        return report("impeccable", src);
      } },
    ]);
    const out = await runProfileProviders({ ...f.request, profile: "quick" },
      { registry: r });
    assert.deepEqual(seen, ["native-dwa"]);
    assert.equal(out.fusion.status, "SCOPED_CLEAR");
    assert.equal(out.completionEligible, false);
    assert.deepEqual(out.selection.notSelected, ["impeccable", "taste-skill"]);
  });
});

test("standard/deep include bundled static Impeccable but only explicitly opt-in to browser", async () => {
  for (const profile of ["standard", "deep"]) {
    const plan = selectProfileProviders({ profile });
    assert.deepEqual(plan.static.required, ["native-dwa"]);
    assert.deepEqual(plan.static.optional, ["impeccable"]);
    assert.equal(plan.rendered, null);
    assert.deepEqual(plan.notSelected, ["taste-skill"]);
    const enabled = selectProfileProviders({ profile, withTaste: true });
    assert.deepEqual(enabled.rendered.optional, ["taste-skill"]);
    assert.deepEqual(enabled.optional, ["impeccable", "taste-skill"]);
  }
});

test("standard native+Impeccable actual orchestration retains both reports", async () => {
  await fixture(async (f) => {
    const out = await runProfileProviders({ ...f.request }, { registry: registry() });
    assert.equal(out.fusion.status, "SCOPED_CLEAR");
    assert.deepEqual(out.reports.map((r) => r.provider), ["native-dwa", "impeccable"]);
    assert.equal(out.selection.rendered, null);
    assert.equal(out.fusion.coverage.complete, true);
  });
});

test("missing optional provider is visible as INCOMPLETE, not a green result", async () => {
  await fixture(async (f) => {
    const r = createProviderRegistry([
      provider("native-dwa", src),
      provider("impeccable", src, ProviderStatus.UNAVAILABLE),
    ]);
    const out = await runProfileProviders({ ...f.request }, { registry: r });
    assert.equal(out.fusion.status, "INCOMPLETE");
    assert.equal(out.reports[1].status, "UNAVAILABLE");
    assert.equal(out.fusion.coverage.complete, false);
  });
});

test("native HOLD blocks even if both external specialists report PASS", async () => {
  await fixture(async (f) => {
    const r = createProviderRegistry([
      provider("native-dwa", src, ProviderStatus.PASS, { verdict: "HOLD" }),
      provider("impeccable", src),
      provider("taste-skill", rendered),
    ]);
    const out = await runProfileProviders({
      ...f.request, withTaste: true, html: f.html, tasteRoot: f.root,
    }, { registry: r });
    assert.equal(out.fusion.status, "BLOCKED");
    assert.equal(out.reports.length, 3);
    assert.equal(out.fusion.completionEligible, false);
  });
});

test("deep rendered opt-in preserves viewport evidence and distinct capability", async () => {
  await fixture(async (f) => {
    const out = await runProfileProviders({
      ...f.request, profile: "deep", html: f.html,
      withTaste: true, tasteRoot: f.root,
    }, { registry: registry() });
    assert.deepEqual(out.reports.map((x) => x.capability), [src, src, rendered]);
    assert.deepEqual(out.selection.optional, ["impeccable", "taste-skill"]);
    assert.equal(out.fusion.status, "SCOPED_CLEAR");
  });
});

test("required Taste Skill unavailable blocks, optional unavailable is INCOMPLETE", async () => {
  await fixture(async (f) => {
    const r = createProviderRegistry([
      provider("native-dwa", src),
      provider("impeccable", src),
      provider("taste-skill", rendered, ProviderStatus.UNAVAILABLE),
    ]);
    const args = { ...f.request, html: f.html, withTaste: true };
    const required = await runProfileProviders({ ...args, requireTaste: true },
      { registry: r });
    assert.equal(required.fusion.status, "BLOCKED");
    assert.equal(required.reports[2].status, "BLOCKED");
    const optional = await runProfileProviders(args, { registry: r });
    assert.equal(optional.fusion.status, "INCOMPLETE");
    assert.equal(optional.reports[2].status, "UNAVAILABLE");
  });
});

test("explicit local scope prevents arbitrary paths, URLs and missing routes", async () => {
  await fixture(async (f) => {
    const base = { ...f.request, profile: "quick" };
    for (const opts of [
      { target: "https://example.com" },
      { route: "not-a-route" },
      { route: "" },
      { target: join(f.root, "missing.tsx") },
      { projectRoot: f.built },
      { profile: "fast" },
      { profile: "quick", withTaste: true, html: f.html },
      { profile: "deep", withTaste: true },
    ]) {
      await assert.rejects(() => runProfileProviders({ ...base, ...opts },
        { registry: registry() }));
    }
  });
});

test("browser is scoped to an isolated build directory, never the repository root", async () => {
  await fixture(async (f) => {
    const observed = [];
    const execute = async (registry, input) => {
      observed.push(input);
      const id = input.capability === Capability.RENDERED_AUDIT
        ? "taste-skill" : "native-dwa";
      return [report(id, input.capability)];
    };
    const out = await runProfileProviders({
      ...f.request, profile: "deep", withImpeccable: false,
      withTaste: true, html: f.html, outputRoot: f.root,
    }, { registry: registry(), execute });
    assert.equal(out.fusion.status, "SCOPED_CLEAR");
    assert.equal(observed[1].request.projectRoot, f.built);
    assert.equal(observed[0].request.projectRoot, f.root);
    await assert.rejects(() => runProfileProviders({
      ...f.request, profile: "deep", withTaste: true,
      html: f.html, browserRoot: f.root,
    }, { registry: registry() }), /isolated built-site subtree/);
    await assert.rejects(() => runProfileProviders({
      ...f.request, profile: "deep", withTaste: true,
      html: f.html, outputRoot: f.built,
    }, { registry: registry() }), /Browser output/);
    const repoHtml = join(f.root, "index.html");
    writeFileSync(repoHtml, "<!doctype html><title>Not isolated</title>");
    await assert.rejects(() => runProfileProviders({
      ...f.request, profile: "deep", withTaste: true,
      html: repoHtml,
    }, { registry: registry() }), /isolated built-site subtree/);
    const elsewhere = mkdtempSync(join(tmpdir(), "dwa-browser-outside-"));
    try {
      const externalHtml = join(elsewhere, "index.html");
      writeFileSync(externalHtml, "<!doctype html>");
      await assert.rejects(() => runProfileProviders({
        ...f.request, profile: "deep", withTaste: true,
        html: externalHtml,
      }, { registry: registry() }), /isolated built-site subtree/);
    } finally {
      rmSync(elsewhere, { force: true, recursive: true });
    }
  });
});

test("explicit opt-out disables Impeccable without silently selecting it", async () => {
  await fixture(async (f) => {
    const out = await runProfileProviders({
      ...f.request, withImpeccable: false,
    }, { registry: registry() });
    assert.deepEqual(out.reports.map((r) => r.provider), ["native-dwa"]);
    assert.ok(out.selection.notSelected.includes("impeccable"));
    assert.equal(out.fusion.status, "SCOPED_CLEAR");
  });
});

test("invalid profile selection cannot implicitly require unavailable capabilities", () => {
  assert.throws(() => selectProfileProviders({ profile: "quick", withTaste: true }),
    /Quick profile/);
  assert.throws(() => selectProfileProviders({ requireTaste: true }),
    /explicitly enabled/);
  assert.throws(() => selectProfileProviders({ withImpeccable: "yes" }),
    /Invalid/);
});
