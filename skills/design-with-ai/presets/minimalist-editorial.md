# Preset: Minimalist Editorial (Premium Utilitarian Minimalism)

Clean, document-style interfaces analogous to top-tier workspace platforms
(Notion-adjacent, editorial). Warm monochrome palette, extreme typographic
contrast, meticulous macro-whitespace, ultra-flat components, deliberate muted
pastel accents. Rejects generic SaaS trends.

## Banned in this preset

- Inter, Roboto, Open Sans typefaces.
- Thin-line icon sets (Lucide, Feather, stock Heroicons).
- Tailwind default heavy shadows (`shadow-md`/`lg`/`xl`). Shadows must be
 near-invisible: ultra-diffuse, opacity < 0.05.
- Primary-colored backgrounds for large sections (no bright blue/green/red heroes).
- Gradients, neon, 3D glassmorphism (beyond a subtle navbar blur).
- `rounded-full` on large containers, cards, or primary buttons.
- Emojis anywhere; placeholder names (John Doe, Acme, Lorem Ipsum); AI copy
 cliches (Elevate, Seamless, Unleash, Next-Gen, Delve).

## Typography

- **Body/UI/buttons (sans):** `'SF Pro Display', 'Geist Sans', 'Helvetica Neue', 'Switzer', sans-serif`.
- **Hero headings and quotes (editorial serif):** `'Lyon Text', 'Newsreader', 'Playfair Display', 'Instrument Serif', serif`; tight tracking (`-0.02em` to `-0.04em`), tight leading (`1.1`).
- **Mono (code, keystrokes, metadata):** `'Geist Mono', 'SF Mono', 'JetBrains Mono', monospace`.
- Body text never `#000000`: off-black `#111111` or `#2F3437`, `line-height: 1.6`. Secondary text muted gray `#787774`.

Note: this preset intentionally allows serif display and Geist/SF stacks as its
own house style; the general banlist in SKILL.md yields to an explicit preset
request.

## Color palette (warm monochrome + spot pastels)

Color is scarce; use only for semantic meaning or subtle accents.

- Canvas: pure white `#FFFFFF` or warm bone `#F7F6F3` / `#FBFBFA`.
- Card surface: `#FFFFFF` or `#F9F9F8`.
- Borders/dividers: ultra-light `#EAEAEA` or `rgba(0,0,0,0.06)`.
- Accents, washed-out pastels only (tags, inline code, icon backgrounds):
 - Pale Red `#FDEBEC` (text `#9F2F2D`)
 - Pale Blue `#E1F3FE` (text `#1F6C9F`)
 - Pale Green `#EDF3EC` (text `#346538`)
 - Pale Yellow `#FBF3DB` (text `#956400`)

## Components

- **Bento grids:** asymmetric CSS Grid; cards `border: 1px solid #EAEAEA`; crisp radius `8-12px` max; generous internal padding (`24-40px`).
- **Primary CTA:** solid `#111111` background, white text, radius `4-6px`, no box-shadow. Hover shifts to `#333333` or `scale(0.98)`.
- **Tags/badges:** pill-shaped, `text-xs` uppercase with `letter-spacing: 0.05em`, muted-pastel backgrounds.
- **Accordions (FAQ):** no container boxes; items separated by `border-bottom: 1px solid #EAEAEA`; sharp `+`/`-` toggle glyphs.
- **Keystroke micro-UIs:** `<kbd>` rendered as physical keys - `1px solid #EAEAEA`, radius `4px`, background `#F7F6F3`, mono font.
- **Faux-OS window chrome:** software mockups wrapped in a minimalist container with a white top bar and three small light-gray circles (macOS controls).

## Iconography and imagery

- Icons: Phosphor (Bold or Fill weights) or Radix UI Icons - slightly thicker, technical stroke; standardized across the page.
- Illustrations: monochrome continuous-line ink sketches on white, one offset geometric shape filled with a muted pastel.
- Photography: desaturated, warm-toned; subtle warm-grain overlay (`opacity: 0.04`) to blend into the palette. `https://picsum.photos/seed/{context}/1200/800` when assets are missing.
- Sections must not feel empty and flat: low-opacity full-width imagery, soft warm radial light spots (`opacity: 0.03`), or minimal geometric line patterns for depth.

## Motion (invisible, never distracting)

- Scroll entry: `translateY(12px) + opacity: 0` resolving over `600ms` with `cubic-bezier(0.16, 1, 0.3, 1)`; IntersectionObserver, never scroll listeners.
- Hover: card shadow shifts from none to `0 2px 8px rgba(0,0,0,0.04)` over `200ms`; buttons `scale(0.98)` on `:active`.
- Staggered reveals: `animation-delay: calc(var(--index) * 80ms)`.
- Optional ambient: one very slow radial blob (`20s+`, opacity `0.02-0.04`) on a `position: fixed; pointer-events: none` layer behind the hero.
- Transform + opacity only; `will-change` sparingly.

## Execution order

1. Macro-whitespace first: `py-24`/`py-32` between sections.
2. Constrain main typographic content to `max-w-4xl`/`max-w-5xl`.
3. Apply the typographic hierarchy and monochrome variables immediately.
4. Every card, divider, and border adheres to the `1px solid #EAEAEA` rule.
5. Scroll-entry animations on all major blocks.
6. Visual depth in every section (imagery, ambient light, texture) - no empty flat backgrounds.
