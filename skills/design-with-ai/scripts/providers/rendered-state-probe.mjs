#!/usr/bin/env node
// Explicit, read-only browser observations for a declared UI state.
// This is independent of Taste's browser contexts and cannot attest Taste's frames.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchOwnedBrowser, terminateOwnedBrowser } from "./browser-server-lifecycle.mjs";
import { pathToFileURL, fileURLToPath } from "node:url";

const WIDTHS = Object.freeze([1440, 768, 390]);
const H = 900;
const SAMPLE_LIMIT_MS = 10_000;
const CLEANUP_LIMIT_MS = 15_000;
const MARKER_WAIT_LIMIT_MS = 16_000;
const STAGE_LIMIT_MS = 50_000;
const STAGE_TIMEOUT_PREFIX = "Browser stage timeout: ";
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
  const intersectsVisible = (rect, element, requireFullRect = false) => {
    if (!inViewport(rect)) return false;
    let left = Math.max(0, rect.left);
    let right = Math.min(innerWidth, rect.right);
    let top = Math.max(0, rect.top);
    let bottom = Math.min(innerHeight, rect.bottom);
    // A range's unclipped CSSOM rectangle can lie inside a zero-height or
    // scroll-clipped ancestor. Intersect with each actual clipping ancestor.
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clipPath = style.clipPath ?? style.webkitClipPath;
      // Arbitrary CSS clip geometry (circles, polygons, inset, SVG paths)
      // cannot be proved by CSSOM rectangles. Abstain rather than accepting
      // a DOM marker or a text glyph hidden outside the painted clip region.
      if (clipPath && clipPath !== "none" &&
          !/^inset\(\s*0(?:px|%)?\s*\)$/i.test(clipPath)) return false;
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
    if (requireFullRect) {
      const tolerance = 0.5;
      return left <= rect.left + tolerance && right >= rect.right - tolerance &&
        top <= rect.top + tolerance && bottom >= rect.bottom - tolerance;
    }
    return right > left && bottom > top;
  };
  const shown = (element) =>
    visibleStyle(element) && Boolean(element.getBoundingClientRect) &&
    intersectsVisible(element.getBoundingClientRect(), element);
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
      // Only ordinary inline and box-less contents can continue a word run.
      // Buttons, inline-block, inline-flex, table cells and other boxes divide words.
      const display = getComputedStyle(node).display ?? "";
      if (display !== "inline" && display !== "contents") return node;
    }
    return null;
  };
  if (requiredText.length || forbiddenText.length) {
    const walker = document.createTreeWalker(document.body,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node, nodes = 0, words = 0, charsChecked = 0;
    while ((node = walker.nextNode()) !== null) {
      // Preserve the original bounded 3000-node proof limit. Element visits
      // for visible BR boundaries also count against this limit.
      if (++nodes > 3000) { textTruncated = true; break; }
      // nodeType=1 is the standard ELEMENT_NODE value. Do not require a
      // Node global: the same pure sampler runs in Node fixture DOM shims.
      if (node.nodeType === 1) {
        // A visible <br> separates words even without a literal text node.
        // Adjacent inline spans without a break still form one word.
        if (node.tagName === "BR" && visibleStyle(node) &&
            node.parentElement?.getBoundingClientRect &&
            intersectsVisible(node.parentElement.getBoundingClientRect(),
              node.parentElement)) pendingGap = true;
        continue;
      }
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
        // A token-range rectangle can intersect the viewport even when
        // all but one glyph is clipped. Require every glyph range to fit
        // the visible viewport/overflow geometry; ambiguous partial text
        // fails the whole observation closed, including forbidden phrases.
        if (match[0].length > 1024 || charsChecked + match[0].length > 30_000) {
          textTruncated = true;
          break;
        }
        charsChecked += match[0].length;
        let anyVisible = false;
        let allVisible = true;
        for (let offset = match.index; offset < match.index + match[0].length; offset++) {
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const glyphRects = [...range.getClientRects()];
          const glyphVisible = glyphRects.some((rect) =>
            intersectsVisible(rect, node.parentElement));
          const glyphFullyVisible = glyphRects.some((rect) =>
            intersectsVisible(rect, node.parentElement, true));
          if (glyphVisible) anyVisible = true;
          if (!glyphFullyVisible) allVisible = false;
        }
        if (anyVisible && !allVisible) textTruncated = true;
        if (allVisible) {
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
  stageTimeoutMs = STAGE_LIMIT_MS,
} = {}) {
  const opts = validateOptions(input);
  const sampleDeadline = cappedDeadline(sampleTimeoutMs, SAMPLE_LIMIT_MS);
  const cleanupDeadline = cappedDeadline(cleanupTimeoutMs, CLEANUP_LIMIT_MS);
  const stageDeadline = cappedDeadline(stageTimeoutMs, STAGE_LIMIT_MS);
  const stage = (name, call) => boundedBrowserCall(call, stageDeadline,
    STAGE_TIMEOUT_PREFIX + name);
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
  let browser, browserServer;
  try {
    const chromium = await stage("factory", () => browserFactory(opts.playwright));
    const owned = await launchOwnedBrowser(chromium, {
      headless: true,
      ...(opts.chromePath ? { executablePath: opts.chromePath } : { channel: "chrome" }),
      args: ["--no-first-run", "--no-default-browser-check"],
    }, stage, { allowInjectedLaunch: browserFactory !== loadPlaywright });
    browser = owned.browser;
    browserServer = owned.server;
    for (const width of WIDTHS) {
      const record = { width, status: "INCOMPLETE", signals: null, screenshotSha256: null };
      report.observations.push(record);
      let context;
      let pageErrorCount = 0;
      const pageErrorSamples = [];
      let mainFrameNavigations = 0;
      let secondaryPageOpened = false;
      let observationSealed = false;
      let abortAfterViewport = false;
      try {
        context = await stage("new-context", () => browser.newContext({
          viewport: { width, height: H },
          serviceWorkers: "block", storageState: { cookies: [], origins: [] },
        }));
        // Subscribe before opening the primary page: popups and their errors
        // belong to this viewport, even if the main page stays ready. Keep
        // only an opaque boolean, never popup URLs or private page contents.
        const seenPages = new Set();
        const observePage = (candidate) => {
          if (seenPages.has(candidate)) return;
          if (seenPages.size > 0) secondaryPageOpened = true;
          seenPages.add(candidate);
          candidate.on("pageerror", (error) => {
            if (observationSealed) return;
            pageErrorCount++;
            if (pageErrorSamples.length < 3) pageErrorSamples.push(browserError(error));
          });
        };
        context.on("page", observePage);
        const page = await stage("new-page", () => context.newPage());
        observePage(page); // Idempotent when Playwright already emitted "page".
        // Register before goto: count main-frame navigations even when JS
        // leaves and returns to the requested route during the observation.
        const mainFrame = page.mainFrame();
        page.on("framenavigated", (frame) => {
          if (!observationSealed && frame === mainFrame) mainFrameNavigations++;
        });
        const response = await stage("navigate", () => page.goto(opts.url,
          { waitUntil: "domcontentloaded", timeout: 45_000 }));
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
          await boundedBrowserCall(() => page.waitForFunction(snapshotDeclaredDomState,
            { readySelector: opts.contract.readySelector, markerOnly: true },
            { timeout: 15_000 }), MARKER_WAIT_LIMIT_MS, "DOM marker wait timeout");
        } catch (e) {
          record.markerWaitError = browserError(e);
          if (e?.message === "DOM marker wait timeout") {
            abortAfterViewport = true;
            record.markerWaitTimedOut = true;
            throw e;
          }
        }
        const sampleDom = () => boundedBrowserCall(
          () => page.evaluate(snapshotDeclaredDomState, opts.contract),
          sampleDeadline, "DOM sample timeout");
        // A main-frame navigation can destroy the first evaluation context.
        // Do not erase later valid observations; retain a fixed error label
        // and make this viewport INCOMPLETE even if later markers reappear.
        let first = null;
        try { first = await sampleDom(); }
        catch (error) {
          record.firstSampleError = browserError(error);
          if (error?.message === "DOM sample timeout") throw error;
        }
        await stage("settle", () => page.waitForTimeout(750));
        const second = await sampleDom();
        const screenshot = join(runDir, "state-" + width + ".png");
        await stage("screenshot", () => page.screenshot(
          { path: screenshot, fullPage: false, timeout: 20_000 }));
        // Sample once more AFTER screenshot so an immediately dismissed loading
        // overlay or state transition is not certified as captured evidence.
        const afterScreenshot = await sampleDom();
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
        if (typeof e?.message === "string" && e.message.startsWith(STAGE_TIMEOUT_PREFIX)) {
          record.browserStageTimeout = e.message.slice(STAGE_TIMEOUT_PREFIX.length);
          abortAfterViewport = true;
          terminateOwnedBrowser(browser, browserServer);
        }
        if (e?.message === "DOM sample timeout") {
          record.domSampleTimedOut = true;
          abortAfterViewport = true;
        }
      } finally {
        // A context can dispatch page errors and navigations during close.
        // Do not award success until those events have been observed.
        if (context) {
          try {
            await boundedBrowserCall(() => context.close(), cleanupDeadline,
              "DOM context cleanup timeout");
          } catch (e) {
            record.contextCloseFailed = true;
            if (e?.message === "DOM context cleanup timeout") {
              record.contextCloseTimedOut = true;
              abortAfterViewport = true;
              terminateOwnedBrowser(browser, browserServer);
            }
          }
        }
        observationSealed = true;
      }
      record.mainFrameNavigationCount = mainFrameNavigations;
      record.secondaryPageOpened = secondaryPageOpened;
      record.pageErrorCount = pageErrorCount;
      if (pageErrorSamples.length) record.pageErrorSamples = pageErrorSamples;
      const { first, second, afterScreenshot } = record.signals ?? {};
      const expectedOrigin = new URL(opts.url).origin;
      record.status = !record.error && !record.contextCloseFailed &&
        record.httpStatus === 200 && !record.redirectChainPresent &&
        mainFrameNavigations === 1 && record.path === opts.route &&
        record.finalPath === opts.route && record.origin === expectedOrigin &&
        record.finalOrigin === expectedOrigin && pageErrorCount === 0 &&
        !secondaryPageOpened &&
        /^[0-9a-f]{64}$/.test(record.screenshotSha256 ?? "") &&
        !record.markerWaitError && !record.firstSampleError && completeSample(first) &&
        completeSample(second) && completeSample(afterScreenshot)
        ? "DOM_SIGNALS_OBSERVED" : "INCOMPLETE";
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
    if (typeof e?.message === "string" && e.message.startsWith(STAGE_TIMEOUT_PREFIX)) {
      report.browserStageTimeout = e.message.slice(STAGE_TIMEOUT_PREFIX.length);
      terminateOwnedBrowser(browser, browserServer);
    }
  } finally {
    if (browser) {
      try {
        await boundedBrowserCall(() => browser.close(), cleanupDeadline,
          "DOM browser cleanup timeout");
      } catch (e) {
        report.browserCloseFailed = true;
        if (e?.message === "DOM browser cleanup timeout") {
          report.browserCloseTimedOut = true;
          terminateOwnedBrowser(browser, browserServer);
        }
      }
    }
    if (browserServer) {
      try {
        await boundedBrowserCall(() => browserServer.close(), cleanupDeadline,
          "DOM browser server cleanup timeout");
      } catch (e) {
        report.browserCloseFailed = true;
        if (e?.message === "DOM browser server cleanup timeout") {
          report.browserServerCloseTimedOut = true;
        }
        terminateOwnedBrowser(browser, browserServer);
      }
    }
  }
  // The outcome is finalized only after browser shutdown: otherwise a
  // successful three-width screenshot could conceal a hung close.
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
