# Design dials

Three 1-10 dials describe layout variance, motion intensity, and visual density. Set them only after the Design Read has established enough product and visual evidence to justify the values. State values aloud as `dials: V#/M#/D#`.

| Dial | 1 | 10 |
|---|---|---|
| `DESIGN_VARIANCE` | symmetric, calm | asymmetric, compositionally adventurous |
| `MOTION_INTENSITY` | static | cinematic / physics-heavy |
| `VISUAL_DENSITY` | gallery air | cockpit packed |

## Calibration sources

Calibrate each dial from the strongest available source, in this order:

1. **explicit user direction** or an explicitly approved direction;
2. **incumbent measurements** from the real product, accepted design authority, tokens, representative renders, and established motion/density conventions;
3. **inspected references** whose transferable principle is recorded and relevant to the current surface;
4. task and information semantics when they directly constrain density, motion, or composition.

Do not derive values from a product category, industry label, trend word, or brand stereotype. `SaaS`, `AI`, `finance`, `luxury`, `playful`, `premium`, or similar labels are not dial values. They may describe context, but a numeric setting requires observable design evidence or explicit direction.

For preserve-style redesigns, measure and match the incumbent posture unless the approved scope opens that dimension. For an overhaul, choose the values from the selected direction rather than applying a fixed offset to the old design.

If a material dial remains unresolved and different values would produce meaningfully different products, expose alternatives or leave it unresolved. Do not silently insert a baseline preset.

## How dials drive output

These ranges describe consequences after a value has been justified; they are not recommendation presets.

- **V <= 4:** centered or symmetric structures may fit; fewer compositional families are usually needed.
- **V > 4:** asymmetry and stronger variation are available when the selected direction supports them; do not break a stable layout merely to satisfy the number.
- **M <= 3:** static or micro-interaction posture; decorative choreography should be absent.
- **M > 3:** reduced-motion behavior is required for introduced motion.
- **M > 6:** scroll choreography, pinning, or physics-heavy sequences still require purpose-gating through the normal motion workflow; the dial never authorizes them by itself.
- **D <= 3:** spacious composition and restrained chrome are consistent with the selected posture.
- **D >= 7:** tighter tool spacing, tabular numerals, and information-dense controls may fit, while accessibility and operability remain mandatory.

Do not invent aliases such as `LAYOUT_VARIANCE`. Use these three names only.
