import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Capability, ProviderStatus } from "../../scripts/providers/contract.mjs";
import { createProviderRegistry, runProviders } from "../../scripts/providers/registry.mjs";
import { createImpeccableProvider } from "../../scripts/providers/impeccable.mjs";

const cli = fileURLToPath(new URL("../../scripts/providers/scan.mjs", import.meta.url));

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-impeccable-"));
  const target = join(root, "page.tsx");
  writeFileSync(target, "export const Page = () => <h1>Hello</h1>;\n");
  try { return await fn({ root, target }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function result({ stdout = "[]", exitCode = 0 } = {}) {
  return {
    stdout, stderr: "", exitCode, error: null,
    timedOut: false, outputLimitExceeded: false,
  };
}

test("normalizes primary and advisory Impeccable findings without inventing P0", async () => {
  await fixture(async ({ root, target }) => {
    const raw = [
      { antipattern: "ai-color-palette", name: "Generated palette",
        description: "Default-looking colors", category: "slop",
        severity: "warning", file: target, line: 8, snippet: "text-purple-600" },
      { antipattern: "em-dash-overuse", name: "Dash usage",
        severity: "advisory", advisory: true, file: target, line: 9, snippet: "—" },
    ];
    let invocation;
    const provider = createImpeccableProvider({
      runner: async (args) => { invocation = args; return result({
        stdout: JSON.stringify(raw), exitCode: 2,
      }); },
    });
    const report = await provider.inspect({
      capability: Capability.STATIC_AUDIT,
      target, route: "/settings", projectRoot: root,
    });
    assert.equal(report.status, ProviderStatus.FINDINGS, report.reason);
    assert.equal(report.findings.length, 2);
    assert.equal(report.findings[0].providerRuleId, "ai-color-palette");
    assert.equal(report.findings[0].priority, "P2");
    assert.equal(report.findings[0].location.file, "page.tsx");
    assert.equal(report.findings[0].location.route, "/settings");
    assert.equal(report.findings[0].evidence[0].ref, "page.tsx:8");
    assert.equal(report.findings[1].advisory, true);
    assert.equal(report.summary.primary, 1);
    assert.equal(report.summary.advisory, 1);
    assert.equal(report.provenance.implementation, "bundled-js");
    assert.equal(invocation.executable, process.execPath);
    assert.ok(invocation.args.includes("--json"));
    assert.ok(invocation.args.includes(resolve(target)));
    assert.ok(!invocation.args.includes("npx"));
    assert.equal(invocation.cwd, root);
  });
});

test("stable fingerprints deduplicate identical locations without erasing two findings", async () => {
  await fixture(async ({ root, target }) => {
    const raw = { antipattern: "x", name: "X", severity: "warning",
      file: target, line: 1, snippet: "same" };
    const provider = createImpeccableProvider({
      runner: async () => result({ stdout: JSON.stringify([raw, raw]), exitCode: 2 }),
    });
    const first = await provider.inspect({ capability: Capability.STATIC_AUDIT,
      target, route: "/", projectRoot: root });
    const second = await provider.inspect({ capability: Capability.STATIC_AUDIT,
      target, route: "/", projectRoot: root });
    assert.equal(first.status, ProviderStatus.FINDINGS, first.reason);
    assert.equal(new Set(first.findings.map((f) => f.id)).size, 2);
    assert.deepEqual(first.findings.map((f) => f.id),
      second.findings.map((f) => f.id));
  });
});

test("advisory-only output is evidence, not a tool failure or a clean pass", async () => {
  await fixture(async ({ root, target }) => {
    const raw = [{ antipattern: "advisory", name: "Advisory", severity: "advisory",
      file: target, line: 0, snippet: "x" }];
    const p = createImpeccableProvider({
      runner: async () => result({ stdout: JSON.stringify(raw) }),
    });
    const report = await p.inspect({ capability: Capability.STATIC_AUDIT,
      target, route: "/", projectRoot: root });
    assert.equal(report.status, ProviderStatus.FINDINGS);
    assert.equal(report.summary.primary, 0);
    assert.equal(report.summary.advisory, 1);
  });
});

test("empty valid detector output is a scoped PASS only", async () => {
  await fixture(async ({ root, target }) => {
    const p = createImpeccableProvider({ runner: async () => result() });
    const report = await p.inspect({ capability: Capability.STATIC_AUDIT,
      target, route: "/", projectRoot: root });
    assert.equal(report.status, ProviderStatus.PASS);
    assert.equal(report.summary.requiresRenderedReview, true);
    assert.equal(report.summary.sourceOnly, true);
  });
});

test("partial, inconsistent and malformed detector results are ERROR", async () => {
  await fixture(async ({ root, target }) => {
    const bad = [
      result({ exitCode: 1 }),
      result({ stdout: "not json" }),
      result({ stdout: "{}" }),
      result({ exitCode: 2 }),
      result({ stdout: JSON.stringify([{ antipattern: "x", name: "X",
        severity: "warning", file: target }]), exitCode: 0 }),
      result({ stdout: JSON.stringify([{ antipattern: "x", name: "X",
        severity: "warning", file: "/outside/sensitive.txt" }]), exitCode: 2 }),
      { ...result(), timedOut: true },
      { ...result(), outputLimitExceeded: true },
    ];
    for (const run of bad) {
      const p = createImpeccableProvider({ runner: async () => run });
      const out = await p.inspect({
        capability: Capability.STATIC_AUDIT, target, route: "/", projectRoot: root,
      });
      assert.equal(out.status, ProviderStatus.ERROR, JSON.stringify(run));
    }
  });
});

test("URL, missing target, symlink and escaped project scope are blocked before execution", async () => {
  await fixture(async ({ root, target }) => {
    let called = 0;
    const p = createImpeccableProvider({ runner: async () => {
      called++; return result();
    } });
    const requests = [
      { target: "https://example.com", projectRoot: root },
      { target: join(root, "not-found.tsx"), projectRoot: root },
      { target, projectRoot: join(root, "not-found") },
    ];
    const nested = join(root, "nested");
    mkdirSync(nested);
    requests.push({ target, projectRoot: nested });
    const link = join(root, "alias.tsx");
    symlinkSync(target, link, "file");
    requests.push({ target: link, projectRoot: root });
    for (const request of requests) {
      const out = await p.inspect({ capability: Capability.STATIC_AUDIT,
        ...request, route: "/" });
      assert.equal(out.status, ProviderStatus.BLOCKED);
    }
    assert.equal(called, 0);
  });
});


test("vendored walker extension policy matches the source symlink preflight", async () => {
  const { SCANNABLE_EXTENSIONS, SKIP_DIRS } = await import(
    "../../../impeccable/scripts/detector/node/file-system.mjs");
  for (const suffix of SCANNABLE_EXTENSIONS) {
    assert.match("file" + suffix,
      /\.(?:html?|css|scss|sass|less|jsx?|tsx?|vue|svelte|astro|blade\.php)$/i);
  }
  assert.deepEqual([...SKIP_DIRS].sort(), ["__pycache__", "build", "dist", "node_modules"]);
});

test("unavailable local detector remains explicit; no npx or engine installation", async () => {
  const provider = createImpeccableProvider({ script: join(tmpdir(), "no-such-detector.mjs") });
  const registry = createProviderRegistry([provider]);
  const [required] = await runProviders(registry, { required: ["impeccable"] });
  const [optional] = await runProviders(registry, { optional: ["impeccable"] });
  assert.equal(required.status, ProviderStatus.BLOCKED);
  assert.equal(optional.status, ProviderStatus.UNAVAILABLE);
});

test("real vendored detector can scan a local source fixture, with no external launcher", () => {
  return fixture(({ root, target }) => {
    const run = spawnSync(process.execPath, [cli, "--provider", "impeccable",
      "--path", target, "--route", "/fixture", "--project-root", root],
    { encoding: "utf8", timeout: 30_000 });
    assert.ok([0, 1].includes(run.status), run.stderr + "\n" + run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.provider, "impeccable");
    assert.equal(report.provenance.implementation, "bundled-js");
    assert.ok([ProviderStatus.PASS, ProviderStatus.FINDINGS].includes(report.status));
  });
});

test("explicit CLI rejects unsupported options without touching the provider", () => {
  const run = spawnSync(process.execPath, [cli, "--provider", "impeccable",
    "--path", "https://example.com", "--route", "/", "--allow-live", "true"],
  { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(JSON.parse(run.stdout).error, /Unrecognized/);
});
