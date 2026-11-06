#!/usr/bin/env node
// Optional read-only companion probe: compare actual Playwright response body
// bytes against a bounded local build-tree receipt. It DOES NOT attest the
// distinct Chrome contexts or frames used by the Taste Skill provider.
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname, isAbsolute, join, relative, resolve, sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderedAssetProof } from "./rendered-assets.mjs";
import { staticRouteForHtml } from "./scope-proof.mjs";

const WIDTHS = Object.freeze([1440, 768, 390]);
const MAX_RESPONSES = 2_000;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 128 * 1024 * 1024;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const inside = (root, value) => {
  const rel = relative(root, value);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};
// Browser/navigation errors may include full URLs with query secrets. Retain
// only a short redacted explanation in persistent diagnostic evidence.
const shortError = (error) => String(error?.message ?? error)
  .replace(/https?:\/\/[^\s'"<>]+/gi, "<url-redacted>")
  .slice(0, 220);
const string = (value) => typeof value === "string" && value.trim().length > 0;

function strictInputs(options) {
  if (!options || ![
    options.baseUrl, options.route, options.projectRoot,
    options.renderedRoot, options.html, options.playwrightRoot,
  ].every(string)) throw new TypeError("Explicit local page, roots, route and Playwright root required");
  const base = new URL(options.baseUrl);
  if (base.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
      base.username || base.password || base.pathname !== "/" ||
      base.search || base.hash) {
    throw new TypeError("Only a clean loopback HTTP origin is allowed");
  }
  const route = options.route;
  if (!/^\/[a-zA-Z0-9._~/%-]*$/.test(route) || route.startsWith("//") ||
      /%2f|%5c|%2e|%00/i.test(route) || route.split("/").includes("..")) {
    throw new TypeError("Route must be an unambiguous absolute local path");
  }
  const project = resolve(options.projectRoot);
  const rendered = resolve(options.renderedRoot);
  const html = resolve(options.html);
  const playwright = resolve(options.playwrightRoot);
  for (const path of [project, rendered, html, playwright]) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) {
      throw new TypeError("Roots, HTML and Playwright must exist and not be symlinks");
    }
  }
  const canonicalProject = realpathSync(project);
  const canonicalRendered = realpathSync(rendered);
  const canonicalHtml = realpathSync(html);
  if (!inside(canonicalProject, canonicalRendered) ||
      !inside(canonicalRendered, canonicalHtml) ||
      canonicalRendered === canonicalProject ||
      staticRouteForHtml(canonicalRendered, canonicalHtml) !== route) {
    throw new TypeError("HTML does not map to the declared isolated build route");
  }
  if (!lstatSync(playwright).isDirectory() || !existsSync(join(playwright, "index.mjs"))) {
    throw new TypeError("Use an explicitly installed and trusted Playwright package root");
  }
  const outRoot = resolve(options.outRoot ?? tmpdir());
  if (!existsSync(outRoot) || !lstatSync(outRoot).isDirectory() ||
      lstatSync(outRoot).isSymbolicLink() ||
      inside(canonicalRendered, realpathSync(outRoot))) {
    throw new TypeError("Evidence output root must be outside the served build tree");
  }
  if (options.chromePath !== undefined &&
      (!string(options.chromePath) || !existsSync(resolve(options.chromePath)))) {
    throw new TypeError("Explicit browser executable does not exist");
  }
  return {
    project: canonicalProject, rendered: canonicalRendered,
    html: canonicalHtml, playwright: realpathSync(playwright),
    url: new URL(route, base.origin).href, baseOrigin: base.origin,
    route, outRoot: realpathSync(outRoot),
    chromePath: options.chromePath ? resolve(options.chromePath) : null,
  };
}

function localAssetPath(resourceUrl, context) {
  let u;
  try { u = new URL(resourceUrl); } catch { return null; }
  if (u.origin !== context.baseOrigin) return null;
  // No percent-encoded separator, backslash or ambiguous dot segment.
  if (/%2f|%5c|%2e|%00/i.test(u.pathname)) {
    throw new TypeError("Ambiguous encoded local resource path");
  }
  const path = decodeURIComponent(u.pathname);
  if (!path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new TypeError("Invalid local resource path");
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.some((seg) => seg === "." || seg === "..")) {
    throw new TypeError("Unsafe local resource traversal");
  }
  // A static /settings route is normally served from /settings/index.html.
  // Correlate exactly the declared document route, not arbitrary SPA aliases.
  if (path === context.route || path === context.route + "/") {
    return relative(context.project, context.html).replaceAll("\\", "/");
  }
  const file = join(context.rendered, ...segments);
  if (!inside(context.rendered, file)) {
    throw new TypeError("Requested resource escapes built asset root");
  }
  return relative(context.project, file).replaceAll("\\", "/");
}

async function loadBrowser(packageRoot) {
  const pkg = await import(pathToFileURL(join(packageRoot, "index.mjs")).href);
  if (!pkg.chromium?.launch) throw new TypeError("Trusted Playwright package lacks Chromium");
  return pkg.chromium;
}

/**
 * Captures response bodies only from its OWN anonymous browser contexts.
 * Local responses are hashed and compared with an immutable-on-this-probe
 * manifest; URLs and bodies are never written into the report. Remote URLs
 * are represented by SHA-256 only. This is diagnostic evidence, NOT a Taste
 * report supplement and NOT a DWA completion gate.
 */
export async function probeNetworkResponses(options, { browserFactory = loadBrowser } = {}) {
  const context = strictInputs(options);
  const before = renderedAssetProof({
    projectRoot: context.project, renderedRoot: context.rendered, html: context.html,
  });
  const expected = new Map(before.files.map((file) => [file.path, file]));
  const runDir = mkdtempSync(join(context.outRoot, "dwa-network-responses-"));
  const report = {
    schemaVersion: 1,
    kind: "dwa/independent-browser-network-body-probe",
    route: context.route,
    widths: [...WIDTHS],
    expectedLocalAssetTreeSha256: before.filesSha256,
    expectedLocalFileCount: before.fileCount,
    status: "INCOMPLETE",
    observations: [],
    tasteFramesVerified: false,
    authenticatedSessionVerified: false,
    productCompletionEligible: false,
    limitations: [
      "The page is opened in fresh probe browser contexts, never Taste Skill's own sessions.",
      "Only responses observed before this probe finishes can be checked; lazy future requests are not covered.",
      "External resources, backend semantics, service-worker caches and game state remain unverified.",
    ],
    artifactDirectory: runDir,
  };
  let browser;
  try {
    const chromium = await browserFactory(context.playwright);
    browser = await chromium.launch({
      headless: true,
      ...(context.chromePath
        ? { executablePath: context.chromePath } : { channel: "chrome" }),
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    for (const width of WIDTHS) {
      const obs = {
        width, status: "INCOMPLETE", local: [], external: [],
        issues: [], localBytesChecked: 0, screenshotSha256: null,
      };
      report.observations.push(obs);
      let ctx;
      try {
        ctx = await browser.newContext({
          viewport: { width, height: 900 },
          storageState: { cookies: [], origins: [] },
          serviceWorkers: "block",
        });
        const page = await ctx.newPage();
        const pending = [];
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(shortError(e)));
        page.on("requestfailed", (request) => {
          // Missing responses must not quietly disappear from the observed set.
          // Never store URLs or request bodies, which may contain credentials.
          obs.issues.push("BROWSER_REQUEST_FAILED");
        });
        page.on("response", (response) => {
          if (obs.local.length + obs.external.length >= MAX_RESPONSES) {
            obs.issues.push("RESPONSE_COUNT_LIMIT");
            return;
          }
          const resourceUrl = response.url();
          let path;
          try { path = localAssetPath(resourceUrl, context); }
          catch { obs.issues.push("UNSAFE_LOCAL_RESOURCE_URL"); return; }
          if (path === null) {
            obs.external.push({
              urlSha256: sha(resourceUrl), status: response.status(),
              bodyVerified: false,
            });
            return;
          }
          const row = {
            path, status: response.status(),
            expectedSha256: expected.get(path)?.sha256 ?? null,
            receivedSha256: null, bodyVerified: false,
          };
          obs.local.push(row);
          if (!expected.has(path)) {
            obs.issues.push("UNMAPPED_LOCAL_RESPONSE");
            return;
          }
          if (response.status() !== 200) {
            obs.issues.push("NON_200_LOCAL_RESPONSE");
            return;
          }
          const indicatedLength = Number(response.headers?.()?.["content-length"]);
          if (Number.isFinite(indicatedLength) && indicatedLength > MAX_BODY_BYTES) {
            obs.issues.push("LOCAL_RESPONSE_TOO_LARGE");
            return;
          }
          const task = (async () => {
            try {
              const body = await response.body();
              if (!Buffer.isBuffer(body) || body.length > MAX_BODY_BYTES ||
                  obs.localBytesChecked + body.length > MAX_CAPTURE_BYTES) {
                obs.issues.push("LOCAL_RESPONSE_BODY_LIMIT");
                return;
              }
              obs.localBytesChecked += body.length;
              row.receivedSha256 = sha(body);
              row.bodyVerified = row.receivedSha256 === row.expectedSha256;
              if (!row.bodyVerified) obs.issues.push("LOCAL_RESPONSE_BODY_MISMATCH");
            } catch {
              obs.issues.push("LOCAL_RESPONSE_BODY_UNAVAILABLE");
            }
          })();
          pending.push(task);
        });
        const nav = await page.goto(context.url, {
          waitUntil: "load", timeout: 45_000,
        });
        obs.httpStatus = nav?.status?.() ?? null;
        await page.waitForTimeout(750);
        const screenshotFile = join(runDir, "network-" + width + ".png");
        await page.screenshot({ path: screenshotFile, fullPage: false, timeout: 20_000 });
        obs.screenshotSha256 = sha(readFileSync(screenshotFile));
        obs.finalUrlMatched = page.url() === context.url;
        for (let round = 0; round < 3; round++) {
          const previous = pending.length;
          await Promise.allSettled([...pending]);
          await page.waitForTimeout(100);
          if (previous === pending.length) break;
        }
        obs.pageErrorCount = pageErrors.length;
        if (pageErrors.length) obs.issues.push("BROWSER_PAGE_ERRORS");
        obs.status = obs.httpStatus === 200 && obs.finalUrlMatched &&
          obs.screenshotSha256 && obs.local.length > 0 &&
          obs.local.every((entry) => entry.bodyVerified) &&
          obs.issues.length === 0 ? "LOCAL_BODY_BYTES_MATCHED" : "INCOMPLETE";
      } catch (error) {
        obs.issues.push("BROWSER_PROBE_FAILURE: " + shortError(error));
      } finally {
        await ctx?.close().catch(() => {});
      }
    }
  } catch (error) {
    report.error = shortError(error);
  } finally {
    await browser?.close().catch(() => {});
  }
  try {
    const after = renderedAssetProof({
      projectRoot: context.project, renderedRoot: context.rendered, html: context.html,
    });
    report.localAssetTreeUnchanged = after.filesSha256 === before.filesSha256;
  } catch (error) {
    report.localAssetTreeUnchanged = false;
    report.assetRescanError = shortError(error);
  }
  if (report.localAssetTreeUnchanged && report.observations.length === 3 &&
      report.observations.every((o) => o.status === "LOCAL_BODY_BYTES_MATCHED")) {
    report.status = report.observations.some((o) => o.external.length > 0)
      ? "LOCAL_MATCHED_EXTERNAL_UNVERIFIED"
      : "LOCAL_RESPONSES_MATCHED";
  }
  writeFileSync(join(runDir, "network-report.json"),
    JSON.stringify(report, null, 2) + "\n");
  return report;
}

function parseCli(argv) {
  const flags = new Set([
    "--base-url", "--route", "--project-root", "--browser-root",
    "--html", "--playwright-root", "--out-root", "--chrome",
  ]);
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    if (!flags.has(argv[i]) || args.has(argv[i]) || i + 1 >= argv.length ||
        argv[i + 1].startsWith("--")) {
      throw new TypeError("Invalid/repeated argument: " + String(argv[i]));
    }
    args.set(argv[i], argv[++i]);
  }
  return {
    baseUrl: args.get("--base-url"), route: args.get("--route"),
    projectRoot: args.get("--project-root"),
    renderedRoot: args.get("--browser-root"), html: args.get("--html"),
    playwrightRoot: args.get("--playwright-root"),
    outRoot: args.get("--out-root"), chromePath: args.get("--chrome"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await probeNetworkResponses(parseCli(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.status !== "LOCAL_RESPONSES_MATCHED") process.exitCode = 1;
  } catch (error) {
    process.stderr.write("DWA network response probe: " + shortError(error) + "\n");
    process.exitCode = 2;
  }
}
