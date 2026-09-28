# Design System Selection and Install Reference

Load this file when the brief maps to an official design system or when the user asks
for install commands, canonical docs, or "what package should I use?"

## Decision table: brief -> system

| Brief reads as | Use | Notes |
|---|---|---|
| Microsoft / enterprise SaaS / dashboards | `@fluentui/react-components` | Official Fluent UI v9, accessibility done |
| Google-flavored / Material product | `@material/web` + Material 3 tokens | Official, theme-able |
| IBM-style B2B / enterprise analytics | `@carbon/react` + `@carbon/styles` | Mature data-density patterns |
| Shopify app surfaces | Polaris React / web components | Required for Shopify admin |
| Atlassian / Jira-style product | `@atlaskit/*` + `@atlaskit/tokens` | Official Atlassian DS |
| GitHub-style devtool / community page | `@primer/css` or `@primer/react-brand` | Brand variant for marketing |
| Public-sector UK service | `govuk-frontend` | Legally expected |
| US public-sector / trust-first | `uswds` | Same |
| Fast MVP / agency | Bootstrap 5.3 | Boring, fast, works |
| Modern accessible React foundation | `@radix-ui/themes` | Primitives + polished theme |
| Modern SaaS, owned components | shadcn/ui | Own the code; never ship default state |
| Tailwind-based SaaS / AI marketing | Tailwind v4 + `dark:` | Default for indie / small-team builds |

**One system per project.** Do not mix Fluent + Carbon, or shadcn into a Material app.

**Honesty rule:** if the brief maps to a real system above, install the official package.
Do not recreate its CSS by hand.

If the brief is an aesthetic (glassmorphism, bento, brutalism, editorial), build with
native CSS + Tailwind and label approximations honestly.

## Install commands

Run the install command for your chosen system before any code.

- Material Web: `npm install @material/web`
- Fluent UI React v9: `npm install @fluentui/react-components`
- Fluent UI Web Components: `npm install @fluentui/web-components @fluentui/tokens`
- IBM Carbon: `npm install @carbon/react @carbon/styles`
- Radix Themes: `npm install @radix-ui/themes`
- shadcn/ui init: `npx shadcn@latest init` then `npx shadcn@latest add button card badge`
- Primer CSS: `npm install --save @primer/css`
- Primer Brand: `npm install @primer/react-brand`
- GOV.UK Frontend: `npm install govuk-frontend`
- USWDS: `npm install uswds`
- Atlaskit: `yarn add @atlaskit/css-reset @atlaskit/tokens @atlaskit/button`
- Bootstrap 5.3: `npm install bootstrap`

## Canonical docs

- Fluent UI: https://fluent2.microsoft.design/get-started/develop
- Material Web: https://material-web.dev/theming/material-theming/
- Carbon: https://carbondesignsystem.com/
- Polaris: https://polaris.shopify.com/
- Atlaskit: https://atlassian.design/get-started/develop
- Primer: https://primer.style/
- GOV.UK: https://design-system.service.gov.uk/
- USWDS: https://designsystem.digital.gov/
- Radix Themes: https://www.radix-ui.com/themes/docs/components/theme
- shadcn/ui: https://ui.shadcn.com/docs
- Tailwind v4: https://tailwindcss.com/blog/tailwindcss-v4

## Apple Liquid Glass: web approximation

Apple Liquid Glass is documented for Apple platform APIs only. There is no official
`liquid-glass.css` for the web. Web approximations use `backdrop-filter`, layered
borders, and highlight overlays. Label as approximation in code comments.

Minimal CSS skeleton:

 .liquid-glass-approx {
 position: relative;
 isolation: isolate;
 overflow: hidden;
 border: 1px solid rgb(255 255 255 / .32);
 background:
 linear-gradient(135deg, rgb(255 255 255 / .30), rgb(255 255 255 / .08)),
 rgb(255 255 255 / .12);
 backdrop-filter: blur(24px) saturate(180%) contrast(1.05);
 -webkit-backdrop-filter: blur(24px) saturate(180%) contrast(1.05);
 box-shadow: inset 0 1px 0 rgb(255 255 255 / .48), 0 18px 60px rgb(0 0 0 / .18);
 }
 @media (prefers-reduced-transparency: reduce) {
 .liquid-glass-approx {
 background: rgb(255 255 255 / .96);
 backdrop-filter: none;
 }
 }

Official Apple docs (Apple platforms only):
- https://developer.apple.com/design/human-interface-guidelines/materials
- https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass

---

## Icon policy

Do not turn one icon library into the next universal default. The visual system
chooses a family; the library name is only one input.

Selection order:

1. **Existing system wins.** Preserve the project's coherent family when one is
   already established. Do not migrate Lucide, Phosphor, or Nucleo merely to
   make the code look less AI-generated.
2. **User or brand direction wins.** A named family, supplied icon assets, or a
   locked visual identity outranks this shortlist.
3. **Greenfield shortlist.** If no family exists, compare exactly the candidates
   relevant to the brief: `lucide-react`, `@phosphor-icons/react`, and Nucleo.
   Choose one based on visual weight, available coverage, framework support,
   accessibility, bundle behavior, licensing, and brand fit.
4. **Record the decision.** Note the chosen family, weights/stroke treatment,
   license/assets, and why the alternatives were rejected in the design brief.

Candidate guidance:

- **Lucide**: strong continuity choice when already installed or when a clean
  outline family is explicitly wanted. Thin uniform strokes are not a reason to
  reject an existing system by themselves.
- **Phosphor**: strong open-source React candidate when multiple weights or a
  warmer, more expressive family fit the brief.
- **Nucleo**: valid when the project has the required license, source assets,
  and a deliberate Nucleo visual direction. It is not a universal default.

Rules:

- **One family per project or bounded product surface.** Never mix packs casually;
  a temporary migration boundary must be explicit.
- Standardize weight/stroke treatment globally for the chosen family.
- No emoji-as-icon. No hand-rolled sketchy SVG scenes as illustration fallback.
- **Bare marks preferred** - icon-in-colored-tile is a slop tell (pols.dev).
  Logos without box tiles.
- Brand/social/customer marks: real official SVGs only; never invent logos.
- Over-correcting to zero icons is also a tell when icons would earn legitimacy.
- Treat commercial or ambiguous libraries as project assets: verify the exact
  package, license, framework support, and source assets before recommending or
  adding them.

## Aesthetic honesty (not systems)

| Aesthetic | Honest build |
|---|---|
| Glassmorphism | backdrop-filter + solid fallback; only over real backdrop |
| Bento | CSS Grid mixed spans - no library |
| Brutalism | Native CSS, mono optional, raw borders |
| Editorial | Type-led, asymmetric; only if brief is editorial |
| Dark tech | Mono sparingly; no indigo-slate costume default |
| Apple Liquid Glass | Approximation only - label as such |

## Dependency verification

Before importing a third-party UI/motion library, check `package.json`. If missing,
output install command first. Never assume Motion/GSAP/shadcn exist.
