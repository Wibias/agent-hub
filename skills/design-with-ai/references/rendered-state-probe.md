# Declared runtime-state browser observations (optional pilot)

The standalone `rendered-state-probe.mjs` checks a **specific declared DOM state** in a running local website. This is a supplement to the DWA rendered/browser gate. It does not modify source, start the product backend, reuse a logged-in session or substitute for Taste Skill.

## Contract

Create an explicit contract outside the served build directory, e.g. `/safe/contract.json`:

```json
{
  "schemaVersion": 1,
  "stateKey": "game-live",
  "readySelector": "[data-game-phase='live']",
  "forbiddenSelectors": ["[aria-busy='true']", "[data-loading='true']"],
  "requiredText": ["Playing now"],
  "forbiddenText": ["Loading", "App could not be loaded"]
}
```

The contract **must** use exactly one positive, state-specific `[data-*]` attribute selector. Selector lists, `:not(...)`, ancestor-only conditions and generic `#root`/`main` mounts are rejected because they could succeed without the desired state. Optional `forbiddenSelectors`, `requiredText` and `forbiddenText` arrays default to empty arrays. The caller is responsible for choosing markers that actually represent the expected state. Do not invent marker names or insert them into a product only to make a test pass. Missing markers mean `INCOMPLETE`.

## Run

Requires an **already installed, trusted** Playwright package root containing `index.mjs`, a locally reachable HTTP origin, and either an installed Google Chrome browser (the default `channel: "chrome"`) or an explicit browser executable supplied with `--chrome <path>`. Playwright's bundled Chromium alone does not satisfy the default Chrome channel. No install, download or `npx` is performed.

```sh
node skills/design-with-ai/scripts/providers/rendered-state-probe.mjs \
  --base-url http://127.0.0.1:5191 \
  --route /quiz/survival/live \
  --contract /safe/contract.json \
  --playwright-root /safe/site/node_modules/@playwright/test \
  --out-root /safe/evidence
```

Optionally pass `--chrome /path/to/chrome`. The output root must already exist and should be outside the served build. The current pilot creates **three anonymous, isolated Chrome contexts**, at 1440, 768 and 390 px. For each, it checks exact route and HTTP status, absence of JavaScript page errors, the positive DOM marker, forbidden loading selectors, and required/forbidden **viewport-visible text**, twice with a short stability interval and a third observation immediately after the screenshot. Matching considers any visible state marker (not just the first in DOM order). The text scan is bounded to 3,000 text nodes and 6,000 words and fails closed when truncated. Navigation redirect chains are rejected even when they return to the requested route. It saves a screenshot with a SHA-256 digest and a structured `state-report.json` in a unique evidence folder. A timeout, redirect, incomplete viewport, missing image or missing marker produces `INCOMPLETE`, never scoped success.

## Interpretation

`DOM_SIGNALS_OBSERVED` means only that **the explicitly declared DOM signals were observed in this probe's three fresh anonymous contexts**. The report always says `tasteFramesVerified: false`, `authenticatedSessionVerified: false`, `gamePhaseVerified: false` and `productCompletionEligible: false`. A DOM marker does not prove actual backend state, gameplay correctness or that Taste Skill saw the same state.

The probe does not currently consume Taste screenshots or authenticate against a room/backend. **Do not join its passing status with a separate Taste run to assert that Taste's frames are ready.** A future same-context evidence bridge would need image/URL/viewport correlation and app-specific readiness semantics.

The local browser may load remote assets or execute scripts from the trusted page. It is **not** a security sandbox. The command reads a local contract, loads the explicit trusted Playwright package and sends the browser to loopback only. It does not capture or submit any source file contents. Screenshots can still include sensitive information visible on the local page; keep output private and review artifacts before sharing.

The 2026-11-06 Streamer Content read-only Phase 6.2 probe only established anonymous app mounting for some routes and encountered loading states for others. That evidence does **not** demonstrate a real authenticated live Survival phase. This new pilot formalizes the distinction without changing Streamer Content.
