import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { probeRenderedState, snapshotDeclaredDomState } from "../../scripts/providers/rendered-state-probe.mjs";

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-rendered-state-test-"));
  const playwrightRoot = join(root, "fake-playwright");
  mkdirSync(playwrightRoot);
  writeFileSync(join(playwrightRoot, "index.mjs"), "export const chromium = {};\n");
  const contract = {
    schemaVersion: 1, stateKey: "game-live",
    readySelector: '[data-game-phase="live"]',
    forbiddenSelectors: ["[aria-busy=true]"],
    requiredText: ["Playing now"], forbiddenText: ["Loading"],
  };
  const input = {
    baseUrl: "http://127.0.0.1:5191", route: "/game/live",
    contract, playwrightRoot, outRoot: root,
  };
  try { return await fn({ root, playwrightRoot, input }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function fakeBrowser({
  states = {},
  status = 200,
  route = "/game/live",
  redirected = false,
  origin = "http://127.0.0.1:5191",
  postCaptureRoute = null,
  waitFailure = false,
  navigationFailure = false,
  screenshotFailure = false,
  pageErrors = false,
  transitionAfterScreenshot = false,
} = {}) {
  let closes = 0;
  const opened = [];
  const launch = {
    newContext: async ({ viewport, serviceWorkers, storageState }) => {
      opened.push({ viewport, serviceWorkers, storageState });
      const width = viewport.width;
      let captured = false;
      return {
        newPage: async () => ({
          on: (kind, cb) => {
            if (pageErrors && kind === "pageerror") cb(new Error("Fixture page exception"));
          },
          goto: async () => {
            if (navigationFailure) throw new Error("Navigation timeout");
            return {
              status: () => status,
              request: () => ({ redirectedFrom: () => redirected ? { url: "/entry" } : null }),
            };
          },
          url: () => origin + (captured && postCaptureRoute ? postCaptureRoute : route),
          waitForFunction: async () => {
            if (waitFailure) throw new Error("Wait timed out");
          },
          evaluate: async () => captured && transitionAfterScreenshot ? {
            markerVisible: false, blockersVisible: [],
            missingText: [], forbiddenTextVisible: [],
          } : states[width] || {
            markerVisible: true,
            blockersVisible: [],
            missingText: [],
            forbiddenTextVisible: [],
          },
          waitForTimeout: async () => {},
          screenshot: async ({ path }) => {
            if (screenshotFailure) throw new Error("Capture failed");
            writeFileSync(path, "screenshot-" + width);
            captured = true;
          },
        }),
        close: async () => { closes++; },
      };
    },
    close: async () => { closes++; },
  };
  return {
    factory: async () => ({ launch: async () => launch }),
    opened, getCloses: () => closes,
  };
}

test("all three declared DOM state observations need separate fresh anonymous contexts", async () => {
  await fixture(async ({ input }) => {
    const fake = fakeBrowser();
    const out = await probeRenderedState(input, { browserFactory: fake.factory });
    assert.equal(out.status, "DOM_SIGNALS_OBSERVED");
    assert.equal(out.declaredDomStateObserved, true);
    assert.equal(out.tasteFramesVerified, false);
    assert.equal(out.gamePhaseVerified, false);
    assert.equal(out.authenticatedSessionVerified, false);
    assert.equal(out.productCompletionEligible, false);
    assert.deepEqual(out.observations.map((r) => r.width), [1440, 768, 390]);
    assert.ok(out.observations.every((r) => r.status === "DOM_SIGNALS_OBSERVED" &&
      /^[0-9a-f]{64}$/.test(r.screenshotSha256)));
    assert.equal(fake.opened.length, 3);
    assert.equal(fake.getCloses(), 4);
    assert.ok(fake.opened.every((c) => c.serviceWorkers === "block" &&
      c.storageState.cookies.length === 0 && c.storageState.origins.length === 0));
    assert.equal(JSON.parse(readFileSync(join(out.artifactDirectory, "state-report.json"), "utf8"))
      .status, "DOM_SIGNALS_OBSERVED");
  });
});

test("loading, empty, redirected, failed or unscreened state cannot be observed", async () => {
  await fixture(async ({ input }) => {
    const bad = {
      390: { markerVisible: false, blockersVisible: ["[aria-busy=true]"],
        missingText: ["Playing now"], forbiddenTextVisible: ["Loading"] },
    };
    for (const scenario of [
      { states: bad }, { status: 404 }, { route: "/wrong" },
      { redirected: true },
      { origin: "https://other-host.example" },
      { postCaptureRoute: "/login" },
      { waitFailure: true }, { screenshotFailure: true },
      { navigationFailure: true }, { pageErrors: true },
      { transitionAfterScreenshot: true },
    ]) {
      const out = await probeRenderedState(input, {
        browserFactory: fakeBrowser(scenario).factory,
      });
      assert.equal(out.status, "INCOMPLETE", JSON.stringify(scenario));
      assert.equal(out.declaredDomStateObserved, false);
      assert.equal(out.tasteFramesVerified, false);
      assert.ok(existsSync(join(out.artifactDirectory, "state-report.json")));
    }
  });
});

test("omitted optional lists are normalized and truncated viewport text cannot certify state", async () => {
  await fixture(async ({ input }) => {
    const noLists = {
      schemaVersion: 1, stateKey: "game-live", readySelector: "[data-game-phase='live']",
    };
    const okay = await probeRenderedState({ ...input, contract: noLists }, {
      browserFactory: fakeBrowser().factory,
    });
    assert.equal(okay.status, "DOM_SIGNALS_OBSERVED");
    const truncated = await probeRenderedState(input, {
      browserFactory: fakeBrowser({
        states: { 390: {
          markerVisible: true, blockersVisible: [],
          missingText: [], forbiddenTextVisible: [], textTruncated: true,
        } },
      }).factory,
    });
    assert.equal(truncated.status, "INCOMPLETE");
  });
});

test("viewport text ignores off-screen content and all markers are considered", () => {
  const old = {
    document: globalThis.document, getComputedStyle: globalThis.getComputedStyle,
    NodeFilter: globalThis.NodeFilter,
    innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight,
  };
  const box = (top, height = 30) => ({
    top, bottom: top + height, left: 0, right: 200, width: 200, height,
  });
  const element = (top) => ({
    parentElement: null, getBoundingClientRect: () => box(top),
  });
  const markerHidden = element(1200);
  const markerVisible = element(20);
  const visible = {
    nodeValue: "Playing now", parentElement: markerVisible,
    rect: box(20),
  };
  const offscreen = {
    nodeValue: "Loading below fold", parentElement: element(1300),
    rect: box(1300),
  };
  try {
    globalThis.innerWidth = 390;
    globalThis.innerHeight = 900;
    globalThis.NodeFilter = { SHOW_TEXT: 4 };
    globalThis.getComputedStyle = () => ({
      display: "block", visibility: "visible", opacity: "1",
    });
    globalThis.document = {
      body: {},
      querySelectorAll: () => [markerHidden, markerVisible],
      createTreeWalker: () => {
        const nodes = [visible, offscreen]; let pos = 0;
        return { nextNode: () => nodes[pos++] ?? null };
      },
      createRange: () => {
        let node;
        return {
          setStart: (current) => { node = current; },
          setEnd: () => {},
          getClientRects: () => [node.rect],
          detach: () => {},
        };
      },
    };
    const result = snapshotDeclaredDomState({
      readySelector: "[data-game-phase='live']",
      requiredText: ["Playing now", "below fold"],
      forbiddenText: ["Loading"],
    });
    assert.equal(result.markerVisible, true, "second visible matching marker is valid");
    assert.deepEqual(result.missingText, ["below fold"]);
    assert.deepEqual(result.forbiddenTextVisible, []);
    assert.equal(result.textTruncated, false);
  } finally {
    Object.assign(globalThis, old);
  }
});

test("symlinked CLI invocation executes and rejects missing options instead of silently exiting", async () => {
  await fixture(async ({ root }) => {
    if (process.platform === "win32") return; // File symlinks need elevated rights on some Windows hosts.
    const source = fileURLToPath(new URL("../../scripts/providers/rendered-state-probe.mjs", import.meta.url));
    const link = join(root, "state-probe-cli.mjs");
    symlinkSync(source, link);
    const result = spawnSync(process.execPath, [link], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Required option --base-url/);
  });
});

test("an unavailable browser records INCOMPLETE evidence instead of a false success", async () => {
  await fixture(async ({ input }) => {
    const out = await probeRenderedState(input, {
      browserFactory: async () => { throw new Error("Chrome absent"); },
    });
    assert.equal(out.status, "INCOMPLETE");
    assert.match(out.error, /Chrome absent/);
    assert.equal(out.declaredDomStateObserved, false);
    assert.equal(out.observations.length, 0);
  });
});

test("contracts reject remote URLs, vague selectors and route traversal", async () => {
  await fixture(async ({ input }) => {
    const fake = fakeBrowser();
    for (const wrong of [
      { baseUrl: "https://example.com" },
      { baseUrl: "http://127.0.0.1:5191/path" },
      { baseUrl: "http://username:secret@localhost:5191" },
      { route: "/../private" }, { route: "//otherhost" }, { route: "/game?mode=live" },
      { contract: { ...input.contract, readySelector: "main" } },
      { contract: { ...input.contract, readySelector: "#root" } },
      { contract: { ...input.contract, readySelector: "main:not([data-loading])" } },
      { contract: { ...input.contract, readySelector: "[data-game-phase='live'], main" } },
      { contract: { ...input.contract, readySelector: "body [data-game-phase='live']" } },
      { contract: { ...input.contract, stateKey: "" } },
      { contract: { ...input.contract, forbiddenText: Array(30).fill("loading") } },
    ]) {
      await assert.rejects(() => probeRenderedState({ ...input, ...wrong },
        { browserFactory: fake.factory }));
    }
    assert.equal(fake.opened.length, 0);
  });
});
