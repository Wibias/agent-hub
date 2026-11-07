import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Capability, ProviderStatus } from "../../scripts/providers/contract.mjs";
import { createProviderRegistry, runProviders } from "../../scripts/providers/registry.mjs";
import { createNativeDwaProvider } from "../../scripts/providers/native-dwa.mjs";
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
  mkdirSync(join(built, "test"), { recursive: true });
  const target = join(srcDir, "page.tsx");
  const html = join(built, "test", "index.html");
  writeFileSync(target, "export const Page = () => <h1>Test</h1>;");
  writeFileSync(html, "<!doctype html><h1>Test</h1>");
  writeFileSync(join(root, "package.json"), "{}\n"); // Keep DESIGN.md discovery inside fixture.
  try {
    return await fn({ root, srcDir, built, target, html,
      request: { target: srcDir, projectRoot: root, route: "/test", browserRoot: built } });
  } finally { rmSync(root, { force: true, recursive: true }); }
}
const registry = () => createProviderRegistry([
  provider("native-dwa", src),
  provider("impeccable", src),
  provider("taste-skill", rendered),
]);


test("untrusted provider and native gate failures never persist canary credentials", async () => {
  const providers = [
    {
      id: "probe-secret", capabilities: [src],
      async probe() { throw new Error("token=CANARY_PROBE_SECRET_20261107"); },
      async inspect() { throw new Error("unexpected"); },
    },
    {
      id: "unavailable-secret", capabilities: [src],
      async probe() { return { available: false, reason: "/api?token=CANARY_UNAVAILABLE_SECRET_20261107" }; },
      async inspect() { throw new Error("unexpected"); },
    },
    {
      id: "inspect-secret", capabilities: [src],
      async probe() { return { available: true }; },
      async inspect() { throw new Error("token=CANARY_INSPECT_SECRET_20261107"); },
    },
  ];
  const reports = await runProviders(createProviderRegistry(providers), {
    required: providers.map((p) => p.id), capability: src,
  });
  assert.deepEqual(reports.map((r) => r.status), ["ERROR", "BLOCKED", "ERROR"]);
  assert.deepEqual(reports.map((r) => r.reason), [
    "Provider probe failed", "Provider runtime unavailable", "Provider inspection failed",
  ]);
  assert.ok(!JSON.stringify(reports).includes("CANARY_"));
  const badLaunch = createNativeDwaProvider({
    runner: async () => ({
      error: "CANARY_NATIVE_SPAWN_SECRET_20261107",
      timedOut: false, outputLimitExceeded: false,
    }),
  });
  const failed = await badLaunch.inspect({
    capability: src, target: "/tmp/fake.tsx", route: "/",
  });
  assert.equal(failed.status, "ERROR");
  assert.equal(failed.reason, "Source gate execution failed");
  const badPayload = createNativeDwaProvider({
    runner: async () => ({
      stdout: JSON.stringify({
        verdict: "MALFORMED", hits: [], error: "CANARY_NATIVE_PAYLOAD_20261107",
      }),
      exitCode: 1, error: null, timedOut: false, outputLimitExceeded: false,
    }),
  });
  const malformed = await badPayload.inspect({
    capability: src, target: "/tmp/fake.tsx", route: "/",
  });
  assert.equal(malformed.status, "ERROR");
  assert.equal(malformed.reason, "Source gate returned invalid result");
  assert.ok(!JSON.stringify([failed, malformed]).includes("CANARY_"));
});

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

test("native quick and --no-impeccable ignore unrelated unsafe Impeccable configs", async () => {
  await fixture(async (f) => {
    const separate = mkdtempSync(join(tmpdir(), "dwa-unrelated-policy-"));
    try {
      const configDir = join(f.root, ".impeccable");
      mkdirSync(configDir);
      const externalConfig = join(separate, "config.local.json");
      writeFileSync(externalConfig, '{"detector":{"ignoreRules":[]}}');
      symlinkSync(externalConfig, join(configDir, "config.local.json"));
      const quick = await runProfileProviders({
        ...f.request, profile: "quick",
      }, { registry: registry() });
      assert.deepEqual(quick.reports.map((r) => r.provider), ["native-dwa"]);
      assert.equal(quick.fusion.status, "SCOPED_CLEAR");
      const noImpeccable = await runProfileProviders({
        ...f.request, withImpeccable: false,
      }, { registry: registry() });
      assert.equal(noImpeccable.fusion.status, "SCOPED_CLEAR");
      await assert.rejects(() => runProfileProviders({
        ...f.request, profile: "standard", withImpeccable: true,
      }, { registry: registry() }), /Detector context dependency must be a regular in-project file/);
    } finally {
      rmSync(separate, { recursive: true, force: true });
    }
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

test("source snapshot binds evidence to target, route and changing working files", async () => {
  await fixture(async (f) => {
    const original = await runProfileProviders({ ...f.request, profile: "quick" },
      { registry: registry() });
    assert.equal(original.scope.target, "src");
    assert.equal(original.scope.route, "/test");
    assert.equal(original.scope.fileCount, 1);
    assert.match(original.scope.sourceSha256, /^[0-9a-f]{64}$/);
    assert.equal(original.scope.routeBinding, "declared-source-route");
    assert.equal(original.fusion.scope.sourceSha256, original.scope.sourceSha256);
    writeFileSync(f.target, "export const Page = () => <h1>Changed</h1>;");
    const changed = await runProfileProviders({ ...f.request, profile: "quick" },
      { registry: registry() });
    assert.notEqual(original.scope.sourceSha256, changed.scope.sourceSha256);
  });
});

test("a source mutation during scanning fails closed", async () => {
  await fixture(async (f) => {
    let changed = false;
    const execute = async (_, input) => {
      if (!changed) {
        writeFileSync(f.target, "export const changed = true;");
        changed = true;
      }
      return [report("native-dwa", input.capability)];
    };
    await assert.rejects(() => runProfileProviders({
      ...f.request, profile: "quick",
    }, { registry: registry(), execute }), /changed during provider execution/);
  });
});

test("an out-of-target Impeccable policy mutation during scanning fails closed", async () => {
  await fixture(async (f) => {
    const context = join(f.root, ".impeccable");
    mkdirSync(context);
    const config = join(context, "config.local.json");
    writeFileSync(config, '{"detector":{"ignoreRules":[]}}\n');
    writeFileSync(join(f.root, "DESIGN.md"),
      "---\ntypography:\n  body:\n    fontFamily: Arial\n---\n");
    let changed = false;
    const execute = async (_, input) => {
      if (!changed) {
        writeFileSync(config, '{"detector":{"ignoreRules":["overused-font"]}}\n');
        changed = true;
      }
      return [report("native-dwa", input.capability), report("impeccable", input.capability)];
    };
    await assert.rejects(() => runProfileProviders({
      ...f.request, profile: "standard",
    }, { registry: registry(), execute }), /changed during provider execution/);
  });
});

test("rendered CSS, JS and media changes during the Taste provider fail closed", async () => {
  for (const scenario of ["edit-css", "edit-js", "remove-image", "add-chunk"]) {
    await fixture(async (f) => {
      const dir = join(f.built, "test");
      const css = join(dir, "layout.css");
      const js = join(dir, "screen.js");
      const image = join(dir, "image.svg");
      writeFileSync(css, "h1 { color: green }\n");
      writeFileSync(js, "window.loaded = 1;\n");
      writeFileSync(image, "<svg></svg>\n");
      const execute = async (_, input) => {
        if (input.capability === Capability.RENDERED_AUDIT) {
          if (scenario === "edit-css") writeFileSync(css, "h1 { color: red }\n");
          if (scenario === "edit-js") writeFileSync(js, "window.loaded = 2;\n");
          if (scenario === "remove-image") unlinkSync(image);
          if (scenario === "add-chunk") writeFileSync(join(dir, "lazy-chunk.mjs"),
            "export const loaded = true;\n");
          return [report("taste-skill", input.capability)];
        }
        return [report("native-dwa", input.capability)];
      };
      await assert.rejects(() => runProfileProviders({
        ...f.request, profile: "deep", withImpeccable: false,
        withTaste: true, html: f.html, outputRoot: f.root,
      }, { registry: registry(), execute }), /changed during provider execution/,
      "Must reject " + scenario);
    });
  }
});

test("browser route must match a real static HTML route, not an SPA label", async () => {
  await fixture(async (f) => {
    await assert.rejects(() => runProfileProviders({
      ...f.request, route: "/quiz/jeopardy/setup",
      withTaste: true, html: f.html,
    }, { registry: registry() }), /Requested route does not match/);
  });
});

test("source fingerprint covers JavaScript used by Impeccable", async () => {
  await fixture(async (f) => {
    const js = join(f.srcDir, "helper.js");
    writeFileSync(js, "export const demo = 1;");
    const before = await runProfileProviders({ ...f.request, profile: "quick" }, {
      registry: registry(),
    });
    writeFileSync(js, "export const demo = 2;");
    const after = await runProfileProviders({ ...f.request, profile: "quick" }, {
      registry: registry(),
    });
    assert.notEqual(before.scope.sourceSha256, after.scope.sourceSha256);
  });
});

test("a changed intent file invalidates the source snapshot", async () => {
  await fixture(async (f) => {
    const intentPath = join(f.root, "intent.json");
    writeFileSync(intentPath, '{"exceptions":[]}');
    const args = { ...f.request, profile: "quick", intentPath };
    const before = await runProfileProviders(args, { registry: registry() });
    writeFileSync(intentPath, '{"exceptions":[{"rule":"G29","reason":"documented"}]}');
    const after = await runProfileProviders(args, { registry: registry() });
    assert.notEqual(before.scope.sourceSha256, after.scope.sourceSha256);
  });
});

test("static route mapping accepts uppercase HTML extensions", async () => {
  await fixture(async (f) => {
    const html = join(f.built, "test", "index.HTML");
    writeFileSync(html, "<!doctype html><h1>Test</h1>");
    const out = await runProfileProviders({
      ...f.request, withTaste: true, html,
    }, { registry: registry() });
    assert.equal(out.scope.routeBinding, "verified-static-html-path");
  });
});

test("a file changed then restored during scanning invalidates observed input state", async () => {
  await fixture(async (f) => {
    const original = "export const Page = () => <h1>Test</h1>;";
    const execute = async (_, input) => {
      writeFileSync(f.target, "export const changed = true;");
      writeFileSync(f.target, original);
      return [report("native-dwa", input.capability)];
    };
    await assert.rejects(() => runProfileProviders({
      ...f.request, profile: "quick",
    }, { registry: registry(), execute }), /changed during provider execution/);
  });
});
