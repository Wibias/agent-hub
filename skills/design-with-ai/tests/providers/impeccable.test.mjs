import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Capability, ProviderStatus } from "../../scripts/providers/contract.mjs";
import { createProviderRegistry, runProviders } from "../../scripts/providers/registry.mjs";
import { createImpeccableProvider } from "../../scripts/providers/impeccable.mjs";
import { collectStaticCssText } from "../../../impeccable/scripts/detector/engines/static-html/css-cascade.mjs";

const cli = fileURLToPath(new URL("../../scripts/providers/scan.mjs", import.meta.url));
const vendoredCli = fileURLToPath(new URL("../../../impeccable/scripts/detect.mjs", import.meta.url));
const validProof = Object.freeze({
  schemaVersion: 1, candidateFiles: 1, eligibleFiles: 1,
  scannedFiles: 1, ignoredFiles: 0, degradedFiles: 0, durationMs: 1,
  configEnabled: true, inlineIgnoresEnabled: true, designSystemEnabled: false,
});
const proofLine = (proof = validProof) => "DWA_IMPECCABLE_SCAN_PROOF=" + JSON.stringify(proof) + "\n";

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-impeccable-"));
  const target = join(root, "page.tsx");
  writeFileSync(target, "export const Page = () => <h1>Hello</h1>;\n");
  try { return await fn({ root, target }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function result({ stdout = "[]", exitCode = 0, stderr = proofLine() } = {}) {
  return {
    stdout, stderr, exitCode, error: null,
    timedOut: false, outputLimitExceeded: false,
  };
}

test("unreadable local HTML stylesheet marks source scan degraded", () => {
  const root = mkdtempSync(join(tmpdir(), "dwa-css-degraded-"));
  try {
    const file = join(root, "index.html");
    const css = join(root, "styles.css");
    writeFileSync(file, '<link rel="stylesheet" href="styles.css">');
    mkdirSync(css); // Directory is not a readable stylesheet on Linux/Windows.
    const modules = {
      selectAll: (selector) => selector === "link"
        ? [{ attribs: { rel: "stylesheet", href: "styles.css" } }] : [],
      domutils: { textContent: () => "" },
    };
    const degraded = [];
    const text = collectStaticCssText(
      { children: [] }, root, null, file, modules,
      (source) => degraded.push(source),
    );
    assert.equal(text, "");
    assert.deepEqual(degraded, [file],
      "a swallowed stylesheet read must degrade the HTML source receipt");

    rmSync(css, { recursive: true });
    writeFileSync(css, "h1 { color: red; }");
    degraded.length = 0;
    const valid = collectStaticCssText(
      { children: [] }, root, null, file, modules,
      (source) => degraded.push(source),
    );
    assert.equal(valid, "h1 { color: red; }");
    assert.deepEqual(degraded, [], "valid linked CSS must not report degraded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
    assert.ok(invocation.args.includes("--dwa-scan-proof"));
    assert.equal(invocation.timeoutMs, 120_000);
    assert.equal(report.summary.filesScanned, 1);
    assert.equal(report.summary.coverageCountVerified, true);
    assert.equal(report.summary.coverageMethod, "bundled-detector-completed-source-file-count");
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
    assert.equal(report.summary.filesScanned, 1);
    assert.equal(report.summary.coverageCountVerified, true);
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


test("incomplete detector exit never persists arbitrary stderr or malformed exit codes", async () => {
  await fixture(async ({ root, target }) => {
    const stderr = "Failure at /api/token=CANARY_SCANNER_STDERR_20261107\n" +
      "FATAL_SCANNER_EXIT https://example.test/?key=CANARY_URL_20261107\n";
    for (const [exitCode, expected] of [
      [1, "Impeccable detector did not complete (exit 1)"],
      ["token=CANARY_BAD_EXIT_20261107",
        "Impeccable detector did not complete (exit unknown)"],
    ]) {
      const provider = createImpeccableProvider({
        runner: async () => result({ exitCode, stderr }),
      });
      const out = await provider.inspect({
        capability: Capability.STATIC_AUDIT, target, route: "/settings",
        projectRoot: root,
      });
      assert.equal(out.status, ProviderStatus.ERROR);
      assert.equal(out.reason, expected);
      const persisted = JSON.stringify(out);
      assert.ok(!persisted.includes("CANARY_"));
      assert.ok(!persisted.includes("FATAL_SCANNER_EXIT"));
      assert.ok(!persisted.includes("example.test"));
    }
  });
});

test("missing, duplicate, contradictory or empty source receipts never PASS", async () => {
  await fixture(async ({ root, target }) => {
    const cases = [
      "",
      proofLine() + proofLine(),
      proofLine({ ...validProof, scannedFiles: 0 }),
      proofLine({ ...validProof, scannedFiles: 0, degradedFiles: 1 }),
      proofLine({ ...validProof, scannedFiles: 1, degradedFiles: 1 }),
      proofLine({ ...validProof, candidateFiles: 0 }),
      proofLine({ ...validProof, eligibleFiles: 0, scannedFiles: 0, ignoredFiles: 1 }),
      proofLine({ ...validProof, scannedFiles: 3 }),
      proofLine({ ...validProof, configEnabled: false }),
      "DWA_IMPECCABLE_SCAN_PROOF={invalid}\n",
    ];
    for (const stderr of cases) {
      const p = createImpeccableProvider({
        runner: async () => result({ stderr }),
      });
      const report = await p.inspect({
        capability: Capability.STATIC_AUDIT, target, route: "/", projectRoot: root,
      });
      assert.equal(report.status, ProviderStatus.ERROR, JSON.stringify({ stderr, report }));
    }
  });
});

test("real vendored scan-proof CLI rejects symlink file and directory targets", async () => {
  await fixture(({ root, target }) => {
    const sourceAlias = join(root, "source-alias.tsx");
    const directoryAlias = join(root, "directory-alias");
    symlinkSync(target, sourceAlias, "file");
    symlinkSync(root, directoryAlias, "dir");
    for (const aliased of [sourceAlias, directoryAlias]) {
      const scan = spawnSync(process.execPath,
        [vendoredCli, "--json", "--dwa-scan-proof", aliased],
        { cwd: root, encoding: "utf8", timeout: 30_000 });
      assert.equal(scan.status, 1, scan.stderr + scan.stdout);
      assert.match(scan.stderr, /scan-proof target must not be a symbolic link/);
      assert.ok(!scan.stderr.includes(aliased),
        "fail-closed diagnostics must not reveal arbitrary path bytes");
      assert.ok(!scan.stderr.includes("DWA_IMPECCABLE_SCAN_PROOF="),
        "a rejected target must not produce a completed scan proof");
    }
  });
});

test("real vendored scanner reports actual eligible and completed files", async () => {
  await fixture(({ root, target }) => {
    const second = join(root, "second.tsx");
    writeFileSync(target, "export const Card = () => <div className=\"rounded-lg border-l-4 animate-bounce\">hello</div>;\n");
    writeFileSync(second, "export const Clean = () => <main>fine</main>;\n");
    const run = spawnSync(process.execPath,
      [vendoredCli, "--json", "--dwa-scan-proof", root],
      { cwd: root, encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 2, run.stderr);
    const findings = JSON.parse(run.stdout);
    assert.ok(findings.some((f) => f.antipattern === "side-tab"));
    assert.ok(findings.some((f) => f.antipattern === "bounce-easing"));
    const marker = run.stderr.split(/\r?\n/).find((line) =>
      line.startsWith("DWA_IMPECCABLE_SCAN_PROOF="));
    assert.ok(marker, run.stderr);
    const proof = JSON.parse(marker.split("=").slice(1).join("="));
    assert.equal(proof.candidateFiles, 2);
    assert.equal(proof.eligibleFiles, 2);
    assert.equal(proof.scannedFiles, 2);
    assert.equal(proof.ignoredFiles, 0);
    assert.equal(proof.degradedFiles, 0);
  });
});

test("inline waivers suppress findings without suppressing file coverage", async () => {
  await fixture(({ root, target }) => {
    writeFileSync(target, 'font-family: "Space Grotesk"; /* impeccable-disable-line overused-font: test fixture */\n');
    // The extension must be CSS for this realistic inline-waiver control.
    const css = join(root, "style.css");
    writeFileSync(css, 'font-family: "Space Grotesk"; /* impeccable-disable-line overused-font: test fixture */\n');
    const scan = (extra = []) => spawnSync(process.execPath,
      [vendoredCli, "--json", "--dwa-scan-proof", ...extra, css],
      { cwd: root, encoding: "utf8", timeout: 30_000 });
    const regular = scan();
    const raw = scan(["--no-inline-ignores"]);
    assert.equal(regular.status, 0, regular.stderr);
    assert.equal(JSON.parse(regular.stdout).length, 0);
    assert.equal(raw.status, 2, raw.stderr);
    assert.ok(JSON.parse(raw.stdout).some((f) => f.antipattern === "overused-font"));
    for (const run of [regular, raw]) {
      const meta = run.stderr.split(/\r?\n/)
        .find((line) => line.startsWith("DWA_IMPECCABLE_SCAN_PROOF="));
      assert.ok(meta, run.stderr);
      assert.equal(JSON.parse(meta.slice("DWA_IMPECCABLE_SCAN_PROOF=".length)).scannedFiles, 1);
    }
  });
});

test("HTML parser fallback is explicitly degraded, not complete browser-grade evidence", async () => {
  await fixture(async ({ root }) => {
    const { detectHtml } = await import(
      "../../../impeccable/scripts/detector/engines/static-html/detect-html.mjs");
    const page = join(root, "degraded.html");
    writeFileSync(page, "<!doctype html><html><body><main>Loaded</main></body></html>\n");
    const degraded = [];
    const findings = await detectHtml(page, {
      parserLoader: async () => { throw new Error("Test-only missing parser modules"); },
      onDegraded: (file) => degraded.push(file),
    });
    assert.equal(Array.isArray(findings), true);
    assert.deepEqual(degraded, [page]);
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



test("filesystem preflight errors redact private paths from BLOCKED reports", async () => {
  await fixture(async ({ root }) => {
    const canary = "CANARY_PRIVATE_DIRECTORY_20261107";
    const originalReaddir = fs.readdirSync;
    let invoked = 0;
    const provider = createImpeccableProvider({
      runner: async () => { invoked++; return result(); },
    });
    try {
      fs.readdirSync = (...args) => {
        if (args[0] === root) {
          const error = new Error("EACCES: permission denied, scandir '/" + canary + "'");
          error.code = "EACCES";
          throw error;
        }
        return originalReaddir(...args);
      };
      syncBuiltinESMExports();
      const report = await provider.inspect({
        capability: Capability.STATIC_AUDIT,
        target: root, projectRoot: root, route: "/settings",
      });
      assert.equal(report.status, ProviderStatus.BLOCKED);
      assert.equal(report.reason, "Source scope preflight failed");
      assert.ok(!JSON.stringify(report).includes(canary));
      assert.equal(invoked, 0, "a failed preflight must not start the detector");
    } finally {
      fs.readdirSync = originalReaddir;
      syncBuiltinESMExports();
    }
  });
});

test("scannable symlink paths never leak into blocked Impeccable evidence", async () => {
  await fixture(async ({ root, target }) => {
    const canary = "CANARY_SCANNABLE_SYMLINK_SECRET_20261107";
    const injectedPath = join(root, canary + ".tsx");
    symlinkSync(target, injectedPath, "file");
    let invoked = 0;
    const provider = createImpeccableProvider({
      runner: async () => { invoked++; return result(); },
    });
    const report = await provider.inspect({
      capability: Capability.STATIC_AUDIT,
      target: root, projectRoot: root, route: "/settings",
    });
    assert.equal(invoked, 0, "Symlink must be blocked before the detector runs");
    assert.equal(report.status, ProviderStatus.BLOCKED);
    assert.equal(report.reason, "Symlinked UI source is outside the trusted scan scope");
    assert.ok(!JSON.stringify(report).includes(canary));
    assert.ok(!JSON.stringify(report).includes(injectedPath));
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
