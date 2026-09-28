# Motion system reference

Use when a surface needs a coherent motion language, not merely one isolated
transition.

## Define system roles

- feedback: press, selection, validation
- continuity: add/remove/reorder and shared state
- navigation: direction/orientation where users can lose context
- disclosure: popover, drawer, accordion, modal
- ambient/delight: rare and explicitly budgeted

Map each role to shared duration/easing/spring tokens where the project has them.
Do not invent a parallel token system for one component.

## Frequency and restraint

The more often an action occurs, the smaller its motion budget should usually be.
Keyboard and very high-frequency interactions must remain immediate; remove
decorative delay or movement that slows expert use. Functional state feedback can
still animate when it is immediate, useful, interruptible, and accessible. Rare
moments may carry more character when that fits the product.

## Craft floor

- purposeful and spatially coherent
- visible content by default
- interruptible for rapid/reversible interactions
- reduced-motion path
- fine-pointer gating for hover-only effects
- deliberate transform origin
- compositor-friendly properties by default, with runtime claims measured
- no `transition: all`

Use `standards.md` for canonical rules and starting ranges,
`spring-decision.md` for physics choice, and `motion-opportunities` before adding
motion whose purpose is uncertain.
