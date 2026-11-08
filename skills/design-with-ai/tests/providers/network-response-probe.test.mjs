import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeNetworkResponses } from "../../scripts/providers/network-response-probe.mjs";

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-network-fixture-"));
  const renderedRoot = join(root, "dist");
  const settings = join(renderedRoot, "settings");
  const pw = join(root, "node_modules", "playwright-core");
  mkdirSync(settings, { recursive: true });
  mkdirSync(pw, { recursive: true });
  const html = join(settings, "index.html");
  const css = join(settings, "site.css");
  const htmlBytes = Buffer.from("<!doctype html><title>Settings</title><link rel='stylesheet' href='site.css'>");
  const cssBytes = Buffer.from("body { color: #171717; }");
  writeFileSync(html, htmlBytes);
  writeFileSync(css, cssBytes);
  writeFileSync(join(pw, "index.mjs"), "export const chromium = {};\n");
  const input = {
    baseUrl: "http://127.0.0.1:5191",
    route: "/settings",
    projectRoot: root, renderedRoot, html,
    playwrightRoot: pw, outRoot: root,
  };
  try { return await fn({ root, html, css, htmlBytes, cssBytes, input }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function mockChrome({ input, htmlBytes, cssBytes }, {
  mutateCss = false,
  remote = false,
  omitCss = false,
  wrongCss = false,
  missing = false,
  unmappedSecretPath = null,
  failRequest = false,
  redirected = false,
  noResponses = false,
  screenshotError = false,
  bodyUnavailable = false,
  hangBody = false,
  pendingRequest = false,
  floodRequests = 0,
  floodFailedRequests = 0,
  floodPageErrors = 0,
  floodResponses = 0,
  navigateDuringDrain = false,
  lateResponsesAfterTimeout = false,
  parallelResponses = 0,
  delayedBodies = false,
  contentLength,
  laterResponseWaves = 0,
  onContextClose = null,
  popupTraffic = null,
  hangBrowserClose = false,
  hangAt = null,
} = {}) {
  const contexts = [];
  let closed = 0;
  let killed = 0;
  let bodyReads = 0;
  const factory = async () => {
    if (hangAt === "factory") return new Promise(() => {});
    return { launch: async () => {
      if (hangAt === "launch") return new Promise(() => {});
      return { newContext: async (opts) => {
        if (hangAt === "new-context") return new Promise(() => {});
        contexts.push(opts);
        const events = new Map();
        const contextEvents = new Map();
        let lateResponsesEmitted = false;
        let remainingWaves = laterResponseWaves;
        let waitCount = 0;
        const response = (resourceUrl, body, status = 200) => ({
          url: () => resourceUrl,
          status: () => status,
          headers: () => ({ "content-length": String(contentLength ?? body.length) }),
          body: async () => {
            bodyReads++;
            if (delayedBodies) await new Promise((resolve) => setTimeout(resolve, 5));
            if (bodyUnavailable) throw new Error("Body was evicted");
            if (hangBody && resourceUrl.endsWith("site.css")) {
              return new Promise(() => {}); // Headers received, body never finishes.
            }
            return body;
          },
        });
        let currentRoute = redirected ? "/login" : input.route;
        const mainFrame = {};
        const page = {
          mainFrame: () => mainFrame,
          on: (event, handler) => { events.set(event, handler); },
          goto: async () => {
            if (hangAt === "navigate") return new Promise(() => {});
            if (!noResponses) {
              const deliver = (url, body) => {
                const request = { url: () => url };
                contextEvents.get("request")?.(request);
                contextEvents.get("response")?.(response(url, body));
                contextEvents.get("requestfinished")?.(request);
              };
              deliver(input.baseUrl + input.route, htmlBytes);
              if (!omitCss) {
                deliver(
                  missing ? "http://127.0.0.1:5191/settings/not-in-manifest.css" :
                    "http://127.0.0.1:5191/settings/site.css",
                  wrongCss ? Buffer.from("tampered") : cssBytes);
              }
              if (remote) deliver(
                "https://cdn.example.test/file.js?secret-do-not-log", Buffer.from("external"));
              if (popupTraffic) {
                // The first request can precede BrowserContext's page event.
                const popupRequest = {};
                contextEvents.get("request")?.(popupRequest);
                if (popupTraffic === "pending") {
                  // No requestfinished or requestfailed: outstanding on close.
                } else {
                  if (popupTraffic === "tampered") {
                    contextEvents.get("response")?.(response(
                      "http://127.0.0.1:5191/settings/site.css", Buffer.from("tampered")));
                  } else if (popupTraffic === "external") {
                    contextEvents.get("response")?.(response(
                      "https://cdn.example.test/popup.js?token=CANARY_POPUP_SECRET_20261107",
                      Buffer.from("external")));
                  } else if (popupTraffic === "matching" || popupTraffic === "pageerror") {
                    contextEvents.get("response")?.(response(
                      "http://127.0.0.1:5191/settings/site.css", cssBytes));
                  }
                  contextEvents.get("requestfinished")?.(popupRequest);
                }
                const popupEvents = new Map();
                const popup = {
                  on: (event, handler) => { popupEvents.set(event, handler); },
                  mainFrame: () => ({}),
                };
                contextEvents.get("page")?.(popup);
                if (popupTraffic === "pageerror") {
                  popupEvents.get("pageerror")?.(
                    new Error("CANARY_POPUP_ERROR_SECRET_20261107"));
                }
              }
              if (unmappedSecretPath) deliver(
                "http://127.0.0.1:5191/" + unmappedSecretPath, Buffer.from("unknown"));
              for (let i = 0; i < parallelResponses; i++) {
                deliver("http://127.0.0.1:5191/settings/site.css", cssBytes);
              }
              for (let i = 0; i < floodResponses; i++) {
                deliver("http://127.0.0.1:5191/settings/site.css", cssBytes);
              }
              if (failRequest) {
                const request = {};
                contextEvents.get("request")?.(request);
                contextEvents.get("requestfailed")?.(request);
              }
              if (pendingRequest) contextEvents.get("request")?.({});
              for (let i = 0; i < floodRequests; i++) {
                contextEvents.get("request")?.({}); // No response: bounded tracking, fail closed.
              }
              for (let i = 0; i < floodFailedRequests; i++) {
                const request = {};
                contextEvents.get("request")?.(request);
                contextEvents.get("requestfailed")?.(request);
              }
              for (let i = 0; i < floodPageErrors; i++) {
                events.get("pageerror")?.(new Error("Repeated page failure"));
              }
            }
            if (mutateCss) writeFileSync(join(input.renderedRoot, "settings", "site.css"),
              "body { color: red; }\n");
            return { status: () => 200 };
          },
          waitForTimeout: async () => {
            if (hangAt === "settle" || (hangAt === "drain-settle" && waitCount > 0)) {
              return new Promise(() => {});
            }
            // Model post-navigation and drain passes, not literal sleep times.
            const isDrainWait = ++waitCount > 1;
            if (remainingWaves > 0) {
              const count = Math.min(3, remainingWaves);
              remainingWaves -= count;
              for (let i = 0; i < count; i++) {
                const req = {};
                contextEvents.get("request")?.(req);
                contextEvents.get("response")?.(response(
                  "http://127.0.0.1:5191/settings/site.css", cssBytes));
                contextEvents.get("requestfinished")?.(req);
              }
            }
            if (navigateDuringDrain && isDrainWait) currentRoute = "/settings/other.html";
            if (lateResponsesAfterTimeout && isDrainWait && !lateResponsesEmitted) {
              lateResponsesEmitted = true;
              for (let i = 0; i < 5; i++) {
                const request = {};
                contextEvents.get("request")?.(request);
                contextEvents.get("response")?.(response(
                  "http://127.0.0.1:5191/settings/site.css", cssBytes));
                contextEvents.get("requestfinished")?.(request);
              }
            }
          },
          screenshot: async ({ path }) => {
            if (hangAt === "screenshot") return new Promise(() => {});
            if (screenshotError) throw new Error(
              typeof screenshotError === "string" ? screenshotError : "Screenshot unavailable");
            writeFileSync(path, "image");
          },
          url: () => "http://127.0.0.1:5191" + currentRoute,
        };
        return {
          on: (event, handler) => { contextEvents.set(event, handler); },
          newPage: async () => {
            if (hangAt === "new-page") return new Promise(() => {});
            contextEvents.get("page")?.(page);
            return page;
          },
          close: async () => {
            if (onContextClose === "hang") return new Promise(() => {});
            if (onContextClose === "requestfailed") {
              const request = {};
              contextEvents.get("request")?.(request);
              contextEvents.get("requestfailed")?.(request);
            } else if (onContextClose === "request") {
              // No response or failure event: this must remain outstanding.
              contextEvents.get("request")?.({});
            } else if (onContextClose === "navigation") {
              currentRoute = "/token/CANARY_CLOSE_NAV_SECRET_20261107";
              events.get("framenavigated")?.(mainFrame);
            } else if (onContextClose === "unmapped") {
              contextEvents.get("response")?.(response(
                "http://127.0.0.1:5191/token/CANARY_CLOSE_PATH_20261107",
                Buffer.from("unknown")));
            } else if (onContextClose === "pageerror") {
              events.get("pageerror")?.(new Error("CANARY_CLOSE_ERROR_20261107"));
            }
            closed++;
            if (onContextClose === "throw") {
              throw new Error("CANARY_CLOSE_FAILURE_20261107");
            }
          },
        };
      },
      close: async () => {
        if (hangBrowserClose) return new Promise(() => {});
        closed++;
      },
      process: () => ({ kill: () => { killed++; } }),
      };
    } };
  };
  return {
    factory, contexts, getClosed: () => closed, getKilled: () => killed,
    getBodyReads: () => bodyReads,
  };
}


test("never-settling browser stages persist network INCOMPLETE receipts without advancing viewports", async () => {
  await fixture(async (f) => {
    for (const hangAt of ["factory", "launch", "new-context", "new-page",
      "navigate", "settle", "screenshot", "drain-settle"]) {
      const fake = mockChrome(f, { hangAt });
      const report = await probeNetworkResponses(f.input, {
        browserFactory: fake.factory, stageTimeoutMs: 20, shutdownTimeoutMs: 20,
      });
      assert.equal(report.status, "INCOMPLETE", hangAt);
      assert.equal(report.productCompletionEligible, false, hangAt);
      if (hangAt === "factory" || hangAt === "launch") {
        assert.equal(report.observations.length, 0, hangAt);
        assert.equal(report.browserStageTimeout, hangAt);
      } else {
        assert.equal(report.observations.length, 1, hangAt);
        assert.equal(report.observations[0].status, "INCOMPLETE", hangAt);
        assert.equal(report.observations[0].browserStageTimeout, hangAt);
        assert.ok(report.observations[0].issues.includes("BROWSER_STAGE_TIMEOUT"), hangAt);
        assert.equal(fake.getKilled(), 1, hangAt);
      }
      const saved = JSON.parse(readFileSync(
        join(report.artifactDirectory, "network-report.json"), "utf8"));
      assert.equal(saved.status, "INCOMPLETE");
      assert.equal(saved.productCompletionEligible, false);
      assert.equal(saved.observations.length, report.observations.length);
    }
  });
});

test("symlinked network CLI validates arguments and persists an INCOMPLETE receipt", async () => {
  await fixture(async (f) => {
    const script = fileURLToPath(new URL(
      "../../scripts/providers/network-response-probe.mjs", import.meta.url));
    const linkedDir = join(f.root, "linked-network-providers");
    symlinkSync(dirname(script), linkedDir, process.platform === "win32" ? "junction" : "dir");
    const linked = join(linkedDir, "network-response-probe.mjs");
    const invalid = spawnSync(process.execPath, [linked, "--unrecognized-option"],
      { encoding: "utf8", timeout: 15_000 });
    assert.equal(invalid.status, 2, invalid.stderr);
    assert.match(invalid.stderr, /Invalid or repeated CLI argument/);
    assert.ok(!invalid.stderr.includes("unrecognized-option"));
    assert.equal(invalid.stdout, "");

    // The fixture intentionally provides a trusted-looking but nonfunctional
    // Playwright stub. The entrypoint must still validate and save a bounded,
    // fail-closed runtime report, rather than silently returning process exit 0.
    const valid = spawnSync(process.execPath, [
      linked,
      "--base-url", f.input.baseUrl, "--route", f.input.route,
      "--project-root", f.input.projectRoot,
      "--browser-root", f.input.renderedRoot, "--html", f.input.html,
      "--playwright-root", f.input.playwrightRoot, "--out-root", f.input.outRoot,
    ], { encoding: "utf8", timeout: 15_000 });
    assert.equal(valid.status, 1, valid.stderr);
    const report = JSON.parse(valid.stdout);
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(report.productCompletionEligible, false);
    assert.equal(report.authenticatedSessionVerified, false);
    assert.equal(report.error, "Browser error: <details-redacted>");
    const saved = JSON.parse(readFileSync(
      join(report.artifactDirectory, "network-report.json"), "utf8"));
    assert.equal(saved.status, "INCOMPLETE");
    assert.equal(saved.productCompletionEligible, false);
  });
});

test("hung browser shutdown is bounded and persists an INCOMPLETE receipt", async () => {
  await fixture(async (f) => {
    const contextHang = mockChrome(f, { onContextClose: "hang" });
    const first = await probeNetworkResponses(f.input, {
      browserFactory: contextHang.factory, shutdownTimeoutMs: 20,
    });
    assert.equal(first.status, "INCOMPLETE");
    assert.equal(first.observations.length, 1,
      "a failed context close must stop later viewport captures");
    assert.ok(first.observations[0].issues.includes("BROWSER_CONTEXT_CLOSE_TIMEOUT"));
    assert.equal(first.observations[0].status, "INCOMPLETE");
    assert.equal(contextHang.getKilled(), 1, "kill the hung browser transport");
    assert.equal(JSON.parse(readFileSync(
      join(first.artifactDirectory, "network-report.json"), "utf8")).status, "INCOMPLETE");

    const browserHang = mockChrome(f, { hangBrowserClose: true });
    const second = await probeNetworkResponses(f.input, {
      browserFactory: browserHang.factory, shutdownTimeoutMs: 20,
    });
    assert.equal(second.observations.length, 3);
    assert.ok(second.observations.every((o) => o.status === "LOCAL_BODY_BYTES_MATCHED"));
    assert.equal(second.browserShutdownIssue, "BROWSER_CLOSE_TIMEOUT");
    assert.equal(second.status, "INCOMPLETE",
      "all matched responses cannot override a failed browser shutdown");
    assert.equal(browserHang.getKilled(), 1);
    const persisted = JSON.parse(readFileSync(
      join(second.artifactDirectory, "network-report.json"), "utf8"));
    assert.equal(persisted.browserShutdownIssue, "BROWSER_CLOSE_TIMEOUT");
    assert.equal(persisted.status, "INCOMPLETE");
  });
});

test("popup traffic is context-scoped and never certifies main-page screenshot", async () => {
  await fixture(async (f) => {
    const scenarios = [
      ["matching", "BROWSER_POPUP_OPENED"],
      ["tampered", "LOCAL_RESPONSE_BODY_MISMATCH"],
      ["external", "BROWSER_POPUP_OPENED"],
      ["pending", "BROWSER_REQUESTS_STILL_PENDING"],
      ["pageerror", "BROWSER_PAGE_ERRORS"],
    ];
    for (const [popupTraffic, issue] of scenarios) {
      const report = await probeNetworkResponses(f.input, {
        browserFactory: mockChrome(f, { popupTraffic }).factory,
      });
      assert.equal(report.status, "INCOMPLETE", popupTraffic);
      assert.equal(report.productCompletionEligible, false);
      assert.ok(report.observations.every((obs) =>
        obs.issues.includes(issue) && obs.issues.includes("BROWSER_POPUP_OPENED")),
      "Popup must invalidate the screenshot and report its own traffic: " + popupTraffic);
      if (popupTraffic === "tampered") {
        assert.ok(report.observations.every((obs) =>
          obs.local.some((row) => row.bodyVerified === false &&
            row.path?.endsWith("/site.css"))));
      }
      if (popupTraffic === "external") {
        assert.ok(report.observations.every((obs) =>
          obs.external.length === 1 && obs.external[0].bodyVerified === false));
      }
      if (popupTraffic === "pending") {
        assert.ok(report.observations.every((obs) =>
          obs.outstandingRequestCount === 1));
      }
      if (popupTraffic === "pageerror") {
        assert.ok(report.observations.every((obs) =>
          obs.pageErrorCount === 1));
      }
      const evidence = readFileSync(
        join(report.artifactDirectory, "network-report.json"), "utf8");
      assert.ok(!evidence.includes("CANARY_POPUP_SECRET_20261107"));
      assert.ok(!evidence.includes("CANARY_POPUP_ERROR_SECRET_20261107"));
    }
  });
});

test("close-time events cannot leave a stale successful observation", async () => {
  await fixture(async (f) => {
    for (const [onContextClose, issue] of [
      ["requestfailed", "BROWSER_REQUEST_FAILED"],
      ["request", "BROWSER_REQUEST_AFTER_DRAIN"],
      ["navigation", "BROWSER_LATE_MAIN_FRAME_NAVIGATION"],
      ["unmapped", "UNMAPPED_LOCAL_RESPONSE"],
      ["pageerror", "BROWSER_PAGE_ERRORS"],
      ["throw", "BROWSER_CONTEXT_CLOSE_FAILURE"],
    ]) {
      const report = await probeNetworkResponses(f.input, {
        browserFactory: mockChrome(f, { onContextClose }).factory,
      });
      assert.equal(report.status, "INCOMPLETE", onContextClose);
      assert.equal(report.productCompletionEligible, false);
      assert.ok(report.observations.every((obs) =>
        obs.status === "INCOMPLETE" && obs.issues.includes(issue)),
      "A close-time event must invalidate the viewport: " + onContextClose);
      if (onContextClose === "pageerror") {
        assert.ok(report.observations.every((obs) => obs.pageErrorCount === 1));
      }
      if (onContextClose === "request") {
        assert.ok(report.observations.every((obs) =>
          obs.outstandingRequestCount === 1 &&
          obs.issues.includes("BROWSER_REQUESTS_STILL_PENDING")));
      }
      if (onContextClose === "navigation") {
        assert.ok(report.observations.every((obs) =>
          obs.finalUrlMatched === true &&
          obs.issues.includes("BROWSER_LATE_MAIN_FRAME_NAVIGATION")));
      }
      const persisted = readFileSync(
        join(report.artifactDirectory, "network-report.json"), "utf8");
      assert.ok(!persisted.includes("CANARY_CLOSE_"),
        "Untrusted late event details must not leak");
    }
  });
});

test("CLI distinguishes fixed input validation from untrusted browser errors", async () => {
  await fixture(async (f) => {
    const script = fileURLToPath(new URL(
      "../../scripts/providers/network-response-probe.mjs", import.meta.url));
    const args = [
      "--base-url", "https://example.com",
      "--route", "/settings",
      "--project-root", f.input.projectRoot,
      "--browser-root", f.input.renderedRoot,
      "--html", f.input.html,
      "--playwright-root", f.input.playwrightRoot,
      "--out-root", f.input.outRoot,
    ];
    const invalidOrigin = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.equal(invalidOrigin.status, 2);
    assert.match(invalidOrigin.stderr, /Only a clean loopback HTTP origin is allowed/);
    assert.ok(!invalidOrigin.stderr.includes("Browser error:"));
    const invalidFlag = spawnSync(process.execPath,
      [script, "--token=CANARY_CLI_FLAG_20261107"], { encoding: "utf8" });
    assert.equal(invalidFlag.status, 2);
    assert.match(invalidFlag.stderr, /Invalid or repeated CLI argument/);
    assert.ok(!invalidFlag.stderr.includes("CANARY_CLI_FLAG_20261107"));
    const badURL = spawnSync(process.execPath,
      [script, ...args.map((arg) => arg === "https://example.com" ? "not a URL" : arg)],
      { encoding: "utf8" });
    assert.equal(badURL.status, 2);
    assert.match(badURL.stderr, /Invalid base URL/);
  });
});

test("nested index trailing-slash route matches only when explicitly declared", async () => {
  await fixture(async (f) => {
    const declared = { ...f.input, route: "/settings/" };
    const ok = await probeNetworkResponses(declared, {
      browserFactory: mockChrome({ ...f, input: declared }).factory,
    });
    assert.equal(ok.status, "LOCAL_RESPONSES_MATCHED", JSON.stringify(ok));
    assert.equal(ok.productCompletionEligible, false);
    assert.deepEqual(ok.observations.map((o) => o.width), [1440, 768, 390]);
    assert.ok(ok.observations.every((o) =>
      o.finalUrlMatched === true && o.local.length === 2 &&
      o.local.every((entry) => entry.bodyVerified === true &&
        ["dist/settings/index.html", "dist/settings/site.css"].includes(entry.path))));
    for (const route of ["/settings//", "/settings/other/", "/settings/%2f",
      "/settings/%2e", "//settings/"]) {
      await assert.rejects(
        () => probeNetworkResponses({ ...f.input, route }),
        /unambiguous absolute local path|HTML does not map to the declared isolated build route/,
        route);
    }
    const redirected = await probeNetworkResponses(declared, {
      browserFactory: mockChrome({ ...f, input: declared },
        { redirected: true }).factory,
    });
    assert.equal(redirected.status, "INCOMPLETE",
      "a declared trailing-slash route cannot certify a different destination");
    assert.ok(redirected.observations.every((o) => o.finalUrlMatched === false));
  });
});

test("percent-encoded static HTML routes bind the same decoded document bytes", async () => {
  await fixture(async (f) => {
    const html = join(f.input.renderedRoot, "settings", "my page.html");
    writeFileSync(html, f.htmlBytes);
    const route = "/settings/my%20page";
    const input = { ...f.input, html, route };
    const normal = await probeNetworkResponses(input, {
      browserFactory: mockChrome({ ...f, input }).factory,
    });
    assert.equal(normal.status, "LOCAL_RESPONSES_MATCHED", JSON.stringify(normal));
    assert.equal(normal.productCompletionEligible, false);
    assert.deepEqual(normal.observations.map((o) => o.width), [1440, 768, 390]);
    assert.ok(normal.observations.every((o) =>
      o.finalUrlMatched === true &&
      o.local.some((entry) =>
        entry.path === "dist/settings/my page.html" && entry.bodyVerified === true) &&
      o.local.some((entry) =>
        entry.path === "dist/settings/site.css" && entry.bodyVerified === true)),
    "encoded route must map back to exact received local HTML and CSS bytes");
    for (const bad of ["/settings/my page", "/settings/my%2520page",
      "/settings/my%2fpage", "/settings/my%2epage",
      "/settings/my%20page/", "/settings/my%zzpage"]) {
      await assert.rejects(
        () => probeNetworkResponses({ ...input, route: bad }),
        /unambiguous absolute local path|HTML does not map to the declared isolated build route/,
        bad);
    }
    const misdirected = await probeNetworkResponses(input, {
      browserFactory: mockChrome({ ...f, input }, { redirected: true }).factory,
    });
    assert.equal(misdirected.status, "INCOMPLETE");
    assert.ok(misdirected.observations.every((o) => o.finalUrlMatched === false));
  });
});

test("Linux literal backslash in rendered directory retains distinct manifest asset keys",
  { skip: process.platform === "win32" ? "backslash is a Windows separator" : false },
  async () => {
    await fixture(async (f) => {
      const renderedRoot = join(f.root, "dist\\fixture");
      const nested = join(renderedRoot, "settings");
      mkdirSync(nested, { recursive: true });
      const html = join(nested, "index.html");
      writeFileSync(html, f.htmlBytes);
      writeFileSync(join(nested, "site.css"), f.cssBytes);
      const input = { ...f.input, renderedRoot, html };
      const expected = ["dist\\fixture/settings/index.html",
        "dist\\fixture/settings/site.css"];
      const normal = await probeNetworkResponses(input, {
        browserFactory: mockChrome({ ...f, input }).factory,
      });
      assert.equal(normal.status, "LOCAL_RESPONSES_MATCHED", JSON.stringify(normal));
      assert.equal(normal.expectedLocalFileCount, 2);
      assert.ok(normal.observations.every((o) => {
        const received = o.local.map((entry) => entry.path).sort();
        return o.status === "LOCAL_BODY_BYTES_MATCHED" &&
          received.length === 2 &&
          received.every((path, i) => path === expected.slice().sort()[i]) &&
          o.local.every((entry) => entry.bodyVerified);
      }), "manifest keys with literal Linux backslashes must match response mappings");
      const tampered = await probeNetworkResponses(input, {
        browserFactory: mockChrome({ ...f, input },
          { wrongCss: true }).factory,
      });
      assert.equal(tampered.status, "INCOMPLETE");
      assert.ok(tampered.observations.every((o) =>
        o.issues.includes("LOCAL_RESPONSE_BODY_MISMATCH")));
    });
  });

test("actual response body hashes match a local two-file manifest across three widths", async () => {
  await fixture(async (f) => {
    const chrome = mockChrome(f);
    const report = await probeNetworkResponses(f.input, { browserFactory: chrome.factory });
    assert.equal(report.status, "LOCAL_RESPONSES_MATCHED", JSON.stringify(report));
    assert.equal(report.expectedLocalFileCount, 2);
    assert.equal(report.observations.length, 3);
    assert.deepEqual(report.observations.map((o) => o.width), [1440, 768, 390]);
    assert.ok(report.observations.every((o) =>
      o.status === "LOCAL_BODY_BYTES_MATCHED" && o.local.length === 2 &&
      o.local.every((file) => file.bodyVerified === true) && o.issues.length === 0 &&
      o.outstandingRequestCount === 0 &&
      o.maxBodyQueueDepth === 0 &&
      /^[a-f0-9]{64}$/.test(o.screenshotSha256)),
    "Immediately started body reads must not be counted as waiting in the queue");
    assert.equal(report.localAssetTreeUnchanged, true);
    assert.equal(report.tasteFramesVerified, false);
    assert.equal(report.productCompletionEligible, false);
    assert.equal(chrome.contexts.length, 3);
    assert.equal(chrome.getClosed(), 4);
    assert.ok(chrome.contexts.every((c) =>
      c.serviceWorkers === "block" && c.storageState.cookies.length === 0));
    assert.equal(JSON.parse(readFileSync(
      join(report.artifactDirectory, "network-report.json"), "utf8")).status,
      "LOCAL_RESPONSES_MATCHED");
  });
});


test("unmapped same-origin URL paths are hashed without leaking path credentials", async () => {
  await fixture(async (f) => {
    const canary = "CANARY_PATH_SECRET_20261107";
    const report = await probeNetworkResponses(f.input, {
      browserFactory: mockChrome(f, {
        unmappedSecretPath: "sessions/" + canary + "/callback",
      }).factory,
    });
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(report.productCompletionEligible, false);
    for (const observation of report.observations) {
      assert.ok(observation.issues.includes("UNMAPPED_LOCAL_RESPONSE"));
      const unknown = observation.local.filter((r) => r.expectedSha256 === null);
      assert.equal(unknown.length, 1);
      assert.equal(unknown[0].path, undefined);
      assert.match(unknown[0].pathSha256, /^[a-f0-9]{64}$/);
      assert.equal(unknown[0].bodyVerified, false);
    }
    const evidence = readFileSync(join(report.artifactDirectory, "network-report.json"), "utf8");
    assert.ok(!evidence.includes(canary), "Unmapped URL path credential must never be saved");
    assert.ok(!evidence.includes("/sessions/"));
  });
});

test("corrupt CSS bytes, unknown file, lost response and screenshot failures never PASS", async () => {
  await fixture(async (f) => {
    const scenarios = [
      { wrongCss: true }, { missing: true }, { noResponses: true },
      { screenshotError: true }, { failRequest: true },
      { redirected: true }, { bodyUnavailable: true },
    ];
    for (const scenario of scenarios) {
      const result = await probeNetworkResponses(f.input, {
        browserFactory: mockChrome(f, scenario).factory,
      });
      assert.equal(result.status, "INCOMPLETE", JSON.stringify(scenario));
      assert.equal(result.productCompletionEligible, false);
      assert.equal(result.tasteFramesVerified, false);
    }
  });
});


test("a response body that never finishes has a bounded timeout and fails closed", async () => {
  await fixture(async (f) => {
    const report = await probeNetworkResponses(f.input, {
      browserFactory: mockChrome(f, { hangBody: true }).factory,
      bodyReadTimeoutMs: 20,
    });
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(report.observations.length, 3);
    assert.ok(report.observations.every((o) =>
      o.status === "INCOMPLETE" &&
      o.issues.includes("LOCAL_RESPONSE_BODY_UNAVAILABLE") &&
      o.local.some((x) => x.path.endsWith("/site.css") && !x.bodyVerified)),
    "An unresolved response body cannot block a verdict or count as verified");
    assert.equal(report.productCompletionEligible, false);
  });
});

test("browser failures retain a per-viewport issue rather than escaping catch scope", async () => {
  await fixture(async (f) => {
    const report = await probeNetworkResponses(f.input, {
      browserFactory: mockChrome(f, { screenshotError: true }).factory,
    });
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(report.observations.length, 3);
    assert.ok(report.observations.every((o) =>
      o.issues.some((issue) => issue.includes("BROWSER_PROBE_FAILURE: Browser error: <details-redacted>"))),
    "Failure details must remain attached to each affected observation");
    assert.equal(report.error, undefined);
  });
});

test("a started but unfinished browser request prevents a false local-body PASS", async () => {
  await fixture(async (f) => {
    const report = await probeNetworkResponses(f.input, {
      browserFactory: mockChrome(f, { pendingRequest: true }).factory,
    });
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(report.observations.length, 3);
    assert.ok(report.observations.every((o) =>
      o.httpStatus === 200 && o.local.every((x) => x.bodyVerified) &&
      o.outstandingRequestCount === 1 &&
      o.issues.includes("BROWSER_REQUESTS_STILL_PENDING")),
    "A pending request is not a verified response, even if earlier bodies matched");
    assert.equal(report.productCompletionEligible, false);
    assert.equal(report.tasteFramesVerified, false);
  });
});

test("request and error floods remain bounded and cannot yield a false PASS", async () => {
  await fixture(async (f) => {
    const report = await probeNetworkResponses(f.input, {
      browserFactory: mockChrome(f, {
        floodRequests: 2_500, floodFailedRequests: 2_500, floodPageErrors: 2_500,
      }).factory,
    });
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(report.observations.length, 3);
    assert.ok(report.observations.every((o) =>
      o.status === "INCOMPLETE" &&
      o.issues.includes("REQUEST_COUNT_LIMIT") &&
      o.issues.includes("BROWSER_REQUEST_FAILED") &&
      o.issues.includes("BROWSER_PAGE_ERRORS") &&
      o.pageErrorCount === 2_500 &&
      o.outstandingRequestCount <= 2_000 &&
      o.issues.length <= 5),
    "Repeated events must not grow request retention or diagnostic arrays without bound");
    assert.equal(report.productCompletionEligible, false);
  });
});

test("timed-out body reads retain their slot and reject a later response wave", async () => {
  await fixture(async (f) => {
    const chrome = mockChrome(f, {
      hangBody: true, lateResponsesAfterTimeout: true,
    });
    const report = await probeNetworkResponses(f.input, {
      browserFactory: chrome.factory, bodyReadTimeoutMs: 20,
    });
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(chrome.getBodyReads(), 2 * 3,
      "The later wave must not start body reads while the first CSS body remains pending");
    assert.ok(report.observations.every((o) =>
      o.bodyReadsStarted === 2 &&
      o.issues.includes("LOCAL_RESPONSE_BODY_UNAVAILABLE") &&
      o.issues.includes("LOCAL_RESPONSE_CONCURRENT_LIMIT")),
    "An unresolved timed-out body must hold its slot and prevent further reads");
  });
});

test("six simultaneous mapped response bodies are queued and all verified", async () => {
  await fixture(async (f) => {
    const chrome = mockChrome(f, { parallelResponses: 6, delayedBodies: true });
    const report = await probeNetworkResponses(f.input, { browserFactory: chrome.factory });
    assert.equal(report.status, "LOCAL_RESPONSES_MATCHED", JSON.stringify(report));
    assert.ok(report.observations.every((o) =>
      o.local.length === 8 && o.local.every((row) => row.bodyVerified) &&
      o.bodyReadsStarted === 8 && o.maxBodyQueueDepth >= 2 &&
      o.issues.length === 0));
    assert.equal(chrome.getBodyReads(), 8 * 3);
  });
});

test("oversized Content-Length rejects response before reading its body", async () => {
  await fixture(async (f) => {
    const chrome = mockChrome(f, { contentLength: 16 * 1024 * 1024 + 1 });
    const report = await probeNetworkResponses(f.input, { browserFactory: chrome.factory });
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(chrome.getBodyReads(), 0);
    assert.ok(report.observations.every((o) =>
      o.bodyReadsStarted === 0 && o.issues.includes("LOCAL_RESPONSE_TOO_LARGE")));
  });
});

test("128 MiB cumulative reservation is enforced across response waves", async () => {
  await fixture(async (f) => {
    const chrome = mockChrome(f, {
      contentLength: 15 * 1024 * 1024, laterResponseWaves: 7,
    });
    const report = await probeNetworkResponses(f.input, { browserFactory: chrome.factory });
    assert.equal(report.status, "INCOMPLETE");
    assert.ok(report.observations.every((o) =>
      o.issues.includes("LOCAL_RESPONSE_BODY_LIMIT") &&
      o.local.length === 9 && o.bodyReadsStarted === 8 &&
      o.local.filter((row) => row.bodyVerified).length === 8),
    "Nine 15-MiB reservations exceed the 128-MiB budget, despite tiny actual bodies");
    assert.equal(chrome.getBodyReads(), 8 * 3,
      "The ninth response must be rejected before calling body()");
  });
});

test("response flood preserves bounded rows and body reads", async () => {
  await fixture(async (f) => {
    const chrome = mockChrome(f, { floodResponses: 2_500 });
    const report = await probeNetworkResponses(f.input, { browserFactory: chrome.factory });
    assert.equal(report.status, "INCOMPLETE");
    assert.ok(report.observations.every((o) =>
      o.issues.includes("RESPONSE_COUNT_LIMIT") &&
      o.issues.includes("LOCAL_RESPONSE_QUEUE_LIMIT") &&
      o.local.length === 2_000 &&
      o.bodyReadsStarted <= 4 + 64 &&
      o.maxBodyQueueDepth <= 64),
    "Response overflow retains only 2,000 rows and a bounded 64-item read queue");
    assert.ok(chrome.getBodyReads() <= 3 * (4 + 64),
      "Response flood cannot launch more than the bounded active and queued reads");
  });
});

test("navigation during the body drain invalidates an earlier screenshot URL match", async () => {
  await fixture(async (f) => {
    const report = await probeNetworkResponses(f.input, {
      browserFactory: mockChrome(f, { navigateDuringDrain: true }).factory,
    });
    assert.equal(report.status, "INCOMPLETE");
    assert.ok(report.observations.every((o) =>
      o.httpStatus === 200 && o.finalUrlMatched === false &&
      o.local.every((row) => row.bodyVerified)),
    "All matching network evidence still cannot certify a changed final route");
  });
});

test("remote URL credentials and query never enter report; external stays unverified", async () => {
  await fixture(async (f) => {
    const result = await probeNetworkResponses(f.input, {
      browserFactory: mockChrome(f, { remote: true }).factory,
    });
    assert.equal(result.status, "LOCAL_MATCHED_EXTERNAL_UNVERIFIED");
    assert.ok(result.observations.every((o) =>
      o.external.length === 1 && o.external[0].bodyVerified === false));
    const json = JSON.stringify(result);
    assert.ok(!json.includes("cdn.example.test"));
    assert.ok(!json.includes("secret-do-not-log"));
  });
});

test("browser failure evidence redacts full WebSocket URLs and quote-split query tokens", async () => {
  await fixture(async (f) => {
    const secrets = ["wss-bearer-secret-abc", "split-query-secret-xyz"];
    for (const errorMessage of [
      "Page screenshot failed for 'wss://api.example.test/live?token=" + secrets[0] + "'",
      "Page screenshot failed for https://api.example.test/?mode=ready'&token=" + secrets[1],
    ]) {
      const report = await probeNetworkResponses(f.input, {
        browserFactory: mockChrome(f, { screenshotError: errorMessage }).factory,
      });
      assert.equal(report.status, "INCOMPLETE");
      assert.equal(report.productCompletionEligible, false);
      assert.ok(report.observations.every((o) =>
        o.issues.includes("BROWSER_PROBE_FAILURE: Browser error: <url-redacted>")));
      const evidence = readFileSync(join(report.artifactDirectory, "network-report.json"), "utf8");
      for (const secret of secrets) assert.ok(!evidence.includes(secret));
      assert.ok(!evidence.includes("wss://api.example.test"));
    }
  });
});


test("relative URLs and bare credentials never persist in browser failure evidence", async () => {
  await fixture(async (f) => {
    const messages = [
      "Failed request /api/auth?access_token=CANARY_RELATIVE_907",
      "Blocked //internal.example/api?token=CANARY_PROTOCOL_907",
      "Browser failed token=CANARY_BARE_907",
      "Authorization: Bearer CANARY_HEADER_907",
      "Cookie: session=CANARY_COOKIE_907",
    ];
    for (const message of messages) {
      const report = await probeNetworkResponses(f.input, {
        browserFactory: mockChrome(f, { screenshotError: message }).factory,
      });
      assert.equal(report.status, "INCOMPLETE");
      assert.equal(report.productCompletionEligible, false);
      assert.ok(report.observations.every((o) =>
        o.issues.includes("BROWSER_PROBE_FAILURE: Browser error: <details-redacted>")));
      const persisted = readFileSync(join(report.artifactDirectory, "network-report.json"), "utf8");
      assert.ok(!persisted.includes("CANARY_"), "Untrusted error text must not persist");
      assert.ok(!persisted.includes(message));
    }
    const thrown = await probeNetworkResponses(f.input, {
      browserFactory: async () => {
        throw new Error("Launch failed token=CANARY_STARTUP_907");
      },
    });
    assert.equal(thrown.status, "INCOMPLETE");
    assert.equal(thrown.error, "Browser error: <details-redacted>");
    const persisted = readFileSync(join(thrown.artifactDirectory, "network-report.json"), "utf8");
    assert.ok(!persisted.includes("CANARY_STARTUP_907"));
  });
});

test("a file mutation during probe invalidates snapshot even when response bodies match", async () => {
  await fixture(async (f) => {
    const result = await probeNetworkResponses(f.input, {
      browserFactory: mockChrome(f, { mutateCss: true }).factory,
    });
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(result.localAssetTreeUnchanged, false);
  });
});

test("remote origins, bad routes, missing trusted Playwright and non-isolated builds are rejected", async () => {
  await fixture(async (f) => {
    for (const [changes, reason] of [
      [{ baseUrl: "https://example.com" }, /Only a clean loopback HTTP origin is allowed/],
      [{ baseUrl: "http://user:pass@127.0.0.1:5191/" }, /Only a clean loopback HTTP origin is allowed/],
      [{ baseUrl: "http://127.0.0.1:5191/private" }, /Only a clean loopback HTTP origin is allowed/],
      [{ route: "//cdn.example.test" }, /Route must be an unambiguous absolute local path/],
      [{ route: "/%2e%2e/foo" }, /Route must be an unambiguous absolute local path/],
      [{ route: "/other" }, /HTML does not map to the declared isolated build route/],
      [{ playwrightRoot: join(f.root, "not-installed") }, /Roots, HTML and Playwright must exist/],
      [{ renderedRoot: f.root }, /HTML does not map to the declared isolated build route/],
      [{ outRoot: f.input.renderedRoot }, /Evidence output root must be outside/],
    ]) {
      await assert.rejects(() => probeNetworkResponses({
        ...f.input, ...changes,
      }), reason, JSON.stringify(changes));
    }
  });
});

test("unavailable Chrome does not claim matched network bodies", async () => {
  await fixture(async (f) => {
    const r = await probeNetworkResponses(f.input, {
      browserFactory: async () => { throw new Error("Browser missing"); },
    });
    assert.equal(r.status, "INCOMPLETE");
    assert.equal(r.error, "Browser error: <details-redacted>");
    assert.equal(r.observations.length, 0);
    assert.equal(r.localAssetTreeUnchanged, true);
  });
});
