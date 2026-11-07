#!/usr/bin/env node
// Actual OS-level process termination in Linux and Windows CI.
// Entirely isolated Chrome; never sends production traffic or records PIDs.
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  launchOwnedBrowser, terminateOwnedBrowser,
} from "../../scripts/providers/browser-server-lifecycle.mjs";

const root = process.env.DWA_PLAYWRIGHT_ROOT;
const chrome = process.env.CHROME_PATH;
assert.ok(root && existsSync(join(root, "index.mjs")));
assert.ok(chrome && existsSync(chrome));
const { chromium } = await import(pathToFileURL(join(root, "index.mjs")).href);
let owned;
try {
  owned = await launchOwnedBrowser(chromium, {
    headless: true, executablePath: chrome,
    args: ["--no-first-run", "--no-default-browser-check"],
  }, async (_name, call) => call());
  const { browser, server } = owned;
  assert.ok(server && typeof server.kill === "function");
  assert.ok(typeof server.process === "function");
  assert.ok(typeof server.close === "function");
  assert.equal(typeof browser.process, "undefined",
    "Playwright Browser must not be treated as a BrowserServer");
  const processHandle = server.process();
  assert.ok(processHandle && Number.isInteger(processHandle.pid));
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto("data:text/html,<main>isolated process test</main>");
  // Model a stalled Browser RPC. Termination must use the BrowserServer
  // process ownership, not Browser.close() or browser.process().
  const stalledRpc = () => new Promise(() => {});
  const stage = await Promise.race([
    stalledRpc().then(() => "finished"),
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 100)),
  ]);
  assert.equal(stage, "timed-out");
  const exited = once(processHandle, "exit");
  terminateOwnedBrowser(browser, server);
  await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("BrowserServer process did not exit")), 15_000)),
  ]);
  assert.ok(processHandle.exitCode !== null || processHandle.signalCode !== null,
    "An actual spawned Chrome process must exit after BrowserServer.kill");
  console.log("Real Playwright BrowserServer process killed on stalled RPC; no endpoint or PID logged.");
} finally {
  if (owned?.server) {
    await Promise.race([
      owned.server.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
}
