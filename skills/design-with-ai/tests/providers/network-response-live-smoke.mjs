#!/usr/bin/env node
// Real CI-only Chrome network verification against a temporary loopback server.
// No product repo changes, browser downloads or production endpoint requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeNetworkResponses } from "../../scripts/providers/network-response-probe.mjs";

if (!process.env.DWA_PLAYWRIGHT_ROOT || !process.env.CHROME_PATH) {
  process.stderr.write("DWA_PLAYWRIGHT_ROOT and CHROME_PATH required for real browser smoke\n");
  process.exit(2);
}
const project = mkdtempSync(join(tmpdir(), "dwa-network-live-"));
const renderedRoot = join(project, "dist");
const directory = join(renderedRoot, "settings");
mkdirSync(directory, { recursive: true });
const html = join(directory, "index.html");
const css = join(directory, "site.css");
const favicon = join(renderedRoot, "favicon.ico");
const htmlBytes = Buffer.from(
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<link rel="icon" href="/favicon.ico">' +
  '<link rel="stylesheet" href="/settings/site.css">' +
  '<title>Network Fixture</title></head><body>' +
  '<main><h1>Network fixture</h1><p>Static local asset delivery.</p></main>' +
  '</body></html>\n',
);
const cssBytes = Buffer.from("body { color: #151515; background: white; }\n");
const faviconBytes = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
writeFileSync(html, htmlBytes);
writeFileSync(css, cssBytes);
writeFileSync(favicon, faviconBytes);

let tamperCss = false;
let servedHtmlBytes = htmlBytes;
const hangingResponses = new Set();
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === "/hanging-local") {
    // Deliberately never send response headers or body. A fetch() started by
    // the page must remain observable even though other assets have loaded.
    hangingResponses.add(res);
    res.once("close", () => hangingResponses.delete(res));
    return;
  }
  const files = new Map([
    ["/settings", { data: servedHtmlBytes, type: "text/html; charset=utf-8" }],
    ["/settings/site.css", {
      data: tamperCss ? Buffer.from("body { color: red; }\n") : cssBytes,
      type: "text/css",
    }],
    ["/favicon.ico", { data: faviconBytes, type: "image/x-icon" }],
  ]);
  const content = files.get(pathname);
  if (!content) {
    res.writeHead(404, { "cache-control": "no-store" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": content.type,
    "content-length": content.data.length,
    "cache-control": "no-store",
  });
  res.end(content.data);
});
try {
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const port = server.address().port;
  const input = {
    baseUrl: "http://127.0.0.1:" + port,
    route: "/settings",
    projectRoot: project,
    renderedRoot,
    html,
    playwrightRoot: process.env.DWA_PLAYWRIGHT_ROOT,
    chromePath: process.env.CHROME_PATH,
    outRoot: project,
  };
  const match = await probeNetworkResponses(input);
  assert.equal(match.status, "LOCAL_RESPONSES_MATCHED", JSON.stringify(match));
  assert.equal(match.productCompletionEligible, false);
  assert.equal(match.tasteFramesVerified, false);
  assert.equal(match.observations.length, 3);
  for (const o of match.observations) {
    assert.equal(o.status, "LOCAL_BODY_BYTES_MATCHED", JSON.stringify(o));
    const localPaths = new Set(o.local.map((x) => x.path));
    assert.ok(localPaths.has("dist/settings/index.html"), JSON.stringify(o));
    assert.ok(localPaths.has("dist/settings/site.css"), JSON.stringify(o));
    assert.ok(o.local.every((entry) => entry.bodyVerified));
    assert.equal(o.pageErrorCount, 0);
  }

  // Modify the HTTP response only, not the on-disk file. The on-disk tree is
  // unchanged and must not be mistaken for proof of what Chrome received.
  tamperCss = true;
  const mismatch = await probeNetworkResponses(input);
  assert.equal(mismatch.status, "INCOMPLETE");
  assert.equal(mismatch.localAssetTreeUnchanged, true);
  assert.ok(mismatch.observations.some((o) =>
    o.issues.includes("LOCAL_RESPONSE_BODY_MISMATCH")));
  assert.equal(readFileSync(css).toString(), cssBytes.toString());

  // Real Chrome negative: a page-script fetch stays open with no HTTP response.
  // Keep the served document byte-identical to its on-disk build artifact, so
  // an INCOMPLETE result specifically proves in-flight request detection.
  tamperCss = false;
  servedHtmlBytes = Buffer.from(htmlBytes.toString("utf8").replace(
    "</body>", '<script>void fetch("/hanging-local").catch(() => {});</script></body>',
  ));
  writeFileSync(html, servedHtmlBytes);
  const pending = await probeNetworkResponses(input);
  assert.equal(pending.status, "INCOMPLETE", JSON.stringify(pending));
  assert.equal(pending.localAssetTreeUnchanged, true);
  assert.equal(pending.observations.length, 3);
  assert.ok(pending.observations.every((o) =>
    o.httpStatus === 200 && o.finalUrlMatched &&
    o.local.length > 0 && o.local.every((entry) => entry.bodyVerified) &&
    o.outstandingRequestCount > 0 &&
    o.issues.includes("BROWSER_REQUESTS_STILL_PENDING")),
  "Real Chrome must reject otherwise-matching bodies when fetch() remains in flight");
  assert.equal(pending.tasteFramesVerified, false);
  assert.equal(pending.productCompletionEligible, false);

  process.stdout.write(JSON.stringify({
    status: "REAL_CHROME_NETWORK_PROBE_CONFIRMED",
    widths: [1440, 768, 390],
    regularStatus: match.status,
    tamperedStatus: mismatch.status,
    hangingStatus: pending.status,
    hangingRequestDetected: true,
    assetCount: match.expectedLocalFileCount,
    responseCountPerWidth: match.observations.map((x) => x.local.length),
    wrongHttpBytesDetected: true,
    tasteFramesVerified: false,
    productCompletionEligible: false,
  }, null, 2) + "\n");
} finally {
  // Closing the responses also prevents an intentionally hung fixture from
  // holding Node's HTTP server open if the browser exits unexpectedly.
  for (const response of hangingResponses) {
    if (!response.destroyed && !response.writableEnded) response.end();
  }
  await new Promise((accept) => server.close(() => accept()));
  rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
