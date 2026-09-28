# Preset: Premium Agency (Awwwards-Tier / "$150k Build")

High-end agency digital experiences: haptic depth, cinematic spatial rhythm,
obsessive micro-interactions, fluid spring motion. Apple-esque / Linear-tier
language. Never generate the same layout or aesthetic twice in a row.

## Instant-fail anti-patterns

- Fonts: Inter, Roboto, Arial, Open Sans, Helvetica as-is. Reach for premium faces (Clash Display, PP Editorial New, Cabinet Grotesk, Satoshi, or a brand face).
- Icons: thick-stroked Lucide, FontAwesome, Material Icons. Ultra-light precise lines only (Phosphor Light, Remix Line).
- Generic 1px solid gray borders; harsh dark drop shadows (`shadow-md`, `rgba(0,0,0,0.3)`).
- Edge-to-edge sticky navbars glued to the top; symmetric Bootstrap-style 3-column grids without massive whitespace.
- `linear` / `ease-in-out` transitions; instant state changes.

## Vibe archetypes (pick 1)

1. **Ethereal Glass (SaaS/AI/tech):** deepest OLED black `#050505`, subtle radial mesh orbs in the background, vantablack cards with heavy `backdrop-blur-2xl` and `white/10` hairlines, wide geometric grotesk type.
2. **Editorial Luxury (lifestyle/real estate/agency):** warm creams `#FDFBF7`, muted sage or deep espresso, high-contrast variable serif for massive headings, CSS noise/film-grain overlay at `opacity-[0.03]` for paper feel.
3. **Soft Structuralism (consumer/health/portfolio):** silver-grey or white backgrounds, massive bold grotesk type, airy floating components with extremely soft diffused ambient shadows.

## Layout archetypes (pick 1)

1. **Asymmetrical Bento:** masonry-like grid of varying spans (`col-span-8 row-span-2` next to stacked `col-span-4`). Mobile: single column, `gap-6`, all spans reset.
2. **Z-Axis Cascade:** elements stacked like physical cards, slight overlaps, `-2deg`/`3deg` rotations breaking the digital grid. Mobile: remove rotations and overlaps below 768px (touch-target conflicts).
3. **Editorial Split:** massive typography on the left half, interactive horizontal image pills or staggered cards on the right. Mobile: full-width vertical stack, type on top.

Universal mobile override: asymmetric layouts collapse to `w-full px-4 py-8` below 768px; `min-h-[100dvh]`, never `h-screen`.

## Haptic micro-aesthetics

- **Double-bezel (nested architecture):** premium cards never sit flat. Outer shell: subtle background (`bg-black/5` or `bg-white/5`), hairline ring (`ring-1 ring-black/5`), padding `p-1.5`/`p-2`, large radius `rounded-[2rem]`. Inner core: own background, inner highlight (`shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]`), concentric smaller radius `rounded-[calc(2rem-0.375rem)]`. Reads like a glass plate in an aluminum tray.
- **Island buttons:** primary CTAs are full pills (`rounded-full px-6 py-3`). A trailing arrow never sits naked: nest it in its own circular wrapper (`w-8 h-8 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center`) flush with the button's right inner padding.
- **Spatial rhythm:** double standard padding - `py-24` to `py-40` sections; the design breathes heavily.
- **Eyebrow tags:** microscopic pill badge (`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-medium`) before major headings - subject to the global eyebrow-count cap in SKILL.md.

## Motion choreography

- All motion simulates mass: custom beziers like `duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]`.
- **Fluid island nav:** floating glass pill detached from the top (`mt-6 mx-auto w-max rounded-full`). Hamburger lines fluidly rotate/translate into a perfect X (`rotate-45`/`-rotate-45`, absolute positioning). Menu opens as a screen-filling `backdrop-blur-3xl bg-black/80` overlay; links stagger in (`translate-y-12 opacity-0` to resolved, `delay-100/150/200`).
- **Magnetic button physics:** `active:scale-[0.98]` press; nested icon circle translates diagonally (`group-hover:translate-x-1 group-hover:-translate-y-[1px]`) and scales `105` for internal kinetic tension.
- **Scroll interpolation:** entries execute a heavy fade-up (`translate-y-16 blur-md opacity-0` resolving over 800ms+). IntersectionObserver or `whileInView`; never scroll listeners.

## Performance guardrails

- Animate transform + opacity only; `will-change` only on actively animating elements.
- `backdrop-blur` only on fixed/sticky elements, never scrolling containers or large content areas.
- Grain/noise on fixed `pointer-events-none` pseudo-elements only.
- Z-index reserved for systemic layers (nav, modal, overlay, tooltip); no `z-[9999]`.

## Execution sequence

1. Silently roll the variance engine: pick vibe + layout archetype from context.
2. Scaffold background texture, macro-whitespace scale, massive type sizes.
3. Architect the DOM with double-bezel enclosures and squircle radii (`rounded-[2rem]`).
4. Choreograph custom beziers, staggered nav reveals, button-in-button physics.
5. Final read: does it feel like a "$150k agency build" or a "template with nice fonts"? Only ship the former.
