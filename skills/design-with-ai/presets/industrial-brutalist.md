# Preset: Industrial Brutalist (Swiss Print / Tactical Telemetry)

Raw mechanical interfaces fusing mid-century Swiss typographic print, industrial
manufacturing manuals, and retro-futuristic aerospace/military terminals. Rigid
modular grids, extreme type scale contrast, purely utilitarian color, simulated
analog degradation. For data-heavy dashboards, portfolios, or editorial sites
that should feel like declassified blueprints.

## Pick ONE archetype per project - never mix

### Swiss Industrial Print (light)
1960s corporate identity and heavy-machinery blueprints: newsprint/off-white
substrate, monolithic heavy sans headings, visible structural dividing lines,
aggressive asymmetric negative space punctuated by oversized viewport-bleeding
numerals or letterforms, primary red as the alert/accent color.

### Tactical Telemetry / CRT Terminal (dark)
Classified military databases, legacy mainframes, HUDs: dark mode exclusively,
high-density tabular data, monospace dominance, technical framing devices
(ASCII brackets, crosshairs), simulated hardware limitations (phosphor glow,
scanlines, low bit-depth rendering).

## Typography (the primary structure; imagery is secondary)

- **Macro (structural headers):** heavy neo-grotesque - Neue Haas Grotesk Black, Inter Extra Bold/Black, Archivo Black, Roboto Flex Heavy, Monument Extended. Massive fluid scale `clamp(4rem, 10vw, 15rem)`; tracking `-0.03em` to `-0.06em` (glyphs form solid blocks); leading `0.85-0.95`; exclusively uppercase.
 (Inter/Roboto are allowed HERE at black weights as structural material; the general banlist yields to this preset.)
- **Micro (data/telemetry):** monospace - JetBrains Mono, IBM Plex Mono, Space Mono, VT323, Courier Prime. Fixed small scale `10-14px`; generous tracking `0.05-0.1em` (typewriter/terminal matrix feel); leading `1.2-1.4`; uppercase for all metadata, nav, unit IDs, coordinates.
- **Textural disruption (rare):** high-contrast serif (Playfair Display, EB Garamond, Times New Roman) used exceedingly sparingly and always degraded (halftone, 1-bit dither) against the clean sans.

## Color (uncompromising)

Gradients, soft drop shadows, and modern translucency are strictly prohibited.
Choose ONE substrate and keep it.

- **Swiss Print:** background `#F4F4F0` / `#EAE8E3` (matte documentation paper); foreground `#050505`-`#111111` (carbon ink); accent `#E61919` / `#FF2A2A` (aviation/hazard red) - the ONLY accent, used for strike-throughs, thick dividing lines, vital highlights.
- **Telemetry:** background `#0A0A0A` / `#121212` (deactivated CRT, never pure black); foreground `#EAEAEA` (white phosphor); same hazard red, same rules. Terminal green `#4AF626` optional for ONE specific element (one status dot, one readout) - never general text; omit if purposeless.

## Layout and spatial engineering

- **Blueprint grid:** strict CSS Grid; elements anchored to tracks and intersections, never floating.
- **Visible compartmentalization:** `1-2px solid` borders delineate information zones; full-width `<hr>` rules segregate operational units.
- **Bimodal density:** oscillate between tightly packed monospace data clusters and vast calculated negative space framing macro type.
- **Geometry:** absolute rejection of `border-radius`. Every corner 90 degrees.

## Components and symbology

- ASCII syntax decoration: framing `[ DELIVERY SYSTEMS ]`, `< RE-IND >`; directional `>>>`, `///`, `\\\\`.
- Industrial markers: `(R)`, `(C)`, `(TM)` symbols as structural geometric elements, not legal text.
- Technical assets: crosshairs `+` at grid intersections, repeating vertical barcode lines, thick warning stripes, randomized string data (`REV 2.6`, `UNIT / D-01`) to simulate active machinery.

## Textural / post-processing effects

- **Halftone and 1-bit dithering:** continuous-tone images or large serif type reduced to dot-matrix; via pre-processing or `mix-blend-mode: multiply` + SVG radial dot patterns.
- **CRT scanlines (terminal mode):** `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)` on the background.
- **Mechanical noise:** one global low-opacity SVG static filter on the DOM root for unified physical grain.

## Engineering directives

1. **Grid determinism:** `display: grid; gap: 1px;` with contrasting parent/child backgrounds generates razor-thin dividing lines without border declarations.
2. **Semantic rigidity:** use `<data>`, `<samp>`, `<kbd>`, `<output>`, `<dl>` to reflect the telemetry's technical nature.
3. **Typography clamping:** `clamp()` exclusively for macro type so it scales aggressively while holding structure across viewports.
