import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { probeRenderedState } from "../../scripts/providers/rendered-state-probe.mjs";

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
            return { status: () => status };
          },
          url: () => "http://127.0.0.1:5191" + route,
          waitForSelector: async () => {
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
      { contract: { ...input.contract, stateKey: "" } },
      { contract: { ...input.contract, forbiddenText: Array(30).fill("loading") } },
    ]) {
      await assert.rejects(() => probeRenderedState({ ...input, ...wrong },
        { browserFactory: fake.factory }));
    }
    assert.equal(fake.opened.length, 0);
  });
});
