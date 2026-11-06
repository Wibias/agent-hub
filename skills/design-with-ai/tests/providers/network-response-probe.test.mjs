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
  pendingRequest = false,
  floodRequests = 0,
  floodFailedRequests = 0,
  floodPageErrors = 0,
} = {}) {
  const contexts = [];
  let closed = 0;
  const factory = async () => ({
    launch: async () => ({
      newContext: async (opts) => {
        contexts.push(opts);
        const events = new Map();
        const response = (resourceUrl, body, status = 200) => ({
          url: () => resourceUrl,
          status: () => status,
          headers: () => ({ "content-length": String(body.length) }),
          body: async () => {
            if (bodyUnavailable) throw new Error("Body was evicted");
            return body;
          },
        });
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
          waitForTimeout: async () => {},
          screenshot: async ({ path }) => {
            if (screenshotError) throw new Error("Screenshot unavailable");
            writeFileSync(path, "image");
          },
          url: () => "http://127.0.0.1:5191" + (redirected ? "/login" : "/settings"),
        };
        return {
          newPage: async () => page,
          close: async () => { closed++; },
        };
      },
      close: async () => { closed++; },
    }),
  });
  return { factory, contexts, getClosed: () => closed };
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
    for (const changes of [
      { baseUrl: "https://example.com" },
      { baseUrl: "http://user:pass@127.0.0.1:5191/" },
      { baseUrl: "http://127.0.0.1:5191/private" },
      { route: "//cdn.example.test" },
      { route: "/%2e%2e/foo" },
      { route: "/other" },
      { playwrightRoot: join(f.root, "not-installed") },
      { renderedRoot: f.root },
      { outRoot: f.input.renderedRoot },
    ]) {
      await assert.rejects(() => probeNetworkResponses({
        ...f.input, ...changes,
      }), /origin|root|Playwright|build|route|Route|HTML|outside|loopback/i,
      JSON.stringify(changes));
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
