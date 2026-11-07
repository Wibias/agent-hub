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
const SAMPLE_LIMIT_MS = 10_000;
const CLEANUP_LIMIT_MS = 15_000;
const MARKER_WAIT_LIMIT_MS = 16_000;
// A blocked renderer or transport must never prevent a persisted fail-closed
// report. Use a Node-side deadline independent of Playwright's own timeouts.
async function boundedBrowserCall(call, timeoutMs, timeoutMessage) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const cappedDeadline = (value, max) =>
  Number.isSafeInteger(value) && value > 0 && value <= max ? value : max;
function stopBrowserProcess(browser) {
  try { browser?.process?.()?.kill?.("SIGKILL"); }
  catch { /* Ignore transport teardown errors, preserve fixed diagnostics. */ }
}

const sha = (data) => createHash("sha256").update(data).digest("hex");
const filled = (x) => typeof x === "string" && x.trim().length > 0;
const arrayStrings = (v, max) =>
  Array.isArray(v) && v.length <= max && v.every((x) =>
    filled(x) && x.length <= 240 && !/[\r\n\0]/.test(x));
const browserError = (e) => String(e?.message ?? e).slice(0, 260);
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
  const visibleStyle = (element) => {
    if (!element) return false;
    // visibility is inherited but descendants can override it with visible.
    // display:none and opacity remain effective on the entire ancestor chain.
    const ownVisibility = getComputedStyle(element).visibility;
    if (ownVisibility === "hidden" || ownVisibility === "collapse") return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || Number(style.opacity) <= 0.05) return false;
    }
    return true;
  };
  const intersectsVisible = (rect, element) => {
    if (!inViewport(rect)) return false;
    let left = Math.max(0, rect.left);
    let right = Math.min(innerWidth, rect.right);
    let top = Math.max(0, rect.top);
    let bottom = Math.min(innerHeight, rect.bottom);
    // A range's unclipped CSSOM rectangle can lie inside a zero-height or
    // scroll-clipped ancestor. Intersect with each actual clipping ancestor.
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const x = style.overflowX ?? style.overflow;
      const y = style.overflowY ?? style.overflow;
      const clipX = /^(hidden|clip|scroll|auto|overlay)$/.test(x ?? "");
      const clipY = /^(hidden|clip|scroll|auto|overlay)$/.test(y ?? "");
      if ((clipX || clipY) && node.getBoundingClientRect) {
        const clip = node.getBoundingClientRect();
        if (clipX) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
        if (clipY) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
      if (right <= left || bottom <= top) return false;
    }
    return right > left && bottom > top;
  };
  const shown = (element) =>
    visibleStyle(element) && Boolean(element.getBoundingClientRect) &&
    intersectsVisible(element.getBoundingClientRect(), element.parentElement);
  const selectedVisible = (selector) =>
    [...document.querySelectorAll(selector)].some(shown);
  // The same serializable function is used by the browser wait and all
  // snapshots, avoiding visibility rules that can disagree across phases.
  if (markerOnly) return selectedVisible(readySelector);
  // Keep adjacent inline text fragments adjacent: Play<span>ing</span>
  // must count as "Playing", while a real DOM whitespace token remains a gap.
  let visibleText = "";
  let pendingGap = false;
  let previousBlock = null;
  let textTruncated = false;
  const blockAncestor = (element) => {
    for (let node = element; node; node = node.parentElement) {
      if (/^(block|flow-root|flex|grid|table|list-item)$/.test(
        getComputedStyle(node).display ?? "")) return node;
    }
    return null;
  };
  if (requiredText.length || forbiddenText.length) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, nodes = 0, words = 0;
    while ((node = walker.nextNode()) !== null) {
      if (++nodes > 3000) { textTruncated = true; break; }
      const raw = node.nodeValue ?? "";
      if (!node.parentElement || !visibleStyle(node.parentElement)) {
        if (raw.trim()) pendingGap = true;
        continue;
      }
      const block = blockAncestor(node.parentElement);
      const range = document.createRange();
      let last = 0;
      for (const match of raw.matchAll(/\S+/g)) {
        if (++words > 6000) { textTruncated = true; break; }
        if (/\s/.test(raw.slice(last, match.index))) pendingGap = true;
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const visible = [...range.getClientRects()].some((rect) =>
          intersectsVisible(rect, node.parentElement));
        if (visible) {
          if (visibleText.length &&
              (pendingGap || (previousBlock && block && previousBlock !== block))) {
            visibleText += " ";
          }
          visibleText += match[0];
          previousBlock = block;
          pendingGap = false;
        } else {
          // Offscreen/clipped text cannot bridge two unrelated word pieces.
          pendingGap = true;
        }
        last = match.index + match[0].length;
      }
      if (/\s/.test(raw.slice(last))) pendingGap = true;
      range.detach?.();
      if (textTruncated) break;
    }
  }
  const normalizedText = visibleText.toLocaleLowerCase();
  const includes = (needle) => normalizedText.includes(needle.toLocaleLowerCase());
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
export async function probeRenderedState(input, {
  browserFactory = loadPlaywright,
  sampleTimeoutMs = SAMPLE_LIMIT_MS, cleanupTimeoutMs = CLEANUP_LIMIT_MS,
} = {}) {
  const opts = validateOptions(input);
  const sampleDeadline = cappedDeadline(sampleTimeoutMs, SAMPLE_LIMIT_MS);
  const cleanupDeadline = cappedDeadline(cleanupTimeoutMs, CLEANUP_LIMIT_MS);
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
      let abortAfterViewport = false;
      try {
        context = await browser.newContext({
          viewport: { width, height: H },
          serviceWorkers: "block", storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(browserError(error)));
        const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        record.httpStatus = response?.status?.() ?? null;
        record.redirectChainPresent =
          Boolean(response?.request?.()?.redirectedFrom?.());
        const navigatedUrl = new URL(page.url());
        record.path = navigatedUrl.pathname;
        record.origin = navigatedUrl.origin;
        try {
          await boundedBrowserCall(() => page.waitForFunction(snapshotDeclaredDomState,
            { readySelector: opts.contract.readySelector, markerOnly: true },
            { timeout: 15_000 }), MARKER_WAIT_LIMIT_MS, "DOM marker wait timeout");
        } catch (e) {
          record.markerWaitError = browserError(e);
          if (e?.message === "DOM marker wait timeout") {
            record.markerWaitTimedOut = true;
            abortAfterViewport = true;
            throw e;
          }
        }
        const sampleDom = () => boundedBrowserCall(
          () => page.evaluate(snapshotDeclaredDomState, opts.contract),
          sampleDeadline, "DOM sample timeout");
        const first = await sampleDom();
        await page.waitForTimeout(750);
        const second = await sampleDom();
        const screenshot = join(runDir, "state-" + width + ".png");
        await page.screenshot({ path: screenshot, fullPage: false, timeout: 20_000 });
        // Sample once more AFTER screenshot so an immediately dismissed loading
        // overlay or state transition is not certified as captured evidence.
        const afterScreenshot = await sampleDom();
        const capturedUrl = new URL(page.url());
        record.finalPath = capturedUrl.pathname;
        record.finalOrigin = capturedUrl.origin;
        record.signals = { first, second, afterScreenshot };
        record.pageErrorCount = errors.length;
        if (errors.length) record.pageErrorSamples = errors.slice(0, 3);
        record.screenshot = screenshot;
        record.screenshotSha256 = sha(readFileSync(screenshot));
        record.status = record.httpStatus === 200 &&
          !record.redirectChainPresent &&
          record.path === opts.route && record.finalPath === opts.route &&
          record.origin === new URL(opts.url).origin &&
          record.finalOrigin === new URL(opts.url).origin &&
          errors.length === 0 &&
          !record.markerWaitError && completeSample(first) &&
          completeSample(second) && completeSample(afterScreenshot)
          ? "DOM_SIGNALS_OBSERVED" : "INCOMPLETE";
      } catch (e) {
        record.status = "INCOMPLETE";
        record.error = browserError(e);
        if (e?.message === "DOM sample timeout") {
          record.domSampleTimedOut = true;
          abortAfterViewport = true;
        }
      } finally {
        if (context) {
          try {
            await boundedBrowserCall(() => context.close(), cleanupDeadline,
              "DOM context cleanup timeout");
          } catch (e) {
            record.contextCloseFailed = true;
            record.status = "INCOMPLETE";
            if (e?.message === "DOM context cleanup timeout") {
              record.contextCloseTimedOut = true;
              abortAfterViewport = true;
              stopBrowserProcess(browser);
            }
          }
        }
      }
      if (abortAfterViewport) break;
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
    if (browser) {
      try {
        await boundedBrowserCall(() => browser.close(), cleanupDeadline,
          "DOM browser cleanup timeout");
      } catch (e) {
        report.browserCloseFailed = true;
        if (e?.message === "DOM browser cleanup timeout") {
          report.browserCloseTimedOut = true;
          stopBrowserProcess(browser);
        }
      }
    }
  }
  if (report.browserCloseFailed) {
    report.status = "INCOMPLETE";
    report.declaredDomStateObserved = false;
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
    process.stderr.write("Rendered state probe: " + browserError(e) + "\n");
    process.exitCode = 2;
  }
}
