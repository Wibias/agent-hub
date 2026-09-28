---
name: shadcn
description: >-
  Manages shadcn/ui components and projects: add, search, fix, compose, style,
  and update via CLI. Use when the project has components.json, user mentions
  shadcn, registry, presets, FieldGroup, or composing shadcn UI. Not for generic
  visible-UI taste, baseline polish, or micro craft (use design-with-ai).
  Source: shadcn-ui/ui skills/shadcn (MIT).
---

# shadcn/ui

Components are **source code** added via CLI into the project. Prefer compose over reinvent.

## When to activate

- `components.json` present, or user says shadcn / registry / preset
- Adding buttons, dialogs, forms, sidebars, chat UI from shadcn ecosystem

If the project has no shadcn setup and user wants it: `npx shadcn@latest init` (or pnpm/bun dlx equivalent).

## CLI (use project package runner)

```bash
npx shadcn@latest info --json
npx shadcn@latest search <query>
npx shadcn@latest add <component>
npx shadcn@latest docs <component>
npx shadcn@latest diff
```

Never invent preset URLs by hand. Use `preset decode|url|open|resolve|apply` commands.
Full CLI notes: [references/cli.md](references/cli.md).

## Principles

1. **Search registries before custom UI** (`search`).
2. **Compose** - Settings = Tabs + Card + fields; Dashboard = Sidebar + Card + Chart + Table.
3. **Built-in variants first** - `variant`, `size` props before one-off classes.
4. **Semantic colors** - `bg-primary`, `text-muted-foreground` - never raw `bg-blue-500` for brand roles.

## Critical rules (always)

### Styling - [references/styling.md](references/styling.md)

- `className` for layout, not restyling component colors/type
- `gap-*` not `space-x-*` / `space-y-*`
- `size-*` when width = height
- `truncate` shorthand; `cn()` for conditionals
- No manual `dark:` color overrides when semantic tokens exist
- No manual z-index on Dialog/Sheet/Popover (they own stacking)

### Forms - [references/forms.md](references/forms.md)

- Forms: `FieldGroup` + `Field` (not raw div + Label soup)
- Validation: `data-invalid` on Field, `aria-invalid` on control
- Option sets 2-7: `ToggleGroup`; grouped checkboxes: `FieldSet` + `FieldLegend`

### Composition - [references/composition.md](references/composition.md)

- Items inside Groups (`SelectItem` → `SelectGroup`, etc.)
- Dialog/Sheet/Drawer always need Title (sr-only if hidden)
- Full Card composition; TabsTrigger inside TabsList
- Avatar needs AvatarFallback
- Button loading: Spinner + disabled - no fake `isLoading` prop unless project has it
- Prefer Alert, Empty, Skeleton, Badge, Separator, sonner toast over hand-rolled markup

### Icons - [references/icons.md](references/icons.md)

- Icons in Button: `data-icon="inline-start|inline-end"` when using shadcn icon conventions
- Do not size icons inside components that own icon CSS

## Gotchas

- Check `base` field from `info` for Radix vs Base UI (`asChild` vs `render`) - [base-vs-radix](https://ui.shadcn.com)
- Never ship default shadcn look as final brand - `design-with-ai` direction and quality stack still apply
- One primitive system per interaction surface

## Workflow

1. `info --json` - config + installed components
2. `search` / `docs` before writing
3. `add` missing pieces
4. Compose with project tokens; use `design-with-ai` for customer-facing taste/polish

## Related

- Visible-UI taste, baseline polish, micro craft: `design-with-ai`

---

Source: [shadcn-ui/ui skills/shadcn](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn) (MIT). Adapted 2026-07-16.
