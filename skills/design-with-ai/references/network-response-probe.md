# Optional browser response-body provenance experiment

This is an **experimental, standalone diagnostic**, not part of the default Design-With-AI provider profile or the DWA completion gate. It complements the local build-tree SHA-256 provenance in #208.

## What the experiment checks

With an explicitly trusted Playwright install and an already running local HTTP server, the probe:

1. Takes a fresh bounded SHA-256 manifest of every regular local file under the declared `--browser-root` (PR #208).
2. Opens the built page at **1440, 768 and 390 px** using separate anonymous Chrome contexts with service workers blocked.
3. Observes Playwright `response` events from **these probe contexts**, reads each local response's actual body bytes and compares its SHA-256 with the corresponding file from the build manifest. The explicit route's document response maps to its declared `index.html`.
4. Records redacted metadata, per-viewport screenshot SHA-256, failed/unmatched responses and a count of requests still in flight **after response draining and context close**. A request unfinished at finalization makes the result `INCOMPLETE`, even if earlier response bodies matched. The report metadata omits response bodies, raw remote URLs, query parameters and credentials. **Screenshots are separate image artifacts and can expose secrets or personal data visible in the page. Keep them private and inspect/redact them before sharing.**
5. Re-hashes the build tree after the browser run and rejects changed build digests.

Example run from an isolated `agent-hub` checkout:

```sh
node skills/design-with-ai/scripts/providers/network-response-probe.mjs \
  --base-url http://127.0.0.1:5191 \
  --route /settings \
  --project-root /safe/fixture \
  --browser-root /safe/fixture/dist \
  --html /safe/fixture/dist/settings/index.html \
  --playwright-root /safe/fixture/node_modules/playwright-core \
  --out-root /safe/evidence
```

If Chrome is not on the default Playwright channel, add `--chrome /absolute/path/to/chrome`.

Output is a unique evidence directory with `network-report.json` plus three screenshots. A missing Playwright/Chrome install fails; the script does **not** download or install a browser.

| Status | Interpretation |
| --- | --- |
| `LOCAL_RESPONSES_MATCHED` | All *observed* local response bodies match their local file hashes at the three probe widths, with no recorded request or page error and an unchanged local asset tree. |
| `LOCAL_MATCHED_EXTERNAL_UNVERIFIED` | Same local match, but at least one **external** browser response was observed and its bytes were intentionally not attested. CLI exit code is nonzero. |
| `INCOMPLETE` | A local response was unmatched, unavailable, too large or altered; a browser request failed or remained unfinished at finalization; or the browser/asset check failed. No source-quality verdict is issued. |

The probe rejects local response bodies above **16 MiB** or when a **128 MiB per-width** capture budget would be exceeded. Before `response.body()`, it reserves the larger of the manifest file size and declared Content-Length; at most **4 concurrent body reads** are started from a **64-item bounded queue**, with a **15-second** deadline. Extra queued responses beyond that capacity fail closed rather than being discarded silently. Because `response.body()` cannot be cancelled, a timeout permanently blocks further body-read starts for that viewport and fails its observation closed. The request and response event caps remain **2,000 per width**. These are application-level safeguards, **not a strict Chrome/Playwright memory cap**: Playwright may buffer data internally before `response.body()` completes, and Content-Length may be missing or misleading. Use only trusted local servers. Request or response overflow fails closed; repeated issue types are deduplicated and page exceptions are counted instead of retained as unbounded strings. Existing rendered asset-tree limits remain in force. Incomplete checks fail closed; no successful result is manufactured from zero observed local responses.

## What it does NOT prove

**This does not run inside Taste Skill's CDP/browser sessions.** It does not verify the frames captured by Taste. The tool always sets `tasteFramesVerified: false`, `authenticatedSessionVerified: false` and `productCompletionEligible: false`.

The probe does not scroll like Taste, does not confirm later lazy fetches, and cannot establish authenticated game state or backend correctness. Remote CDN/API bytes are never treated as locally verified. Service workers are disabled in probe contexts; a normal user session may behave differently.

Unlike #208, this experiment also requires a *trusted running local server*. That server may rewrite/transform content or execute request handlers. The probe makes browser requests and runs page JavaScript, so **it is not a security sandbox or guaranteed side-effect-free**. Use only trusted local test fixtures and do not run it against production accounts.

It is intentionally separate from default DWA execution and the historical evidence ledger. A real Chrome run and independent review are required before considering a future integration with Taste's own browser captures.

## Independent review

The combined Draft #205 has a separately triggered full CodeRabbit review; that review does not review this independent #210 experiment. #210 has no completed independent full CodeRabbit review. In addition to deterministic injected-browser regressions, the browser CI fixture runs **actual Chrome** against a trusted loopback server for matching local HTTP response bodies, intentionally tampered CSS, a never-answered fetch, and a response with completed headers but a deliberately incomplete body. These tests establish only behavior on the isolated fixture; an external review and current-base combined testing are required before any future integration.

All changes stay in `Wibias/agent-hub`; `streamer-content` remains read-only and no PR is merged.
