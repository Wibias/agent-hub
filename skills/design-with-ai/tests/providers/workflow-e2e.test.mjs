// Real local end-to-end smoke: executes the vendored DWA and Impeccable scripts.
// Browser subprocess smoke lives in browser-live-smoke.mjs, with a pinned install.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli = fileURLToPath(new URL("../../scripts/providers/quality-audit.mjs", import.meta.url));
async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-real-e2e-"));
  const srcDir = join(root, "src");
  mkdirSync(srcDir);
  const built = join(root, "dist");
  mkdirSync(join(built, "settings"), { recursive: true });
  const renderedPage = join(built, "settings", "index.html");
  writeFileSync(renderedPage, "<!doctype html><title>Settings</title>");
  const htmlPage = join(srcDir, "index.html");
  writeFileSync(htmlPage, [
    "<!doctype html>",
    "<html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>Test</title></head><body><main><h1>Account</h1>",
    "<p>Settings and recent activity.</p><a href=\"/settings\">Settings</a>",
    "</main></body></html>",
  ].join("\n"));
  const page = join(srcDir, "source.css");
  writeFileSync(page, ".panel { padding: 12px; color: #222; }\n");
  try { return await fn({ root, page, htmlPage, srcDir, built, renderedPage }); }
  finally { rmSync(root, { force: true, recursive: true }); }
}
function invoke(f, extra = [], sourcePath = f.page) {
  return spawnSync(process.execPath, [cli,
    ...(extra.includes("--profile") ? [] : ["--profile", "standard"]),
    "--path", sourcePath,
    "--route", "/settings", "--project-root", f.root,
    "--output-root", f.root, ...extra,
  ], { encoding: "utf8", timeout: 90_000 });
}

test("real native and vendored Impeccable gate run through the profile CLI", () =>
  fixture((f) => {
    const run = invoke(f);
    assert.ok([0, 1].includes(run.status), run.stderr + "\n" + run.stdout);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.schemaVersion, 1);
    assert.equal(summary.completionEligible, false);
    assert.deepEqual(summary.coverage.statuses.map((r) => r.provider),
      ["impeccable", "native-dwa"]);
    for (const name of ["native-dwa", "impeccable"]) {
      const path = summary.artifacts.reports[name];
      assert.ok(existsSync(path));
      const report = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(report.provider, name);
      assert.equal(report.auditScope.route, "/settings");
      assert.equal(report.auditScope.target, "src/source.css");
      assert.equal(report.auditScope.sourceSha256, summary.scope.sourceSha256);
      assert.match(report.auditScope.sourceSha256, /^[0-9a-f]{64}$/);
      assert.ok(["PASS", "FINDINGS"].includes(report.status), JSON.stringify(report));
    }
    assert.ok(existsSync(summary.artifacts.sourceScope));
    const sourceManifest = JSON.parse(readFileSync(summary.artifacts.sourceScope, "utf8"));
    assert.equal(sourceManifest.files.length, summary.scope.fileCount);
    assert.equal(sourceManifest.files[0].path, "src/source.css");
    assert.match(summary.artifacts.reportSha256["native-dwa"], /^[0-9a-f]{64}$/);
    assert.ok(existsSync(summary.artifacts.fusion));
    assert.equal(JSON.parse(readFileSync(summary.artifacts.fusion, "utf8"))
      .completionEligible, false);
  }));

test("HTML fallback without parser dependencies is incomplete, never a green provider proof", () =>
  fixture((f) => {
    const run = invoke(f, [], f.htmlPage);
    assert.equal(run.status, 1, run.stderr + "\n" + run.stdout);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.status, "INCOMPLETE");
    assert.equal(summary.coverage.complete, false);
    const impeccable = JSON.parse(readFileSync(
      summary.artifacts.reports.impeccable, "utf8"));
    assert.equal(impeccable.status, "ERROR");
    assert.match(impeccable.reason, /Incomplete or contradictory source scan receipt/);
  }));

test("quick preserves only the DWA native provider", () => fixture((f) => {
  const run = invoke(f, ["--profile", "quick"]);
  assert.equal(run.status, 0, run.stderr + "\n" + run.stdout);
  const summary = JSON.parse(run.stdout);
  assert.deepEqual(Object.keys(summary.artifacts.reports), ["native-dwa"]);
  assert.deepEqual(summary.selected.notSelected, ["impeccable", "taste-skill"]);
}));

test("missing opt-in browser installation never claims a green three-provider check", () =>
  fixture((f) => {
    const run = invoke(f, ["--profile", "deep", "--with-taste", "--html", f.renderedPage,
      "--taste-root", join(f.root, "not-installed"), "--browser-root", f.built]);
    assert.equal(run.status, 1, run.stderr + "\n" + run.stdout);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.status, "INCOMPLETE");
    assert.equal(summary.coverage.complete, false);
    assert.equal(JSON.parse(readFileSync(summary.artifacts.reports["taste-skill"], "utf8"))
      .status, "UNAVAILABLE");
  }));

test("explicitly required missing Taste runtime blocks", () => fixture((f) => {
  const run = invoke(f, ["--profile", "deep", "--require-taste",
    "--html", f.renderedPage, "--taste-root", join(f.root, "missing"), "--browser-root", f.built]);
  assert.equal(run.status, 1, run.stderr + "\n" + run.stdout);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.coverage.complete, false);
}));

test("invalid profile/source options stop with error without executing tools", () =>
  fixture((f) => {
    const run = invoke(f, ["--profile", "quick", "--with-taste", "--html", f.page]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Quick profile/);
  }));
