# UI Prototype

Generate **several radically different UI variations** on a single route, switchable from a floating bottom bar. The user flips between variants in the browser, picks one (or steals bits from each), then throws the rest away.

If the question is about logic/state rather than what something looks like — wrong branch. Use [LOGIC.md](LOGIC.md).

## When this is the right shape

- "What should this page look like?"
- "I want to see a few options for this dashboard before committing."
- "Try a different layout for the settings screen."
- Any time the user would otherwise spend a day picking between three vague mockups in their head.

## Two sub-shapes — strongly prefer sub-shape A

A UI prototype is much easier to judge when it's **butting up against the rest of the app** — real header, real sidebar, real data, real density. A throwaway route on its own is a vacuum: every variant looks fine in isolation. Default to sub-shape A whenever there's a plausible existing page to host the variants. Only reach for sub-shape B if the prototype genuinely has no nearby home.

### Sub-shape A — adjustment to an existing page (preferred)

The route already exists. Variants are rendered **on the same route**, gated by a `?variant=` URL search param. The existing data fetching, params, and auth all stay — only the rendering swaps. This is the default; pick it unless there's a specific reason not to.

If the prototype is for something that doesn't yet have a page but *would naturally live inside one* (a new section of the dashboard, a new card on the settings screen, a new step in an existing flow) — that's still sub-shape A. Mount the variants inside the host page.

### Sub-shape B — a new page (last resort)

Only use this when the thing being prototyped genuinely has no existing page to live inside — e.g. an entirely new top-level surface, or a flow that can't be embedded anywhere sensible.

Create a **throwaway route** following whatever routing convention the project already uses — don't invent a new top-level structure. Name it so it's obviously a prototype (e.g. include the word `prototype` in the path or filename). Same `?variant=` pattern.

Before committing to sub-shape B, sanity-check: is there really no existing page this could be embedded in? An empty route hides design problems that a populated one would expose.

In both sub-shapes the floating bottom bar is identical.

## Process

### 1. State the question and pick N

Default to **3 variants**. More than 5 stops being radically different and starts being noise — cap there.

Write down the plan in one line, in the prototype's location or a top-of-file comment:

> "Three variants of the settings page, switchable via `?variant=`, on the existing `/settings` route."

This works whether the user is here to push back or not.

### 2. Name the divergence before building

Every variant gets a **named divergence axis** before code is written. The name
explains the direction (`Quiet density`, `Editorial hierarchy`, `Command-first`,
`Spatial navigation`) and the axis states what materially differs: layout,
information hierarchy, density, primary affordance, interaction model, or motion
story.

Do not use `A/B/C` as the only design concept. Keys may stay `A/B/C` for routing,
but each key maps to a defensible named direction.

If two proposed variants occupy effectively the same axis position — for example
the same card grid with different accent colors or copy — collapse or replace one
before implementation. Shared product tokens are expected and do not make the
variants insufficiently different.

### 3. Generate radically different variants

Draft each variant. Hold each one to:

- The page's purpose and the data it has access to.
- The project's component library / styling system (TailwindCSS, shadcn, MUI, plain CSS, whatever).
- A clear exported component name, e.g. `VariantA`, `VariantB`, `VariantC`.
- **Realistic content**: production-shaped names, counts, labels, empty/loaded pressure appropriate to the surface — no lorem ipsum or suspiciously convenient demo values.
- **Working interactions** sufficient to judge the direction: controls that are central to the variant actually respond; no dead primary affordance with "imagine this works" handwaving.

Variants must be **structurally different** — different layout, different information hierarchy, different primary affordance, not just different colours. Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out too similar, redo one with an explicit structural constraint such as "do not use a card grid" or "navigation must move out of the header".

Real mutations should remain stubbed/read-only unless the prototype question specifically requires safe behavior. The goal is to evaluate the direction, not accidentally exercise production writes.

### 4. Wire them together

Create a single switcher component on the route:

```tsx
// pseudo-code — adapt to the project's framework
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

For sub-shape A (existing page): keep all the existing data fetching above the switcher; only the rendered subtree changes per variant.

For sub-shape B (new page): the throwaway route under `/prototype/<name>` mounts the same switcher.

### 5. Build the floating switcher

A small fixed-position bar at the bottom-centre of the screen with three pieces:

- **Left arrow** — cycles to the previous variant (wraps around).
- **Variant label** — shows the current variant key plus the named direction, e.g. `B — Editorial hierarchy`.
- **Right arrow** — cycles forward (wraps around).

Behaviour:

- Clicking an arrow updates the URL search param (use the framework's router — `router.replace` on Next, `navigate` on React Router, etc) so the variant is shareable and reload-stable.
- Keyboard: `←` and `→` arrow keys also cycle. Don't intercept arrow keys when an `<input>`, `<textarea>`, or `[contenteditable]` is focused.
- Switching is instant. Variant flipping is a high-frequency diagnostic action; the picker itself gets no decorative transition.
- Visually distinct from the page (e.g. high-contrast pill, subtle shadow) so it's obviously not part of the design being evaluated.
- Hidden in production builds — gate on `process.env.NODE_ENV !== 'production'` or an equivalent check, so a stray prototype merge can't ship the bar to users.

Put the switcher in a single shared component so both sub-shapes can reuse it. Locate it wherever shared UI lives in the project.

### 6. Verify and hand it over

Before presenting the set, flip through every variant yourself and confirm:

- each route/key renders without console errors;
- central working interactions respond;
- realistic content does not accidentally invalidate the comparison;
- variants still occupy meaningfully different positions on their named axes.

When browser tooling exists, capture rendered evidence at the real host size.

Then surface the URL and keys and hand back an honest comparison:

| Variant | Divergence axis | When it wins | Its cost / tradeoff |
|---|---|---|---|
| named direction | what is structurally different | product/context where this direction is strongest | what the user/product gives up |

**When it wins** and **cost / tradeoff** are required. Do not preselect a favorite
unless the user asks which you would choose. The interesting feedback is often
"I want the header from B with the navigation from C" — that's legitimate design
information, not a failure of the prototype.

### 7. Capture the answer and clean up

Once a variant has won, write down which one and why (commit message, ADR, issue, or a `NOTES.md` next to the prototype if running AFK and the user hasn't responded yet). Then:

- **Sub-shape A** — delete the losing variants and the switcher; fold the winner into the existing page.
- **Sub-shape B** — promote the winning variant to a real route, delete the throwaway route and the switcher.

Don't leave variant components or the switcher lying around. They rot fast and confuse the next reader.

## Anti-patterns

- **Variants that differ only in colour or copy.** That's a tweak, not a prototype. Real variants disagree about structure.
- **Unnamed divergence.** If you cannot say what axis separates two variants before building them, they are not ready to become variants.
- **Toy content or dead primary controls.** A direction that works only with kind placeholder data or imagined interactions is not comparable to one that works in the real surface.
- **Sharing too much code between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point. Each variant should be free to throw out the layout.
- **Wiring variants to real mutations.** Read-only prototypes are fine. If a variant needs to mutate, point it at a stub unless the behavior question explicitly requires a safe isolated mutation.
- **Pre-picking the winner.** The handoff explains when each direction wins and what it costs; product preference stays with the user unless they ask for your recommendation.
- **Promoting the prototype directly to production.** The variant code was written under prototype constraints (no tests, minimal error handling). Rewrite it properly when you fold it in.
