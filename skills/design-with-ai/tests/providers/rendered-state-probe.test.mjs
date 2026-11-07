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
  pageErrorMessage = "Fixture page exception",
  transitionAfterScreenshot = false,
  clientRedirectBounce = false,
  closePageError = false,
  closeNavigation = false,
  closeFailure = false,
} = {}) {
  let closes = 0;
  const opened = [];
  const launch = {
    newContext: async ({ viewport, serviceWorkers, storageState }) => {
      opened.push({ viewport, serviceWorkers, storageState });
      const width = viewport.width;
      let captured = false;
      let emitClosePageError = () => {};
      let emitCloseNavigation = () => {};
      return {
        newPage: async () => {
          const frame = {};
          let onNavigation = () => {};
          return {
          mainFrame: () => frame,
          on: (kind, cb) => {
            if (kind === "framenavigated") {
              onNavigation = cb;
              emitCloseNavigation = () => cb(frame);
            }
            if (kind === "pageerror") {
              emitClosePageError = () =>
                cb(new Error("token=CANARY_CLOSE_PAGE_ERROR_20261107"));
            }
            if (pageErrors && kind === "pageerror") {
              const count = pageErrors === true ? 1 : pageErrors;
              for (let i = 0; i < count; i++) cb(new Error(pageErrorMessage));
            }
          },
          goto: async () => {
            if (navigationFailure) throw new Error("Navigation timeout");
            onNavigation(frame);
            return {
              status: () => status,
              request: () => ({ redirectedFrom: () => redirected ? { url: "/entry" } : null }),
            };
          },
          url: () => origin + (captured && postCaptureRoute ? postCaptureRoute : route),
          waitForFunction: async (predicate, arg) => {
            assert.equal(predicate, snapshotDeclaredDomState,
              "browser wait must use the same serializable function as DOM snapshots");
            assert.equal(arg.markerOnly, true);
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
          waitForTimeout: async () => {
            if (clientRedirectBounce) { onNavigation(frame); onNavigation(frame); }
          },
          screenshot: async ({ path }) => {
            if (screenshotFailure) throw new Error(
              typeof screenshotFailure === "string" ? screenshotFailure : "Capture failed");
            writeFileSync(path, "screenshot-" + width);
            captured = true;
          },
          };
        },
        close: async () => {
          if (closePageError) emitClosePageError();
          if (closeNavigation) emitCloseNavigation();
          closes++;
          if (closeFailure) throw new Error("CANARY_CONTEXT_CLOSE_20261107");
        },
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


test("close-time page errors, navigations and close failures cannot preserve a stale DOM PASS", async () => {
  await fixture(async ({ input }) => {
    for (const scenario of [
      { closePageError: true },
      { closeNavigation: true },
      { closeFailure: true },
    ]) {
      const out = await probeRenderedState(input, {
        browserFactory: fakeBrowser(scenario).factory,
      });
      assert.equal(out.status, "INCOMPLETE", JSON.stringify(scenario));
      assert.equal(out.declaredDomStateObserved, false);
      assert.equal(out.productCompletionEligible, false);
      for (const observation of out.observations) {
        assert.equal(observation.status, "INCOMPLETE");
        if (scenario.closePageError) {
          assert.equal(observation.pageErrorCount, 1);
          assert.deepEqual(observation.pageErrorSamples,
            ["Browser error: <details-redacted>"]);
        }
        if (scenario.closeNavigation) {
          assert.equal(observation.mainFrameNavigationCount, 2);
        }
        if (scenario.closeFailure) {
          assert.equal(observation.contextCloseFailed, true);
        }
      }
      const persisted = readFileSync(
        join(out.artifactDirectory, "state-report.json"), "utf8");
      assert.ok(!persisted.includes("CANARY_CLOSE_"));
    }
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
      { transitionAfterScreenshot: true }, { clientRedirectBounce: true },
    ]) {
      const out = await probeRenderedState(input, {
        browserFactory: fakeBrowser(scenario).factory,
      });
      assert.equal(out.status, "INCOMPLETE", JSON.stringify(scenario));
      assert.equal(out.declaredDomStateObserved, false);
      if (scenario.clientRedirectBounce) {
        assert.ok(out.observations.every((r) => r.mainFrameNavigationCount === 3),
          "Away-and-back JS redirects must be rejected even with matching final route");
      }
      assert.equal(out.tasteFramesVerified, false);
      assert.ok(existsSync(join(out.artifactDirectory, "state-report.json")));
    }
  });
});


test("unexpected navigation paths and origins never persist secret URL components", async () => {
  await fixture(async ({ input }) => {
    const canary = "CANARY_REDIRECT_SECRET_20261107";
    for (const scenario of [
      { route: "/session/" + canary + "/login" },
      { postCaptureRoute: "/session/" + canary + "/login" },
      { origin: "https://" + canary.toLowerCase() + ".example.test" },
    ]) {
      const out = await probeRenderedState(input, {
        browserFactory: fakeBrowser(scenario).factory,
      });
      assert.equal(out.status, "INCOMPLETE");
      assert.equal(out.productCompletionEligible, false);
      const persisted = readFileSync(join(out.artifactDirectory, "state-report.json"), "utf8");
      assert.ok(!persisted.toLowerCase().includes(canary.toLowerCase()));
      assert.ok(out.observations.every((o) =>
        o.status === "INCOMPLETE" &&
        (!scenario.route || o.path === "<unexpected-path-redacted>") &&
        (!scenario.postCaptureRoute || o.finalPath === "<unexpected-path-redacted>") &&
        (!scenario.origin || o.origin === "<unexpected-origin-redacted>")));
    }
  });
});

test("pageerror flood retains only bounded URL-redacted samples and fails closed", async () => {
  await fixture(async ({ input }) => {
    const secret = "do-not-persist-this-query-token";
    const rawUrl = "http://127.0.0.1:5191/game/live?access=" + secret;
    const out = await probeRenderedState(input, {
      browserFactory: fakeBrowser({
        pageErrors: 2_500,
        pageErrorMessage: "Browser failure at " + rawUrl + " with extra details",
      }).factory,
    });
    assert.equal(out.status, "INCOMPLETE");
    assert.equal(out.declaredDomStateObserved, false);
    assert.equal(out.productCompletionEligible, false);
    assert.equal(out.observations.length, 3);
    for (const observation of out.observations) {
      assert.equal(observation.status, "INCOMPLETE");
      assert.equal(observation.pageErrorCount, 2_500);
      assert.equal(observation.pageErrorSamples.length, 3);
      assert.ok(observation.pageErrorSamples.every((s) =>
        s.includes("<url-redacted>") && s.length <= 260));
    }
    const persisted = readFileSync(join(out.artifactDirectory, "state-report.json"), "utf8");
    assert.ok(!persisted.includes(secret));
    assert.ok(!persisted.includes(rawUrl));
    assert.ok(persisted.includes("<url-redacted>"));
  });
});

test("URL-bearing browser errors never persist WebSocket tokens or split query fragments", async () => {
  await fixture(async ({ input }) => {
    const tokens = ["wss-token-do-not-persist", "split-token-do-not-persist"];
    for (const message of [
      "WebSocket connection to 'wss://api.test/game?token=" + tokens[0] + "' failed",
      "Network error: https://api.test/?mode=red'&token=" + tokens[1],
    ]) {
      const out = await probeRenderedState(input, {
        browserFactory: fakeBrowser({
          pageErrors: true, pageErrorMessage: message,
        }).factory,
      });
      assert.equal(out.status, "INCOMPLETE");
      assert.ok(out.observations.every((o) =>
        o.pageErrorCount === 1 &&
        o.pageErrorSamples.length === 1 &&
        o.pageErrorSamples[0] === "Browser error: <url-redacted>"));
      const report = readFileSync(join(out.artifactDirectory, "state-report.json"), "utf8");
      for (const token of tokens) assert.ok(!report.includes(token));
      assert.ok(!report.includes("wss://api.test"));
    }
  });
});


test("relative URLs and bare credentials never persist in state browser evidence", async () => {
  await fixture(async ({ input }) => {
    const messages = [
      "Fetch failed: /api/auth?access_token=CANARY_RELATIVE_906",
      "Blocked //internal.example/api?token=CANARY_PROTOCOL_906",
      "Request token=CANARY_BARE_906",
    ];
    for (const message of messages) {
      const report = await probeRenderedState(input, {
        browserFactory: fakeBrowser({ pageErrors: true, pageErrorMessage: message }).factory,
      });
      assert.equal(report.status, "INCOMPLETE");
      assert.equal(report.productCompletionEligible, false);
      assert.ok(report.observations.every((o) =>
        o.pageErrorCount === 1 &&
        o.pageErrorSamples.length === 1 &&
        o.pageErrorSamples[0] === "Browser error: <details-redacted>"));
      const persisted = readFileSync(join(report.artifactDirectory, "state-report.json"), "utf8");
      assert.ok(!persisted.includes("CANARY_"), "Untrusted error text must not persist");
      assert.ok(!persisted.includes(message));
    }
    const capture = await probeRenderedState(input, {
      browserFactory: fakeBrowser({
        screenshotFailure: "Screenshot failed token=CANARY_CAPTURE_906",
      }).factory,
    });
    assert.equal(capture.status, "INCOMPLETE");
    assert.ok(capture.observations.every((o) =>
      o.error === "Browser error: <details-redacted>"));
    const captureFile = readFileSync(join(capture.artifactDirectory, "state-report.json"), "utf8");
    assert.ok(!captureFile.includes("CANARY_CAPTURE_906"));
    const launch = await probeRenderedState(input, {
      browserFactory: async () => { throw new Error("Launch token=CANARY_LAUNCH_906"); },
    });
    assert.equal(launch.status, "INCOMPLETE");
    assert.equal(launch.error, "Browser error: <details-redacted>");
    const launchFile = readFileSync(join(launch.artifactDirectory, "state-report.json"), "utf8");
    assert.ok(!launchFile.includes("CANARY_LAUNCH_906"));
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
  const hiddenAncestor = element(30);
  hiddenAncestor.hidden = true;
  hiddenAncestor.parentElement = markerVisible;
  const hiddenWrapper = element(10);
  hiddenWrapper.hidden = true;
  let markerCandidates = [markerHidden, markerVisible];
  const visible = {
    nodeValue: "Playing now", parentElement: markerVisible,
    rect: box(20),
  };
  const offscreen = {
    nodeValue: "Loading below fold", parentElement: markerVisible,
    rect: box(1300), // Parent is visible but these specific word ranges are not.
  };
  const hiddenWord = {
    nodeValue: "Secret under hidden ancestor", parentElement: hiddenAncestor,
    rect: box(30),
  };
  try {
    globalThis.innerWidth = 390;
    globalThis.innerHeight = 900;
    globalThis.NodeFilter = { SHOW_TEXT: 4 };
    globalThis.getComputedStyle = (node) => ({
      display: node.hidden ? "none" : "block", visibility: "visible", opacity: "1",
    });
    globalThis.document = {
      body: {},
      querySelectorAll: () => markerCandidates,
      createTreeWalker: () => {
        const nodes = [visible, offscreen, hiddenWord]; let pos = 0;
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
      requiredText: ["Playing now", "below fold", "Secret"],
      forbiddenText: ["Loading", "Secret"],
    });
    assert.equal(result.markerVisible, true, "second visible matching marker is valid");
    assert.deepEqual(result.missingText, ["below fold", "Secret"]);
    assert.deepEqual(result.forbiddenTextVisible, []);
    assert.equal(result.textTruncated, false);
    const markerOnly = () => snapshotDeclaredDomState({
      readySelector: "[data-game-phase='live']", markerOnly: true,
    });
    assert.equal(markerOnly(), true, "the browser wait accepts a visible marker");
    markerCandidates = [markerHidden];
    assert.equal(markerOnly(), false, "off-screen markers cannot release the wait");
    markerCandidates = [markerVisible];
    markerVisible.parentElement = hiddenWrapper;
    assert.equal(markerOnly(), false, "hidden ancestors cannot release the wait");
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

test("DOM text traversal itself enforces both node and word scan limits", () => {
  const old = {
    document: globalThis.document, getComputedStyle: globalThis.getComputedStyle,
    NodeFilter: globalThis.NodeFilter,
    innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight,
  };
  const rect = { top: 10, bottom: 30, left: 0, right: 120, width: 120, height: 20 };
  const parent = { parentElement: null, getBoundingClientRect: () => rect };
  try {
    globalThis.innerWidth = 390;
    globalThis.innerHeight = 900;
    globalThis.NodeFilter = { SHOW_TEXT: 4 };
    globalThis.getComputedStyle = () => ({
      display: "block", visibility: "visible", opacity: "1",
    });
    const run = (nodes) => {
      globalThis.document = {
        body: {},
        querySelectorAll: () => [parent],
        createTreeWalker: () => {
          let index = 0;
          return { nextNode: () => nodes[index++] ?? null };
        },
        createRange: () => ({
          setStart: () => {}, setEnd: () => {},
          getClientRects: () => [rect], detach: () => {},
        }),
      };
      return snapshotDeclaredDomState({
        readySelector: "[data-game-phase='live']",
        requiredText: ["word"],
      });
    };
    const overNodeLimit = Array.from({ length: 3001 },
      () => ({ nodeValue: "word", parentElement: parent }));
    const nodesResult = run(overNodeLimit);
    assert.equal(nodesResult.markerVisible, true);
    assert.equal(nodesResult.textTruncated, true, "3,001 nodes must truncate");
    const wordsResult = run([{
      nodeValue: Array(6001).fill("word").join(" "),
      parentElement: parent,
    }]);
    assert.equal(wordsResult.markerVisible, true);
    assert.equal(wordsResult.textTruncated, true, "6,001 words must truncate");
  } finally {
    Object.assign(globalThis, old);
  }
});

test("an unavailable browser records INCOMPLETE evidence instead of a false success", async () => {
  await fixture(async ({ input }) => {
    const out = await probeRenderedState(input, {
      browserFactory: async () => { throw new Error("Chrome absent"); },
    });
    assert.equal(out.status, "INCOMPLETE");
    assert.equal(out.error, "Browser error: <details-redacted>");
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
