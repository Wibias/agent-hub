# Color strategy, scene, and type procedure

Load on greenfield brand/marketing surfaces and whenever palette or light/dark
is undecided. Identity-preservation wins when tokens already exist.

## Physical scene (before light/dark)

Write one sentence: who uses this, where, under what ambient light, in what mood.
If the sentence does not force light or dark, add detail until it does.
Never pick dark "because tools look cool" or light "to be safe."

## Color strategy ladder (pick one)

| Strategy | Surface | When |
|---|---|---|
| **Restrained** | Tinted neutrals + one accent <=10% | Product default; brand minimalism |
| **Committed** | One saturated color carries 30-60% | Identity-driven brand pages |
| **Full palette** | 3-4 named roles, deliberate | Campaigns; data viz |
| **Drenched** | Surface IS the color | Brand heroes, campaign moments |

Name a real reference before committing: "Klim #ff4500 drench", "Stripe purple-on-white restraint", "Liquid Death acid full", "Mailchimp yellow full", "Vercel monochrome". Unnamed ambition becomes beige.

### Neutrals

- Prefer OKLCH. Tint neutrals slightly toward brand hue (0.005-0.015 chroma) unless modern-minimal monochrome.
- No pure `#000`/`#fff` as defaults (modern-minimal may use pure white paper).
- **Cream/sand/beige body bg** is a saturated AI default. Warmth via accent + type + imagery, not body wash.
- **Cool blue-charcoal dark** (`#0c0e15` family) is night-mode slop. Warm, green-black, or brand-hue dark instead.
- **UI-kit gray-100/200** footers and bands are light-mode slop. Brand-specific surface tone.
- One gray family (warm OR cool), never mixed on one page.
- Shadows tinted to surface/fill, tight and directional - never fat all-around black bloom.

### Banned palette reflexes

- Purple / blue-purple / cyan-magenta gradients (text or fill)
- Premium-consumer cream + brass + oxblood monoculture
- Pastel candy multi-stop backgrounds (peach/mint/lavender aurora)
- Drifting soft multiply-blur blobs as "atmosphere"
- Radial glow halo centered behind hero object
- Saturated accent sprayed on every label/dot/button - prefer **tonal** accents

## Font selection procedure (greenfield)

1. Write three concrete brand-voice words (physical-object words, not "modern").
2. List three fonts you would reach for by reflex. If any are on the ban list, reject.
3. Browse a real catalog with those words. Match a physical object (museum caption, receipt, concert poster, terminal manual). Reject the first "designy" pick.
4. Cross-check. If the final pick equals the original reflex, start over.

### Reflex-reject fonts (greenfield)

Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Arial, Helvetica, Geist (all),
Mona Sans, Plus Jakarta Sans, Space Grotesk, Space Mono, Fraunces, Instrument Sans/Serif,
Recoleta, Work Sans, Sora, Syne, Archivo, Onest, Darker Grotesque, Geologica,
Hanken Grotesk, Spline Sans, Figtree, Gabarito, Quicksand, Cormorant / Cormorant Garamond,
Newsreader, Lora, Crimson*, Playfair, DM Sans/Serif, Outfit, IBM Plex* as default house,
JetBrains Mono as decorative mono, Bodoni/Didot/Playfair as autopilot luxury.

Override only when brand/user names a face, or identity already ships it.

### Reflex-reject aesthetic lanes (second-order)

If the brief does not *require* these, do not land here by anti-reference:

- **Editorial-typographic monoculture** - display serif (often italic) + mono labels + ruled columns + monochrome restraint on non-magazine briefs
- **SaaS indigo-slate dark** - cool blue charcoal + lilac accent
- **Cream editorial paper** - oat/bone body as "premium default"
- **Terminal costume** - mono everywhere for non-dev brands

## Both modes

For consumer-facing pages: design light and dark from the start unless user locks one.
Test both before ship. Hierarchy and contrast must hold in both.
