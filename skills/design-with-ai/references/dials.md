# Design dials

Three 1-10 dials gate layout, motion, and density. Set after Design Read.
State values aloud: `dials: V#/M#/D#`.

| Dial | 1 | 10 |
|---|---|---|
| `DESIGN_VARIANCE` | symmetric, calm | asymmetric, artsy |
| `MOTION_INTENSITY` | static | cinematic / physics |
| `VISUAL_DENSITY` | gallery air | cockpit packed |

## Use-case presets

| Use case | V | M | D |
|---|---|---|---|
| Landing SaaS mainstream | 7 | 6 | 4 |
| Landing agency / creative | 9 | 8 | 3 |
| Landing premium consumer | 7 | 6 | 3 |
| Portfolio designer / studio | 8 | 7 | 3 |
| Portfolio developer | 6 | 5 | 4 |
| Editorial / blog | 6 | 4 | 3 |
| Public-sector / trust-first | 3 | 2 | 5 |
| Product tool / dashboard | 4 | 3 | 6 |
| Atmospheric / generative / late-night | 8 | 8 | 3 |
| Redesign preserve | match | match+1 | match |
| Redesign overhaul | +2 from match | +2 | match |

## Signal inference

| Signal words | Bias |
|---|---|
| minimalist, calm, Linear-style | V5-6 M3-4 D2-3 |
| premium, Apple-y, luxury | V7-8 M5-7 D3-4 |
| playful, Awwwards, experimental | V9-10 M8-10 D3-4 |
| accessibility-critical, regulated | V3-4 M2-3 D4-5 |

Baseline marketing when unclear: **8 / 6 / 4**.

## How dials drive output

- **V <= 4:** centered / symmetric OK; fewer layout families.
- **V > 4:** anti-center bias; asymmetric heroes; break equal card grids.
- **M <= 3:** static or micro only; reduced-motion path trivial.
- **M > 3:** `prefers-reduced-motion` mandatory; real motion or drop dial.
- **M > 6:** scroll choreography / pin only if purpose-gated through `motion-opportunities` and `opportunities.md`.
- **D <= 3:** large section gaps, max ~65ch measure, sparse chrome.
- **D >= 7:** tight tools spacing, tabular numbers, dense tables OK.

Do not invent aliases (`LAYOUT_VARIANCE`). Use these three names only.
