#!/usr/bin/env node
// Explicit, read-only browser observations for a declared UI state.
// This is independent of Taste's browser contexts and cannot attest Taste's frames.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const WIDTHS = Object.freeze([1440, 768, 390]);
const H = 900;
const sha = (data) => createHash("sha256").update(data).digest("hex");
const filled = (x) => typeof x === "string" && x.trim().length > 0;
const arrayStrings = (v, max) =>
  Array.isArray(v) && v.length <= max && v.every((x) =>
    filled(x) && x.length <= 240 && !/[\r\n\0]/.test(x));
// Never persist untrusted browser exception messages. URL schemes can be
// recognized for diagnostics, but relative paths and bare credentials have
// no reliable syntactic boundary. Store fixed categories only.
const ERROR_URL_SCHEME = /\b(?:[a-z][a-z0-9+.-]*:\/\/|data:|blob:|file:|javascript:)/i;
const browserError = (error) => {
  const message = String(error?.message ?? error);
  return ERROR_URL_SCHEME.test(message)
    ? "Browser error: <url-redacted>" : "Browser error: <details-redacted>";
};
// A positive state marker must be REQUIRED by the entire selector. Reject
// selector lists, :not(), ancestor-only predicates and generic mounted roots.
const POSITIVE_MARKER = /^\[data-[a-z][a-z0-9-]*(?:\s*(?:=|~=|\|=|\^=|\$=|\*=)\s*(?:"[^"]+"|'[^']+'|[a-zA-Z0-9_-]+))?\]$/i;

function validateOptions({ baseUrl, route, contract, playwrightRoot, outRoot, chromePath }) {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      (url.pathname !== "/" && url.pathname !== "") || url.username || url.password ||
      url.search || url.hash) {
    throw new Error("A loopback HTTP origin (without path, credentials or query) is required");
  }
  if (!filled(route) || route.length > 240 || !/^\/[a-zA-Z0-9/_~.-]*$/.test(route) ||
      route.startsWith("//") || route.split("/").includes("..")) {
    throw new Error("Invalid absolute route path");
  }
  if (!contract || typeof contract !== "object" || Array.isArray(contract) ||
      contract.schemaVersion !== 1 || !/^[a-z][a-z0-9-]{1,63}$/.test(contract.stateKey ?? "") ||
      !filled(contract.readySelector) || contract.readySelector.length > 240 ||
      /^(html|body|main|#root|\*)$/i.test(contract.readySelector.trim()) ||
      !arrayStrings(contract.forbiddenSelectors ?? [], 12) ||
      !arrayStrings(contract.requiredText ?? [], 12) ||
      !arrayStrings(contract.forbiddenText ?? [], 12)) {
    throw new Error("Invalid explicit runtime-state contract");
  }
  // State evidence must use a positive, state-specific DOM marker. Generic
  // "page mounted" signals are insufficient for gameplay or ready-state claims.
  if (!POSITIVE_MARKER.test(contract.readySelector.trim())) {
    throw new Error("readySelector must be one positive data-* state selector");
  }
  if (!filled(playwrightRoot) || !existsSync(resolve(playwrightRoot))) {
    throw new Error("An explicit existing Playwright root is required");
  }
  const playwright = realpathSync(resolve(playwrightRoot));
  if (!lstatSync(playwright).isDirectory() ||
      !existsSync(join(playwright, "index.mjs"))) {
    throw new Error("Trusted Playwright package must contain index.mjs");
  }
  const output = realpathSync(resolve(outRoot || tmpdir()));
  if (!lstatSync(output).isDirectory()) throw new Error("Output root must exist");
  if (chromePath !== undefined && (!filled(chromePath) || !existsSync(resolve(chromePath)))) {
    throw new Error("Explicit Chrome path does not exist");
  }
  return {
    url: url.origin + route, route,
    contract: {
      ...contract,
      readySelector: contract.readySelector.trim(),
      forbiddenSelectors: contract.forbiddenSelectors ?? [],
      requiredText: contract.requiredText ?? [],
      forbiddenText: contract.forbiddenText ?? [],
    }, playwright, output,
    chromePath: chromePath ? resolve(chromePath) : null,
  };
}

export const snapshotDeclaredDomState = ({
  readySelector, forbiddenSelectors = [], requiredText = [], forbiddenText = [], markerOnly = false,
}) => {
  const inViewport = (r) => r.width > 0 && r.height > 0 &&
    r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const shown = (element) => {
    if (!element || !element.getBoundingClientRect ||
        !inViewport(element.getBoundingClientRect())) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" ||
          Number(style.opacity) <= 0.05) return false;
    }
    return true;
  };
  const selectedVisible = (selector) =>
    [...document.querySelectorAll(selector)].some(shown);
  // The same serializable function is used by the browser wait and all
  // snapshots, avoiding visibility rules that can disagree across phases.
  if (markerOnly) return selectedVisible(readySelector);
  const visibleWords = [];
  let textTruncated = false;
  if (requiredText.length || forbiddenText.length) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, nodes = 0, words = 0;
    while ((node = walker.nextNode()) !== null) {
      if (++nodes > 3000) { textTruncated = true; break; }
      if (!node.parentElement || !shown(node.parentElement)) continue;
      const text = node.nodeValue ?? "";
      const range = document.createRange();
      for (const match of text.matchAll(/\S+/g)) {
        if (++words > 6000) { textTruncated = true; break; }
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        if ([...range.getClientRects()].some(inViewport)) {
          visibleWords.push(match[0]);
        }
      }
      range.detach?.();
      if (textTruncated) break;
    }
  }
  const text = visibleWords.join(" ").toLocaleLowerCase();
  const includes = (needle) => text.includes(needle.toLocaleLowerCase());
  return {
    markerVisible: selectedVisible(readySelector),
    blockersVisible: forbiddenSelectors.filter(selectedVisible),
    missingText: requiredText.filter((word) => !includes(word)),
    forbiddenTextVisible: forbiddenText.filter(includes),
    textTruncated,
  };
};

function completeSample(sample) {
  return sample && sample.markerVisible === true && sample.textTruncated !== true &&
    ["blockersVisible", "missingText", "forbiddenTextVisible"].every((k) =>
      Array.isArray(sample[k]) && sample[k].length === 0);
}

async function loadPlaywright(pkg) {
  const runtime = await import(pathToFileURL(join(pkg, "index.mjs")).href);
  if (!runtime.chromium?.launch) throw new Error("Playwright chromium.launch not available");
  return runtime.chromium;
}

/**
 * Observe one explicitly declared DOM state at all required widths, using
 * separate anonymous browser contexts. A successful result means only that
 * the declared DOM signals matched in THESE contexts. It does not establish
 * an authenticated game phase or the frames in a different Taste run.
 */
export async function probeRenderedState(input, { browserFactory = loadPlaywright } = {}) {
  const opts = validateOptions(input);
  const runDir = mkdtempSync(join(opts.output, "dwa-runtime-state-"));
  const report = {
    schemaVersion: 1, kind: "dwa/declared-dom-state-observation",
    route: opts.route, localOrigin: new URL(opts.url).origin,
    stateKey: opts.contract.stateKey, contractSha256: sha(JSON.stringify(opts.contract)),
    requestedWidths: [...WIDTHS], observations: [],
    status: "INCOMPLETE", declaredDomStateObserved: false,
    tasteFramesVerified: false, authenticatedSessionVerified: false,
    gamePhaseVerified: false, productCompletionEligible: false,
    artifactDirectory: runDir,
  };
  let browser;
  try {
    const chromium = await browserFactory(opts.playwright);
    browser = await chromium.launch({
      headless: true,
      ...(opts.chromePath ? { executablePath: opts.chromePath } : { channel: "chrome" }),
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    for (const width of WIDTHS) {
      const record = { width, status: "INCOMPLETE", signals: null, screenshotSha256: null };
      report.observations.push(record);
      let context;
      let pageErrorCount = 0;
      const pageErrorSamples = [];
      let mainFrameNavigations = 0;
      let observationSealed = false;
      try {
        context = await browser.newContext({
          viewport: { width, height: H },
          serviceWorkers: "block", storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();
        // A hostile or broken page can emit an arbitrary number of exceptions.
        // Preserve the count and at most three redacted examples, never all
        // raw error strings in memory or persistent evidence.
        page.on("pageerror", (error) => {
          if (observationSealed) return;
          pageErrorCount++;
          if (pageErrorSamples.length < 3) pageErrorSamples.push(browserError(error));
        });
        // Register before goto: count main-frame navigations even when JS
        // leaves and returns to the requested route during the observation.
        const mainFrame = page.mainFrame();
        page.on("framenavigated", (frame) => {
          if (!observationSealed && frame === mainFrame) mainFrameNavigations++;
        });
        const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        record.httpStatus = response?.status?.() ?? null;
        record.redirectChainPresent =
          Boolean(response?.request?.()?.redirectedFrom?.());
        const navigatedUrl = new URL(page.url());
        // Untrusted redirects may contain path or hostname credentials.
        // Only the declared destination can appear in persisted evidence.
        const expectedOrigin = new URL(opts.url).origin;
        record.path = navigatedUrl.pathname === opts.route
          ? opts.route : "<unexpected-path-redacted>";
        record.origin = navigatedUrl.origin === expectedOrigin
          ? expectedOrigin : "<unexpected-origin-redacted>";
        try {
          await page.waitForFunction(snapshotDeclaredDomState,
            { readySelector: opts.contract.readySelector, markerOnly: true },
            { timeout: 15_000 });
        } catch (e) { record.markerWaitError = browserError(e); }
        const first = await page.evaluate(snapshotDeclaredDomState, opts.contract);
        await page.waitForTimeout(750);
        const second = await page.evaluate(snapshotDeclaredDomState, opts.contract);
        const screenshot = join(runDir, "state-" + width + ".png");
        await page.screenshot({ path: screenshot, fullPage: false, timeout: 20_000 });
        // Sample once more AFTER screenshot so an immediately dismissed loading
        // overlay or state transition is not certified as captured evidence.
        const afterScreenshot = await page.evaluate(snapshotDeclaredDomState, opts.contract);
        const capturedUrl = new URL(page.url());
        record.finalPath = capturedUrl.pathname === opts.route
          ? opts.route : "<unexpected-path-redacted>";
        record.finalOrigin = capturedUrl.origin === expectedOrigin
          ? expectedOrigin : "<unexpected-origin-redacted>";
        record.signals = { first, second, afterScreenshot };
        record.screenshot = screenshot;
        record.screenshotSha256 = sha(readFileSync(screenshot));
      } catch (e) {
        record.error = browserError(e);
      } finally {
        // A context can dispatch page errors and navigations during close.
        // Do not award success until those events have been observed.
        try { await context?.close(); }
        catch { record.contextCloseFailed = true; }
        observationSealed = true;
      }
      record.mainFrameNavigationCount = mainFrameNavigations;
      record.pageErrorCount = pageErrorCount;
      if (pageErrorSamples.length) record.pageErrorSamples = pageErrorSamples;
      const { first, second, afterScreenshot } = record.signals ?? {};
      const expectedOrigin = new URL(opts.url).origin;
      record.status = !record.error && !record.contextCloseFailed &&
        record.httpStatus === 200 && !record.redirectChainPresent &&
        mainFrameNavigations === 1 && record.path === opts.route &&
        record.finalPath === opts.route && record.origin === expectedOrigin &&
        record.finalOrigin === expectedOrigin && pageErrorCount === 0 &&
        /^[0-9a-f]{64}$/.test(record.screenshotSha256 ?? "") &&
        !record.markerWaitError && completeSample(first) &&
        completeSample(second) && completeSample(afterScreenshot)
        ? "DOM_SIGNALS_OBSERVED" : "INCOMPLETE";
    }
    if (report.observations.length === WIDTHS.length &&
        report.observations.every((r) => r.status === "DOM_SIGNALS_OBSERVED" &&
          /^[0-9a-f]{64}$/.test(r.screenshotSha256 ?? ""))) {
      report.status = "DOM_SIGNALS_OBSERVED";
      report.declaredDomStateObserved = true;
    }
  } catch (e) {
    report.error = browserError(e);
  } finally {
    await browser?.close().catch(() => {});
  }
  report.limitations = [
    "An observed data-* marker proves only the configured DOM signal, not game rules, backend authenticity or login.",
    "Anonymous fresh browser contexts are distinct from Taste Skill's screenshot contexts.",
    "This standalone observation cannot approve a product or validate prior Taste captures.",
  ];
  writeFileSync(join(runDir, "state-report.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

function parseArgs(argv) {
  const keys = new Set(["--base-url", "--route", "--contract", "--playwright-root", "--out-root", "--chrome"]);
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    if (!keys.has(argv[i]) || args.has(argv[i]) || i + 1 >= argv.length ||
        argv[i + 1].startsWith("--")) {
      throw new Error("Invalid option " + String(argv[i]));
    }
    args.set(argv[i], argv[++i]);
  }
  for (const key of ["--base-url", "--route", "--contract", "--playwright-root"]) {
    if (!args.has(key)) throw new Error("Required option " + key);
  }
  const file = resolve(args.get("--contract"));
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
    throw new Error("Contract must be a regular local JSON file");
  }
  const contract = JSON.parse(readFileSync(file, "utf8"));
  return {
    baseUrl: args.get("--base-url"), route: args.get("--route"), contract,
    playwrightRoot: args.get("--playwright-root"),
    outRoot: args.get("--out-root") ?? tmpdir(),
    chromePath: args.get("--chrome"),
  };
}

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
    const report = await probeRenderedState(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.status !== "DOM_SIGNALS_OBSERVED") process.exitCode = 1;
  } catch (e) {
    // Only known, fixed CLI usage errors may be shown verbatim. All other
    // exception details remain redacted, even if the failure occurs before a browser starts.
    const knownMissingOption = ["--base-url", "--route", "--contract", "--playwright-root"]
      .find((key) => e?.message === "Required option " + key);
    const safeMessage = knownMissingOption
      ? "Required option " + knownMissingOption : browserError(e);
    process.stderr.write("Rendered state probe: " + safeMessage + "\n");
    process.exitCode = 2;
  }
}
