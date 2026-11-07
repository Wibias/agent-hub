import assert from "node:assert/strict";
import { test } from "node:test";
import {
  launchOwnedBrowser, terminateOwnedBrowser,
} from "../../scripts/providers/browser-server-lifecycle.mjs";

test("browser server endpoint remains private and connect timeout kills its owned server", async () => {
  let kills = 0;
  let launched = false;
  const chromium = {
    launchServer: async (options) => {
      launched = true;
      assert.equal(options.host, "127.0.0.1");
      return {
        wsEndpoint: () => "ws://127.0.0.1:1234/PRIVATE_CANARY_TOKEN",
        kill: async () => { kills++; },
      };
    },
    connect: async () => new Promise(() => {}),
  };
  const stage = async (name, fn) => name === "connect"
    ? Promise.race([fn(), new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Browser stage timeout: connect")), 20))])
    : fn();
  await assert.rejects(launchOwnedBrowser(chromium, { headless: true }, stage),
    /Browser stage timeout: connect/);
  assert.equal(launched, true);
  assert.equal(kills, 1);
});

test("real loader cannot silently fall back to an unsupervised Browser.launch", async () => {
  let launches = 0;
  const chromium = { launch: async () => { launches++; return {}; } };
  await assert.rejects(launchOwnedBrowser(chromium, {}, (_, fn) => fn()),
    /process control unavailable/);
  assert.equal(launches, 0);
});

test("supported BrowserServer.kill is preferred over nonexistent Browser.process", () => {
  let kills = 0;
  terminateOwnedBrowser({ close: () => Promise.resolve() }, {
    kill: async () => { kills++; },
  });
  assert.equal(kills, 1);
});
