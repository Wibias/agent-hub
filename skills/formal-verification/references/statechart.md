# Statechart mode

Use this mode when formal verification needs to make a TLA+/TLC state machine readable or show a concrete checker failure as a path through states. `formal-verification` owns the proof claim and final verdict. A chart is interpretation evidence, not proof by itself.

The current vendored compiler is one-way: it consumes a TLA+ specification and configuration, checks them with TLC, then produces a report and, when the graph fits the chart budget, a Mermaid statechart. The old `from-chart`, `--against`, and `--fixed` interfaces were removed upstream and are not downstream capabilities.

## Run the compiler

From the formal-verification skill root, use the vendored launcher on POSIX systems:

```text
statechart/scripts/statechart SPEC.tla [--config FILE] [--view FILE] [--out DIR]
```

The launcher selects a TypeScript-capable runtime. On systems without a POSIX shell, invoke `statechart/scripts/statechart.ts` directly with a supported Node runtime. The vendored upstream requires Node 22.18 to 22.x, Node 23.6 or later, Bun 1.1.5 or later, or Deno 2.0 or later.

Use `--config` when the configuration is not the default beside the spec. Use `--out` for a fresh scratch or project-owned output directory. Use `--view` for the reader-facing presentation layer.

## Model and rules

Write each agreed safety rule as an `INVARIANT`; preserve relevant `PROPERTY` rules already owned by the verification. Never weaken a rule merely to make the checker pass. Keep constants and constraints small enough that the explored state space is meaningful and bounded, and disclose those bounds in the project-local verification record.

Write `Next` as a disjunction of named actions so TLC can report meaningful action names. When the model describes implementation code, bind modeled state and actions to code a reviewer can open and make each model action correspond to one indivisible implementation step.

Statechart also checks deadlock behavior. A legitimate terminal state still looks like a deadlock unless the model explicitly represents the intended terminal behavior. Do not suppress a deadlock finding without explaining why the model makes the state terminal.

## Reader-facing view

The optional view module is where judgment about presentation belongs. It can label states with `state(vars)`, label transitions with `step(action, from, to)`, group states into phases with `group(vars)`, assign group colors, and provide a title.

Use words the reader can observe or care about, not raw TLA+ variable or action names. A flat string label creates one state; arrays can represent parent states; objects can represent parallel regions. If a hidden value materially changes behavior, split or label the state so the chart does not conceal the distinction.

Keep charts small enough to read. Upstream targets roughly 20 arrows or fewer for a useful overview. A view may omit unimportant steps only when every retained chart state remains reachable, at least one outgoing transition remains for a model state that can move, and an entire visual arrow is hidden consistently rather than only some of its underlying transitions.

## Interpret results

For every TLA+/TLC handoff, use Statechart as an interpretation layer before reporting the result when a state-machine view materially helps.

When a rule breaks, surface the shortest readable path reported for that rule. Preserve qualified TLA+ action names such as `C!Up`; the current upstream snapshot includes the fix that prevents those names from being truncated in PROPERTY traces.

When the explored graph is within the compiler's chart budget, `chart.mmd` shows the reachable state-machine view and marks states that break or may break rules. Above the current 500-state chart budget, the compiler still checks the model and reports bug paths, but it may emit only the paths needed for failures or no chart for a passing run. Never invent an overview that the compiler did not produce.

The durable textual evidence is the generated report plus TLC output. Depending on the result, useful files include `report.md`, `chart.mmd`, `tlc.out`, and per-rule `tlc-RULE.out` files. Retain them when they materially support the project-local verification record.

## Evidence boundary

A TLC counterexample is evidence about the model. When the model describes implementation code, replay each reported bug path against the current implementation before calling it a product bug. Drive feasible entry points and map one model action to one real implementation step. If the path does not occur in the code, treat that as model drift or a modeling error until evidence shows otherwise.

For a design model with no implementation yet, the result establishes only what was checked about that design model. Do not upgrade it into a claim about future code.

A Java, TLC, `mise`, runtime, renderer, or bootstrap failure is a tooling failure. It is never a PASS or FAIL property verdict. Likewise, a chart is presentation and interpretation evidence; `formal-verification` remains responsible for the proof scope, assumptions, code binding, and final status.

## Bootstrap and rendering

TLC and Java may be supplied by the environment. Otherwise the vendored compiler can use `mise` to bootstrap its toolchain on first use, which requires network access. Do not hide that download or present successful bootstrap as verification evidence.

For an image, render the generated Mermaid with the vendored upstream guidance in `statechart/references/render.md`. Pele rendering is presentation only. A render failure does not change the model-check verdict, and the Mermaid text remains usable evidence.

The project-local formal-verification artifact defined in `project-contract.md` remains the durable owner of the property, harm, covered code, command, bounds, assumptions, sync commit, failure-sensitivity evidence, and outcome.
