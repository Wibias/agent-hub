# Design methods

`design-with-ai` is the sole general router for visible UI work. Load this file
when a vague look-better request arrives or the user has not chosen a command.
Specialists do not compete for the same surface; the router selects and bounds
them.

## Ownership first

| Request | Canonical owner |
|---|---|
| Look better, polish, restyle, redesign, build visible frontend UI | `design-with-ai` |
| Explicit Impeccable command or bounded delegated craft phase | `impeccable` |
| Journey, information architecture, service design, research, or ethical UX strategy | `intent` or its named leaf |
| Conversion-specific landing or pricing page | `conversion-pages`, routed by `design-with-ai` when visible implementation is requested |
| Module, SDK, domain, or API interface shape | `codebase-design` |
| Throwaway concept prototype | `prototype` |
| Existing UI failure and edge-state hardening | `fortify` |
| shadcn component operations | `shadcn` |

The word "design" alone never activates every design capability. Resolve one
owner, then load only the internal references and genuine specialists required
by the selected workflow.

### Named optional specialist classification

When the user names an installed specialist as optional rather than invoking a
specialist command (for example, `use impeccable if useful`):

1. Open this `design-with-ai` contract and the named specialist's `SKILL.md`
   once before deciding whether to delegate.
2. Record a concise classification before implementation:

   ```text
   COMPETING-SKILL CLASSIFICATION
   owner: <canonical owner>
   candidate: <named specialist>
   classification: owner | bounded-specialist | not-applicable
   reason: <scope evidence from both skill contracts>
   ```

3. General visible-UI work remains owned by `design-with-ai`; a named optional
   Impeccable candidate is `bounded-specialist` unless the user actually invokes
   an Impeccable command or the active workflow selects an exact delegated command.
4. Classification is not execution. Do not run the candidate's setup, command,
   or broader workflow unless it is selected after classification.
5. Do not expand this check to unrelated installed skills. It applies only to a
   user-named plausible candidate or a concrete owner conflict surfaced by the
   selected workflow.

This classification satisfies the competing-skill boundary without turning a
general polish request into an Impeccable task or silently ignoring the named
candidate.

## Choose a method once

State the method in one line before coding.

| Method | When | Bias |
|---|---|---|
| **1 Skills-assisted** | Small or bounded surface, time-boxed work | fastest |
| **2 Component-by-component** | Ship-critical product UI that must stand out | highest quality |
| **3 Inspiration board** | Strong user-supplied or curated references | balanced |

Default to Method 2 for ship-critical product UI, Method 1 for tiny/internal
surfaces, and Method 3 when references are already strong.

## Look-better default

For look better / polish / improve UI / less AI without an explicit command:

1. Keep `design-with-ai` as owner.
2. Route to `improve-existing standard`.
3. Load `existing-ui-workflows.md`, `core-design-workflow.md`, and the applicable
   evidence references for the selected profile.
4. Run the internal quality stack:
   `Direction -> Baseline -> Craft -> Gate`.
5. Delegate an exact Impeccable command only when the stack reveals a genuine
   need for deeper specialist craft. Do not make Impeccable a prerequisite.
6. Motion is opt-in. Use a motion route only when requested or when a grounded
   opportunity is explicitly selected.

If the product model, surface role, journey, information architecture, or
content placement appears wrong, do not polish by reflex. Route to
`redesign-existing`. Use a bounded Intent leaf only for the strategic gap, then
return its artifact to the visual workflow.

## Method 1 - Skills-assisted

1. Resolve target, profile, locked constraints, and existing project design rules.
2. Load the selected workflow references and `quality-stack.md` when modifying UI.
3. Use `design-spec` when a locked generation brief is useful before variants.
4. Use `shadcn` only for actual shadcn component/registry operations.
5. Use a motion route only when motion itself is selected work.
6. Finish with the normal Gate and verification contract.

## Method 2 - Component-by-component

### 1. Meaning before pixels

Record:

- audience and entry context;
- problem and desired outcome;
- surface type and first-screen job;
- why this surface owns that job;
- primary action and success signal;
- emotional and brand posture;
- real colour/type/asset constraints.

When these questions expose a journey, IA, service, research, accessibility, or
ethical-design problem, delegate only that question to the matching Intent leaf.
`design-with-ai` remains the visible implementation owner.

### 2. Inspiration and evidence

Use three lanes:

1. usability/accessibility evidence;
2. real products from the domain or adjacent domains;
3. outside-domain visual or cultural references.

Gallery pages are inspiration, not usability proof. For standard/deep work use
`source-evidence.md` and `reference-library.md` before broad research. Record the
transferable principle and the exact decision each reference informs.

### 3. Surface, content, and structure

Use `core-design-workflow.md` to classify the surface, build the contract ledger,
assign content disposition, map routes/states/return paths, and define the
selected visual world before implementation.

### 4. Build one component at a time

Derive dependency order from the selected surface model. A typical order is:

1. semantic visual foundation and type/palette roles;
2. orientation and entry shell;
3. primary task or decision zone;
4. secondary disclosure surfaces;
5. controls, states, and recovery;
6. responsive transposition;
7. approved motion and micro-details.

Build the representative high-consequence slice before broad implementation.

### 5. Refine

Run the internal quality stack. A bounded Impeccable delegation may follow only
when a precise specialist command adds value. Finish with rendered/browser
verification owned by `design-with-ai`.

## Method 3 - Inspiration board

1. Complete Method 2 meaning and contract work.
2. Curate a small annotated reference set.
3. Derive transferable principles rather than copying a layout 1:1.
4. Generate section by section unless the surface is genuinely small.
5. Finish with the same quality stack and verification.

## Specialist map

| Need | Owner / route | Boundary |
|---|---|---|
| General visible UI workflow | `design-with-ai` | sole router |
| Taste, macrostructure, anti-slop | `design-with-ai` `taste-workflow.md` | internal direction phase |
| Baseline quality floor | `design-with-ai` `baseline-ui.md` | internal baseline phase |
| Micro craft | `design-with-ai` `micro-craft.md` | internal craft phase |
| Locked generation/spec prompt | `design-spec` | internal prompting route |
| Missing motion | `motion-opportunities` | internal motion discovery |
| Motion audit/review/plans | motion routes | internal motion craft |
| Runtime animation jank/leaks | `motion-optimize` | live profiling required |
| Motion terminology | `motion-name` | lookup only |
| Deep command-based craft | `impeccable` | explicit or bounded delegation |
| UX strategy, journeys, IA, ethics | `intent` and leaves | strategic artifact return |
| Conversion landing/pricing | `conversion-pages` | bounded goal-specific specialist under `design-with-ai` for visible implementation |
| Throwaway prototype | `prototype` | non-production concept branch |
| Edge/failure states | `fortify` | robustness specialist |
| shadcn components/CLI | `shadcn` | component/tooling specialist |
| Module/API interface shape | `codebase-design` | non-visual interface owner |

## Delegation receipt

Every delegated design specialist receives:

```text
owner: design-with-ai
command: <exact specialist command>
target: <bounded path or surface>
profile: quick | standard | deep
locked_constraints: <list>
completed_steps: <list>
requested_output: <artifact or diff>
return_gate: <what design-with-ai will verify>
```

Without a valid receipt, a specialist runs only when the user explicitly invokes
it. Otherwise it returns control instead of guessing or reopening method choice.

## Hard rules

1. One general visible-UI owner per task: `design-with-ai`.
2. Existing implementation is evidence, not design authority.
3. No one-shot product UI for Method 2 or 3.
4. Coherent palette, type, shape, and interaction logic are required; no single
   visual recipe applies to every product.
5. Look-better runs the full internal quality stack, not one phase alone.
6. Strategic UX leaves do not take over visual implementation.
7. Impeccable does not rerun completed general workflow steps.
8. Verify the rendered result before claiming modifying UI work complete when
   suitable tooling exists.
