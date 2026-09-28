# Taste DNA - reverse-engineer a reference

Use when the user wants to study a URL, screenshot, or competitor and turn it
into actionable design guidance - not when scraping content or summarizing text.

## Output pair

1. **Design Map** - concrete tokens: colors (hex/OKLCH + roles), type scale,
 spacing, radii, shadows, grid, motion notes.
2. **Taste DNA** - 3-4 principles as:

```
Trigger → Decision → Reason → Evidence
```

At least one principle must be a **Restraint** trade-off (what they refused).

Reject adjectives: clean, modern, sleek, elegant, minimalist, premium,
polished, beautiful, user-friendly, seamless, intuitive - unless quoting a foil.

Self-test: *Could this principle be written without seeing this specific site?*
If yes, delete it.

## Capture order

1. Prefer live browser (Playwright MCP / screenshot tools) at **1440×900**.
2. Viewport screenshot = primary visual ground truth.
3. Optional: extract computed styles / DOM samples for exact fonts and colors.
4. If SPA shell / auth wall / bot block: stop, ask for screenshot, do not invent.

**Screenshot beats DOM** when they conflict. Colors covering <5% of surface
are decorative, not brand.

## Analysis steps

### Step 1 - Measure

Cite specific values: px, hex/OKLCH, ratios. Categories: palette, type roles,
spacing scale, radius system, elevation, grid, density, motion, imagery,
chrome (nav/footer), content voice.

### Step 2 - Pattern

5-8 patterns: Pattern / Evidence / Design Goal.

### Step 3 - Taste

4 principles with Trigger / Decision / Reason / Evidence. Include restraint.

### Step 4 - Ship artifacts

Write `{domain}.md` + optional `{domain}.json` in the working project when the
user wants files. Never claim "clean modern aesthetic".

## Anti-slop pass on output

Grep the markdown for banned vibe words. Foil quotes OK ("they rejected a
'clean modern' look…"). Positive descriptors of *this* design must be concrete.

## Mimicry ethics

- Extract **DNA** (decisions, ratios, restraints) - never pixel-clone brand
 assets, logos, or proprietary illustrations.
- Template-marketplace / theme-store URLs: refuse as DNA sources.
- When emitting a portable `DESIGN.md` from a third-party site, only if the
 user owns the brand or is using it as a non-copying reference for their own
 product - say so in the file header.

## Handoff into build

After DNA extraction, building uses the normal skill workflow with
**studied-DNA** theme route: diversification suspended; tokens and
macrostructure come from the DNA, adapted to the user's content.
