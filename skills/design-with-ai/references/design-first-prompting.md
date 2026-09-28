# Design-first UI prompting

Use for `design-spec` after meaning and direction are known, before large UI
generation or when the user wants a locked prompt/spec for variants.

## Spec skeleton

```text
GOAL
- What surface or component?
- Who is it for?
- What observable success matters?

FORMAT
- Viewport / aspect / device class
- Safe margins / embedding constraints

LAYOUT
- Grid and placement
- Hierarchy: primary -> support -> action

TYPE
- Families / role / weight / leading / tracking

COLOUR + MATERIAL
- Background, text, accent roles
- Texture/material rules

IMAGERY / UI STYLE
- Concrete visual lane and asset rules

COPY
- Exact factual copy to preserve/render

CONSTRAINTS
- Existing tokens/components/brand
- Variant dimensions allowed to change

NEGATIVE
- Explicit refusals from the selected direction
- No invented metrics, logos, testimonials, or unsupported claims
```

## Iteration rules

1. Lock layout, hierarchy, copy, and product truth first.
2. Change only one or two deliberate variables between variants.
3. For fragile generated typography, separate imagery from final typesetting.
4. Use project-local references when available instead of model-memory taste.
5. Carry the selected `design-with-ai` direction and quality constraints into the prompt.

This workflow creates a spec/prompt. It does not take over implementation routing.
After generation, the result still passes the normal quality stack and verification.

Source lineage: MengTo/Skills `design-first-ui-prompting` (MIT), adapted into
`design-with-ai`.
