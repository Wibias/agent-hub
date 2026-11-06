# Optional browser response-body provenance experiment

This is an **experimental, standalone diagnostic**, not part of the default Design-With-AI provider profile or the DWA completion gate. It complements the local build-tree SHA-256 provenance in #208.

## What the experiment checks

With an explicitly trusted Playwright install and an already running local HTTP server, the probe:

1. Takes a fresh bounded SHA-256 manifest of every regular local file under the declared `--browser-root` (PR #208).
2. Opens the built page at **1440, 768 and 390 px** using separate anonymous Chrome contexts with service workers blocked.
3. Observes Playwright `response` events from **these probe contexts**, reads each local response's actual body bytes and compares its SHA-256 with the corresponding file from the build manifest. The explicit route's document response maps to its declared `index.html`.
4. Records redacted metadata, per-viewport screenshot SHA-256, failed/unmatched responses and a count of requests still in flight at capture time. A known unfinished request makes the result `INCOMPLETE`, even if earlier response bodies matched. Does not save response bodies, raw remote URLs, query parameters or credentials.
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
| `INCOMPLETE` | A local response was unmatched, unavailable, too large or altered; a browser request failed or remained unfinished at capture; or the browser/asset check failed. No source-quality verdict is issued. |

Each response body is limited to **16 MiB**, response count to **2,000 per width**, and cumulative local body bytes to **128 MiB per width**. Existing rendered asset-tree limits remain in force. Incomplete checks fail closed; no successful result is manufactured from zero observed local responses.

## What it does NOT prove

**This does not run inside Taste Skill's CDP/browser sessions.** It does not verify the frames captured by Taste. The tool always sets `tasteFramesVerified: false`, `authenticatedSessionVerified: false` and `productCompletionEligible: false`.

The probe does not scroll like Taste, does not confirm later lazy fetches, and cannot establish authenticated game state or backend correctness. Remote CDN/API bytes are never treated as locally verified. Service workers are disabled in probe contexts; a normal user session may behave differently.

Unlike #208, this experiment also requires a *trusted running local server*. That server may rewrite/transform content or execute request handlers. The probe makes browser requests and runs page JavaScript, so **it is not a security sandbox or guaranteed side-effect-free**. Use only trusted local test fixtures and do not run it against production accounts.

It is intentionally separate from default DWA execution and the historical evidence ledger. A real Chrome run and independent review are required before considering a future integration with Taste's own browser captures.

## Independent review

A manual CodeRabbit review was requested on the combined Draft #205. That external review has not yet reported results. This experiment adds deterministic unit/negative tests, but mocked browser evidence is **not** a real Chrome network verification.

All changes stay in `Wibias/agent-hub`; `streamer-content` remains read-only and no PR is merged.
