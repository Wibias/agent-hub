import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
} = {}) {
  const contexts = [];
  let closed = 0;
  let bodyReads = 0;
  const factory = async () => ({
    launch: async () => ({
      newContext: async (opts) => {
        contexts.push(opts);
        const events = new Map();
        let lateResponsesEmitted = false;
        let remainingWaves = laterResponseWaves;
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
        let currentRoute = redirected ? "/login" : "/settings";
        const page = {
          on: (event, handler) => { events.set(event, handler); },
          goto: async () => {
            if (!noResponses) {
              const deliver = (url, body) => {
                const request = { url: () => url };
                events.get("request")?.(request);
                events.get("response")?.(response(url, body));
                events.get("requestfinished")?.(request);
              };
              deliver("http://127.0.0.1:5191/settings", htmlBytes);
              if (!omitCss) {
                deliver(
                  missing ? "http://127.0.0.1:5191/settings/not-in-manifest.css" :
                    "http://127.0.0.1:5191/settings/site.css",
                  wrongCss ? Buffer.from("tampered") : cssBytes);
              }
              if (remote) deliver(
                "https://cdn.example.test/file.js?secret-do-not-log", Buffer.from("external"));
              for (let i = 0; i < parallelResponses; i++) {
                deliver("http://127.0.0.1:5191/settings/site.css", cssBytes);
              }
              for (let i = 0; i < floodResponses; i++) {
                deliver("http://127.0.0.1:5191/settings/site.css", cssBytes);
              }
              if (failRequest) {
                const request = {};
                events.get("request")?.(request);
                events.get("requestfailed")?.(request);
              }
              if (pendingRequest) events.get("request")?.({});
              for (let i = 0; i < floodRequests; i++) {
                events.get("request")?.({}); // No response: bounded tracking, fail closed.
              }
              for (let i = 0; i < floodFailedRequests; i++) {
                const request = {};
                events.get("request")?.(request);
                events.get("requestfailed")?.(request);
              }
              for (let i = 0; i < floodPageErrors; i++) {
                events.get("pageerror")?.(new Error("Repeated page failure"));
              }
            }
            if (mutateCss) writeFileSync(join(input.renderedRoot, "settings", "site.css"),
              "body { color: red; }\n");
            return { status: () => 200 };
          },
          waitForTimeout: async (ms) => {
            if ((ms === 750 || ms === 100) && remainingWaves > 0) {
              const count = Math.min(3, remainingWaves);
              remainingWaves -= count;
              for (let i = 0; i < count; i++) {
                const req = {};
                events.get("request")?.(req);
                events.get("response")?.(response(
                  "http://127.0.0.1:5191/settings/site.css", cssBytes));
                events.get("requestfinished")?.(req);
              }
            }
            if (navigateDuringDrain && ms === 100) currentRoute = "/settings/other.html";
            if (lateResponsesAfterTimeout && ms === 100 && !lateResponsesEmitted) {
              lateResponsesEmitted = true;
              for (let i = 0; i < 5; i++) {
                const request = {};
                events.get("request")?.(request);
                events.get("response")?.(response(
                  "http://127.0.0.1:5191/settings/site.css", cssBytes));
                events.get("requestfinished")?.(request);
              }
            }
          },
          screenshot: async ({ path }) => {
            if (screenshotError) throw new Error("Screenshot unavailable");
            writeFileSync(path, "image");
          },
          url: () => "http://127.0.0.1:5191" + currentRoute,
        };
        return {
          newPage: async () => page,
          close: async () => { closed++; },
        };
      },
      close: async () => { closed++; },
    }),
  });
  return { factory, contexts, getClosed: () => closed, getBodyReads: () => bodyReads };
}

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
      /^[a-f0-9]{64}$/.test(o.screenshotSha256)));
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
      o.issues.some((issue) => issue.includes("BROWSER_PROBE_FAILURE: Screenshot unavailable"))),
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
    assert.match(r.error, /Browser missing/);
    assert.equal(r.observations.length, 0);
    assert.equal(r.localAssetTreeUnchanged, true);
  });
});
