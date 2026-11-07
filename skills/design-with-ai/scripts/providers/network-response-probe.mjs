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
  basename, dirname, isAbsolute, join, relative, resolve, sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderedAssetProof } from "./rendered-assets.mjs";
import { staticRouteForHtml } from "./scope-proof.mjs";

const WIDTHS = Object.freeze([1440, 768, 390]);
const MAX_RESPONSES = 2_000;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 128 * 1024 * 1024;
const MAX_IN_FLIGHT_BODY_READS = 4;
const MAX_QUEUED_BODY_READS = 64;
const MAX_BODY_WAIT_MS = 15_000;
const MAX_SHUTDOWN_WAIT_MS = 15_000;
const MAX_STAGE_WAIT_MS = 50_000;
const STAGE_TIMEOUT_PREFIX = "Browser stage timeout: ";
async function boundedStage(call, timeoutMs, name) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(STAGE_TIMEOUT_PREFIX + name)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
// Never await Playwright transport shutdown indefinitely. Its connection may
// stall after a timed-out body read, and the INCOMPLETE report must be written.
async function boundedShutdown(close, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(close).then(
        () => ({ ok: true }), () => ({ ok: false, timedOut: false })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function terminateBrowser(browser) {
  try { browser?.process?.()?.kill?.("SIGKILL"); }
  catch { /* Transport may already have exited; never leak process errors. */ }
}
const sha = (value) => createHash("sha256").update(value).digest("hex");
const inside = (root, value) => {
  const rel = relative(root, value);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};
// Browser errors may contain secret-bearing relative paths, query fragments or
// raw tokens with no URL scheme. Only fixed labels may enter saved evidence.
const ERROR_URL_SCHEME = /\b(?:[a-z][a-z0-9+.-]*:\/\/|data:|blob:|file:|javascript:)/i;
const shortError = (error) => {
  const message = String(error?.message ?? error);
  return ERROR_URL_SCHEME.test(message)
    ? "Browser error: <url-redacted>" : "Browser error: <details-redacted>";
};
// Only explicitly authored validation failures may reach CLI stderr verbatim.
// Browser exceptions (including TypeErrors) remain fixed-label redacted.
class ProbeInputError extends TypeError {}
const string = (value) => typeof value === "string" && value.trim().length > 0;

function strictInputs(options) {
  if (!options || ![
    options.baseUrl, options.route, options.projectRoot,
    options.renderedRoot, options.html, options.playwrightRoot,
  ].every(string)) throw new ProbeInputError("Explicit local page, roots, route and Playwright root required");
  let base;
  try { base = new URL(options.baseUrl); }
  catch { throw new ProbeInputError("Invalid base URL; a clean loopback HTTP origin is required"); }
  if (base.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
      base.username || base.password || base.pathname !== "/" ||
      base.search || base.hash) {
    throw new ProbeInputError("Only a clean loopback HTTP origin is allowed");
  }
  const route = options.route;
  if (!/^\/[a-zA-Z0-9._~/%-]*$/.test(route) || route.startsWith("//") ||
      /%2f|%5c|%2e|%00/i.test(route) || route.split("/").includes("..")) {
    throw new ProbeInputError("Route must be an unambiguous absolute local path");
  }
  const project = resolve(options.projectRoot);
  const rendered = resolve(options.renderedRoot);
  const html = resolve(options.html);
  const playwright = resolve(options.playwrightRoot);
  for (const path of [project, rendered, html, playwright]) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) {
      throw new ProbeInputError("Roots, HTML and Playwright must exist and not be symlinks");
    }
  }
  const canonicalProject = realpathSync(project);
  const canonicalRendered = realpathSync(rendered);
  const canonicalHtml = realpathSync(html);
  const mappedRoute = staticRouteForHtml(canonicalRendered, canonicalHtml);
  // Static nested index pages can be served with a trailing slash. Require
  // the caller to declare the exact route rather than silently accepting a
  // redirect from a different page URL.
  const nestedIndexSlash = mappedRoute !== "/" &&
    /^index\.html?$/i.test(basename(canonicalHtml)) &&
    route === mappedRoute + "/";
  if (!inside(canonicalProject, canonicalRendered) ||
      !inside(canonicalRendered, canonicalHtml) ||
      canonicalRendered === canonicalProject ||
      (route !== mappedRoute && !nestedIndexSlash)) {
    throw new ProbeInputError("HTML does not map to the declared isolated build route");
  }
  if (!lstatSync(playwright).isDirectory() || !existsSync(join(playwright, "index.mjs"))) {
    throw new ProbeInputError("Use an explicitly installed and trusted Playwright package root");
  }
  const outRoot = resolve(options.outRoot ?? tmpdir());
  if (!existsSync(outRoot) || !lstatSync(outRoot).isDirectory() ||
      lstatSync(outRoot).isSymbolicLink() ||
      inside(canonicalRendered, realpathSync(outRoot))) {
    throw new ProbeInputError("Evidence output root must be outside the served build tree");
  }
  if (options.chromePath !== undefined &&
      (!string(options.chromePath) || !existsSync(resolve(options.chromePath)))) {
    throw new ProbeInputError("Explicit browser executable does not exist");
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
  if (path === context.route ||
      (!context.route.endsWith("/") && path === context.route + "/")) {
    return relative(context.project, context.html).split(sep).join("/");
  }
  const file = join(context.rendered, ...segments);
  if (!inside(context.rendered, file)) {
    throw new TypeError("Requested resource escapes built asset root");
  }
  return relative(context.project, file).split(sep).join("/");
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
export async function probeNetworkResponses(options, {
  browserFactory = loadBrowser, bodyReadTimeoutMs = MAX_BODY_WAIT_MS,
  shutdownTimeoutMs = MAX_SHUTDOWN_WAIT_MS, stageTimeoutMs = MAX_STAGE_WAIT_MS,
} = {}) {
  const context = strictInputs(options);
  const bodyDeadline = Number.isSafeInteger(bodyReadTimeoutMs) &&
    bodyReadTimeoutMs > 0 && bodyReadTimeoutMs <= MAX_BODY_WAIT_MS
    ? bodyReadTimeoutMs : MAX_BODY_WAIT_MS;
  const shutdownDeadline = Number.isSafeInteger(shutdownTimeoutMs) &&
    shutdownTimeoutMs > 0 && shutdownTimeoutMs <= MAX_SHUTDOWN_WAIT_MS
    ? shutdownTimeoutMs : MAX_SHUTDOWN_WAIT_MS;
  const stageDeadline = Number.isSafeInteger(stageTimeoutMs) &&
    stageTimeoutMs > 0 && stageTimeoutMs <= MAX_STAGE_WAIT_MS
    ? stageTimeoutMs : MAX_STAGE_WAIT_MS;
  const stage = (name, call) => boundedStage(call, stageDeadline, name);
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
    const chromium = await stage("factory", () => browserFactory(context.playwright));
    browser = await stage("launch", () => chromium.launch({
      headless: true,
      ...(context.chromePath
        ? { executablePath: context.chromePath } : { channel: "chrome" }),
      args: ["--no-first-run", "--no-default-browser-check"],
    }));
    for (const width of WIDTHS) {
      const obs = {
        width, status: "INCOMPLETE", local: [], external: [],
        issues: [], localBytesChecked: 0, screenshotSha256: null,
      };
      report.observations.push(obs);
      let ctx;
      const issueSet = new Set();
      const pending = [];
      const outstandingRequests = new Set();
      let pageErrorCount = 0;
      let finalized = false;
      let drainComplete = false;
      let shutdownFailed = false;
      const recordIssue = (issue) => {
        if (finalized) return;
        if (!issueSet.has(issue)) {
          issueSet.add(issue);
          obs.issues.push(issue);
        }
      };
      try {
        ctx = await stage("new-context", () => browser.newContext({
          viewport: { width, height: 900 },
          storageState: { cookies: [], origins: [] },
          serviceWorkers: "block",
        }));
        // BrowserContext emits network events for every page, including
        // popups whose first request may precede the Page popup event.
        // A popup is not represented in the main screenshot: fail closed.
        const observedPages = new Set();
        const observePage = (observed) => {
          if (observedPages.has(observed)) return;
          if (observedPages.size > 0) recordIssue("BROWSER_POPUP_OPENED");
          const primary = observedPages.size === 0;
          observedPages.add(observed);
          observed.on("pageerror", () => { if (!finalized) pageErrorCount++; });
          if (primary) {
            const mainFrame = observed.mainFrame();
            observed.on("framenavigated", (frame) => {
              if (drainComplete && !finalized && frame === mainFrame) {
                recordIssue("BROWSER_LATE_MAIN_FRAME_NAVIGATION");
              }
            });
          }
        };
        ctx.on("page", observePage);
        const page = await stage("new-page", () => ctx.newPage());
        observePage(page);
        const queuedBodyReads = [];
        let requestCount = 0;
        let responseCount = 0;
        let bodyReadsInFlight = 0;
        // response.body() is not cancellable. A timeout blocks all further
        // starts for this viewport, including already queued responses.
        let bodyReadTimeoutDetected = false;
        let reservedBodyBytes = 0;
        obs.bodyReadsStarted = 0;
        obs.maxBodyQueueDepth = 0;
        const startQueuedBodyReads = () => {
          if (bodyReadTimeoutDetected) {
            while (queuedBodyReads.length > 0) {
              recordIssue("LOCAL_RESPONSE_CONCURRENT_LIMIT");
              queuedBodyReads.shift().finish();
            }
            return;
          }
          while (bodyReadsInFlight < MAX_IN_FLIGHT_BODY_READS &&
              queuedBodyReads.length > 0) {
            const { response, row, finish } = queuedBodyReads.shift();
            bodyReadsInFlight++;
            obs.bodyReadsStarted++;
            const task = (async () => {
              try {
                let timer;
                let body;
                try {
                  body = await Promise.race([
                    response.body(),
                    new Promise((_, reject) => {
                      timer = setTimeout(() => reject(new Error("Response body timed out")),
                        bodyDeadline);
                    }),
                  ]);
                } finally {
                  clearTimeout(timer);
                }
                if (!Buffer.isBuffer(body) || body.length > MAX_BODY_BYTES ||
                    obs.localBytesChecked + body.length > MAX_CAPTURE_BYTES) {
                  recordIssue("LOCAL_RESPONSE_BODY_LIMIT");
                  return;
                }
                obs.localBytesChecked += body.length;
                row.receivedSha256 = sha(body);
                row.bodyVerified = row.receivedSha256 === row.expectedSha256;
                if (!row.bodyVerified) recordIssue("LOCAL_RESPONSE_BODY_MISMATCH");
              } catch (error) {
                if (error?.message === "Response body timed out") {
                  bodyReadTimeoutDetected = true;
                }
                recordIssue("LOCAL_RESPONSE_BODY_UNAVAILABLE");
              }
            })();
            // The runner catches all body errors. Resolve the per-response
            // completion promise only after its own body has been examined.
            void task.finally(() => {
              if (!bodyReadTimeoutDetected) bodyReadsInFlight--;
              finish();
              startQueuedBodyReads();
            });
          }
        };
        ctx.on("request", (request) => {
          if (finalized) return;
          if (drainComplete) recordIssue("BROWSER_REQUEST_AFTER_DRAIN");
          if (++requestCount > MAX_RESPONSES) {
            recordIssue("REQUEST_COUNT_LIMIT");
            return; // Keep Playwright request objects bounded even under a request flood.
          }
          outstandingRequests.add(request);
        });
        ctx.on("requestfinished", (request) => {
          if (!finalized) outstandingRequests.delete(request);
        });
        ctx.on("requestfailed", (request) => {
          if (finalized) return;
          outstandingRequests.delete(request);
          // Failed requests must not quietly disappear from the observed set.
          // Never store URLs or request bodies, which may contain credentials.
          recordIssue("BROWSER_REQUEST_FAILED");
        });
        ctx.on("response", (response) => {
          if (finalized) return;
          if (++responseCount > MAX_RESPONSES) {
            recordIssue("RESPONSE_COUNT_LIMIT");
            return;
          }
          const resourceUrl = response.url();
          let path;
          try { path = localAssetPath(resourceUrl, context); }
          catch { recordIssue("UNSAFE_LOCAL_RESOURCE_URL"); return; }
          if (path === null) {
            obs.external.push({
              urlSha256: sha(resourceUrl), status: response.status(),
              bodyVerified: false,
            });
            return;
          }
          // An unknown same-origin URL may embed secrets in its path.
          // Persist only a hash unless it matches a trusted build asset.
          const asset = expected.get(path);
          const row = {
            ...(asset ? { path } : { pathSha256: sha(path) }),
            status: response.status(),
            expectedSha256: asset?.sha256 ?? null,
            receivedSha256: null, bodyVerified: false,
          };
          obs.local.push(row);
          if (!asset) {
            recordIssue("UNMAPPED_LOCAL_RESPONSE");
            return;
          }
          if (response.status() !== 200) {
            recordIssue("NON_200_LOCAL_RESPONSE");
            return;
          }
          const indicatedLength = Number(response.headers?.()?.["content-length"]);
          if (Number.isFinite(indicatedLength) && indicatedLength > MAX_BODY_BYTES) {
            recordIssue("LOCAL_RESPONSE_TOO_LARGE");
            return;
          }
          // Pre-reserve known body bytes and cap the number of reads BEFORE
          // asking Playwright for any response body.
          const reservation = Math.max(asset.bytes,
            Number.isFinite(indicatedLength) && indicatedLength > 0 ? indicatedLength : 0);
          if (reservation > MAX_BODY_BYTES ||
              reservedBodyBytes + reservation > MAX_CAPTURE_BYTES) {
            recordIssue("LOCAL_RESPONSE_BODY_LIMIT");
            return;
          }
          // Enqueue a bounded number of mapped response objects. The queue
          // is processed at most four at a time; overflow fails closed,
          // rather than spuriously rejecting an ordinary six-asset burst.
          if (bodyReadTimeoutDetected) {
            recordIssue("LOCAL_RESPONSE_CONCURRENT_LIMIT");
            return;
          }
          if (queuedBodyReads.length >= MAX_QUEUED_BODY_READS) {
            recordIssue("LOCAL_RESPONSE_QUEUE_LIMIT");
            return;
          }
          reservedBodyBytes += reservation;
          let finish;
          const completed = new Promise((resolve) => { finish = resolve; });
          queuedBodyReads.push({ response, row, finish });
          pending.push(completed);
          startQueuedBodyReads();
          // Count only responses still WAITING after filling available slots.
          // An immediately started body read must not inflate queue depth.
          obs.maxBodyQueueDepth = Math.max(obs.maxBodyQueueDepth, queuedBodyReads.length);
        });
        const nav = await stage("navigate", () => page.goto(context.url, {
          waitUntil: "load", timeout: 45_000,
        }));
        obs.httpStatus = nav?.status?.() ?? null;
        await stage("settle", () => page.waitForTimeout(750));
        const screenshotFile = join(runDir, "network-" + width + ".png");
        await stage("screenshot", () => page.screenshot(
          { path: screenshotFile, fullPage: false, timeout: 20_000 }));
        obs.screenshotSha256 = sha(readFileSync(screenshotFile));
        obs.finalUrlMatched = page.url() === context.url;
        for (let round = 0; round < 3; round++) {
          const previous = pending.length;
          await stage("body-drain", () => Promise.allSettled([...pending]));
          await stage("drain-settle", () => page.waitForTimeout(100));
          if (previous === pending.length) break;
        }
        obs.finalUrlMatched = obs.finalUrlMatched && page.url() === context.url;
        // Anything that starts after this drain cannot be part of the
        // verified screenshot/session. Late requests/navigations fail closed.
        drainComplete = true;
      } catch (error) {
        recordIssue("BROWSER_PROBE_FAILURE: " + shortError(error));
        if (typeof error?.message === "string" &&
            error.message.startsWith(STAGE_TIMEOUT_PREFIX)) {
          recordIssue("BROWSER_STAGE_TIMEOUT");
          obs.browserStageTimeout = error.message.slice(STAGE_TIMEOUT_PREFIX.length);
          shutdownFailed = true;
          terminateBrowser(browser);
        }
      } finally {
        // Close before finalization to capture late events, but bound transport
        // shutdown independently: a hung close cannot prevent INCOMPLETE output.
        if (ctx) {
          const closed = await boundedShutdown(() => ctx.close(), shutdownDeadline);
          if (!closed.ok) {
            recordIssue(closed.timedOut
              ? "BROWSER_CONTEXT_CLOSE_TIMEOUT" : "BROWSER_CONTEXT_CLOSE_FAILURE");
            shutdownFailed = true;
            if (closed.timedOut) terminateBrowser(browser);
          }
        }
      }
      await Promise.allSettled([...pending]);
      // Closing the browser context can still emit requests. Inspect their
      // final outstanding set only after context-close event callbacks.
      // Never persist request URL, path or body in this receipt.
      obs.outstandingRequestCount = outstandingRequests.size;
      if (outstandingRequests.size > 0) recordIssue("BROWSER_REQUESTS_STILL_PENDING");
      obs.pageErrorCount = pageErrorCount;
      if (pageErrorCount > 0) recordIssue("BROWSER_PAGE_ERRORS");
      obs.status = obs.httpStatus === 200 && obs.finalUrlMatched === true &&
        /^[a-f0-9]{64}$/.test(obs.screenshotSha256 ?? "") &&
        obs.local.length > 0 &&
        obs.local.every((entry) => entry.bodyVerified === true) &&
        obs.issues.length === 0 ? "LOCAL_BODY_BYTES_MATCHED" : "INCOMPLETE";
      finalized = true;
      // Once a context fails to close, no later viewport on that transport
      // can be trusted. A three-width success must not be fabricated.
      if (shutdownFailed) break;
    }
  } catch (error) {
    report.error = shortError(error);
    if (typeof error?.message === "string" &&
        error.message.startsWith(STAGE_TIMEOUT_PREFIX)) {
      report.browserStageTimeout = error.message.slice(STAGE_TIMEOUT_PREFIX.length);
      terminateBrowser(browser);
    }
  } finally {
    if (browser) {
      const closed = await boundedShutdown(() => browser.close(), shutdownDeadline);
      if (!closed.ok) {
        report.browserShutdownIssue = closed.timedOut
          ? "BROWSER_CLOSE_TIMEOUT" : "BROWSER_CLOSE_FAILURE";
        if (closed.timedOut) terminateBrowser(browser);
      }
    }
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
  if (!report.browserShutdownIssue &&
      report.localAssetTreeUnchanged && report.observations.length === 3 &&
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
      throw new ProbeInputError("Invalid or repeated CLI argument");
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

// Node retains a symlinked CLI spelling in argv[1] while import.meta.url
// normally resolves to the real module. Compare canonical filesystem paths.
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isCliEntry()) {
  try {
    const report = await probeNetworkResponses(parseCli(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.status !== "LOCAL_RESPONSES_MATCHED") process.exitCode = 1;
  } catch (error) {
    const safeReason = error instanceof ProbeInputError
      ? error.message : shortError(error);
    process.stderr.write("DWA network response probe: " + safeReason + "\n");
    process.exitCode = 2;
  }
}
