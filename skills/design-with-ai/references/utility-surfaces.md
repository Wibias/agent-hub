# Compact utility surfaces

Use for browser-extension popups, toolbar popovers, embedded settings panels, and compact internal operator controls. Load this reference when the surface must finish a bounded task inside the host application's chrome.

## Role

A utility surface is an instrument, not a miniature SaaS dashboard. Its first-screen job is to expose the current state and the one next action with minimal scanning. It does not need a campaign hierarchy, a product manifesto, or invented brand theater.

The browser or host application is the visual baseline. A popup should look like it belongs beside native menus, fields, toggles, and toolbar controls. Product identity comes from the task, vocabulary, and control behavior before it comes from ornament.

## Required decisions

1. **Host fit:** choose light, dark, or adaptive surfaces from the host environment. Do not force a dark dashboard because the category is "technical". Respect `prefers-color-scheme` when the host does.
2. **Action hierarchy:** identify one primary action. Secondary, destructive, and recovery actions remain visibly lower in weight. Do not repeat equal filled buttons.
3. **Information-bearing style:** every color, dot, badge, border, and container must identify a state, category, selection, risk, or grouping that the user needs. If removing it changes no decision or recognition, remove it.
4. **Container discipline:** use the fewest containment layers needed. Prefer section rhythm, separators, and alignment before cards. Do not put cards inside cards.
5. **Native density:** use the host's practical control scale, readable type, and safe hit areas. Compact does not mean tiny text or icon-only controls without names.
6. **State grammar:** status needs a stable location and a plain-language value. A colored dot is valid only when the color maps to a real state and the text remains sufficient without it.
7. **Constrained verification:** inspect the real popup width and height, focus order, overflow, light/dark rendering, empty state, permission state, and a populated/running state.

## Refusals

Reject these defaults unless the product already owns them or the task explicitly requires them:

- an invented logo mark or monogram for an internal utility;
- colored dots or decorative platform orbits beside labels that already carry the platform name;
- pill-shaped tab bars and status chips used as generic polish;
- a four-up stat-card strip when the task is not primarily metric comparison;
- forced dark mode, neon accent fields, or dashboard chrome as a proxy for "modern";
- repeated uppercase micro-labels as section scaffolding;
- branding elements that could be deleted without changing comprehension or action;
- equal visual weight across platform choice, permissions, configuration, execution, and diagnostics.

These refusals do not ban a real brand system, a data-heavy monitoring tool, or color-coded alert states. They reject inherited decoration that has no product job.

## Utility composition

Use the actual task sequence as the structure:

1. identification and platform choice;
2. blocking preconditions and permissions;
3. working data or current selection;
4. configuration that changes execution;
5. the primary action;
6. current execution state and outcome;
7. compact diagnostics or recovery guidance.

Separate these zones with spacing and a small number of hairlines. Keep the primary action and current state adjacent. Demote setup and recovery copy below the working surface.

## Signature

On a utility, a signature move is usually a task-specific interaction rhythm or information treatment, not a logo. Examples include a direct username-to-action list, a compact before/after state line, or a live execution summary that stays adjacent to the primary control. Decorative identity that survives only because the design skill asked for a signature is a regression.

## Verification

Before shipping, answer all of these from the rendered result:

- Can a user identify the platform, current permission state, selected data, primary action, and current job state without hovering?
- Does the surface match the host's light/dark environment and control scale?
- Can any color, dot, badge, border, or container be removed without losing meaning?
- Does the layout still fit at the real popup width without horizontal overflow or hidden primary actions?
- Does it read as a browser utility rather than a generic analytics dashboard?

A negative answer to the last question is a design failure even when every component is individually polished.
