# Surface craft

Use during the Craft phase for radius relationships, optical alignment, depth,
image edges, and hit areas. These are heuristics, not a replacement for the
product's existing design system. Existing tokens, brand rules, component
primitives, accessibility requirements, and the selected visual world take
precedence.

## Concentric border radius

Nested rounded surfaces often look more coherent when the outer radius reflects
the inner radius plus the padding between them:

```text
outer radius ≈ inner radius + inset gap
```

Treat this as a relationship test, not exact arithmetic that must override design
tokens. It is most useful for visibly nested surfaces with small insets. When the
layers read as separate surfaces, or the design system intentionally uses a fixed
radius scale, preserve that system instead of forcing concentric maths.

Review question: do the inner and outer curves feel optically parallel at their
closest points? If not, adjust within the product's token system.

## Optical alignment

Geometric centring is not always visual centring. Asymmetric icons, play
triangles, arrows, and text+icon buttons may need small optical adjustment.

Prefer, in order:

1. an already optically corrected icon from the project's icon family;
2. correcting SVG/viewBox geometry at the source when the asset is owned locally;
3. a tiny component-level offset when the first two are not appropriate.

Do not apply a universal `2px` offset or asymmetric button padding to every icon.
Judge the actual glyph, font, size, and component.

## Borders, shadows, and depth

Borders and shadows communicate different things:

- borders/dividers are strong for separation, dense data, form affordances, and
  flat/technical visual systems;
- shadows are useful when elevation/depth is part of the selected material model;
- a subtle ring plus shadow can separate an elevated surface on varied
  backgrounds;
- some visual worlds intentionally use neither.

Do not mechanically replace borders with shadows. The chosen visual world and
existing component system decide the material language.

When a subtle elevated surface needs a neutral ring, a pattern such as this can
be useful in a light interface:

```css
.elevated-surface {
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.06),
    0 1px 2px -1px rgb(0 0 0 / 0.06),
    0 2px 4px rgb(0 0 0 / 0.04);
}
```

Treat the values as a starting reference, not a mandated token. Use the project's
existing elevation/ring tokens when available.

## Image edges

Add an image edge treatment only when the image boundary needs separation from
its surrounding surface. Options include:

- no outline when the image already has a clear edge;
- a subtle neutral inset ring;
- an existing design-system border token;
- a material-specific treatment from the selected visual world.

For a neutral inset ring, black at low opacity in light mode and white at low
opacity in dark mode is a reliable starting point because it avoids accidental
colour cast:

```css
.image-with-neutral-edge {
  outline: 1px solid rgb(0 0 0 / 0.1);
  outline-offset: -1px;
}
```

Do not call exact black/white values non-negotiable when the project already has
an intentional image-frame treatment. Verify contrast and appearance on the real
background.

## Hit areas

Prefer approximately 44 x 44 CSS px touch targets for mobile/touch contexts.
Dense desktop controls can be smaller when the product context supports it, but
must remain comfortably operable and meet the project's accessibility target.

When a visible control is intentionally small, its hit area may be expanded with
an invisible wrapper/pseudo-element as long as:

- it does not overlap another interactive target;
- pointer/focus semantics remain on the actual control;
- the expanded area does not steal neighbouring interactions;
- layout and clipping do not truncate it unexpectedly.

```css
.small-control {
  position: relative;
}

.small-control::after {
  content: "";
  position: absolute;
  inset: -10px;
}
```

The amount is contextual. Do not force a fixed pseudo-element size if adjacent
controls make it collide.

## Surface review checklist

- Nested curves look related rather than coincident or arbitrarily mismatched.
- Asymmetric glyphs are optically, not merely mathematically, centred.
- Border/shadow choices match the selected material language.
- Image edges are treated only when they need separation.
- Focus rings remain visible and are not replaced by decorative shadows.
- Hit areas are appropriate for pointer/touch context and do not overlap.
- No local craft heuristic overrides established design-system tokens without a
  documented reason.

Source lineage: jakubkrehel/make-interfaces-feel-better (MIT), reconciled with
the unified `design-with-ai` design-system and accessibility precedence.
