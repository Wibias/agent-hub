# Settled reference-page capture (conditional)

Use when a public or user-authorized reference page is long, lazy-loaded, scroll-animated, canvas-heavy, or visually incomplete in a one-shot full-page screenshot. Inspired by MengTo's MIT-licensed stitched-full-page-capture procedure, reviewed at commit `3cc93458c4949c39a04e938ea7892a1d6d3d40bf` (2026-11-18). This is an evidence acquisition method, not a new DWA design owner or a claim that a screenshot proves an interactive flow.

## Existing browser owner

Use the already selected `skills/playwright/SKILL.md` browser workflow and the active host's permitted browser. Do not install a browser, create a separate automation stack, defeat an anti-bot wall, scrape a forbidden gallery, or copy paid/restricted reference assets. Stop if access or reuse rights are missing. Browser page scripts may make network requests; inspect only authorized pages and keep private project data out of external captures.

## Capture procedure

1. Confirm the exact live page URL, reference purpose, permitted capture/reuse, viewport dimensions, route/state, and timestamp. Screenshot the *page*, not a marketplace cover or preview thumbnail. Source page access does not establish redistribution rights.
2. Drive a real scroll top-to-bottom to warm lazy media and section observers. Return to the top. If infinite scroll prevents a stable page height, or authentication/interaction state cannot be reached, record the coverage limit and stop rather than saying full-page evidence exists.
3. Read the settled document height and viewport dimensions from the page. At successive scroll positions, wait for the actual section/media to render and settle, then take **viewport** screenshots (PNG). Scroll in steps smaller than viewport height so segments overlap. Capture the footer and last visible section; check any pinned/sticky controls in multiple scroll positions. A fixed timeout can be an upper bound but cannot independently prove readiness.
4. Preserve each screenshot with its `top` (actual scrollY), `bottom` (min(scrollY + viewport height, document height)), and `settled` observation in a manifest. If scrolling is clamped near the bottom, use the actual reported scrollY instead of the requested position. Keep the raw viewport screenshots.
5. Optionally stitch the settled viewport screenshots with an explicitly trusted image tool, cropping repeated overlap. A native single-shot `fullPage` screenshot is a **comparison candidate**, not the stitch source, unless checked and found equivalent. Check sticky elements to avoid repeated headers or overlays in the composite.
6. Inspect the images at the actual presentation size. Reject blank/gray bands, missing lazy sections, repeated sticky elements, broken crops, unrendered fonts and disagreement with a screen recording. Re-capture only affected positions.
7. Run the local manifest geometry check below. A green geometry result does **not** certify actual pixels, visual completeness, provenance, permission, or usability. A human/agent must review the capture in addition to the geometry result.

## Machine-readable capture manifest

Store a manifest in the same private directory as the screenshots. All image paths are relative to that directory, and the screenshot dimensions must match the viewport.

```json
{
  "schemaVersion": 1,
  "sourceUrl": "https://example.org/reference",
  "capturedAt": "2026-11-18T18:00:00Z",
  "viewport": { "width": 1440, "height": 900 },
  "documentHeight": 2300,
  "segments": [
    { "file": "top.png", "top": 0, "bottom": 900, "settled": true },
    { "file": "middle.png", "top": 700, "bottom": 1600, "settled": true },
    { "file": "lower.png", "top": 1400, "bottom": 2300, "settled": true }
  ],
  "stitchedFile": "composite.png"
}
```

Omit `stitchedFile` if the merged image does not exist. Never claim that overlapping segments are already stitched. On any gap, repeated scroll position, missing image, unexpected dimensions, untrusted path or incomplete endpoint, the validator blocks coverage:

```shell
node skills/design-with-ai/scripts/reference-capture-check.mjs --manifest <private-capture-folder>/manifest.json --json
```

The validator checks bounded geometry, PNG file headers and paths only. It does not parse screenshot pixels, attest the recorded URL or infer that a page's delayed content actually finished rendering. If the page's content changes between scroll positions (e.g. a virtual list), inspect its states explicitly rather than treating a single tall image as authoritative.

Keep captures in the project's approved private evidence/cache location and respect licensing, sensitive data, retention and original source attribution. Do not commit third-party screenshots to AgentHub's shared reference catalog. They enter that catalog only through its existing candidate/reviewer workflow.
