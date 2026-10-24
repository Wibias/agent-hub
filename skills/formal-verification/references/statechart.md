# Statechart mode

Use this mode when formal verification needs to make state-machine behavior readable, show a concrete TLC counterexample as a path, or turn an agreed statechart into a checkable TLA+ skeleton. `formal-verification` owns the proof claim and final verdict. A chart is not proof by itself.

Run the vendored CLI from the skill root:

```text
node statechart/scripts/statechart.mjs --help
```

## Choose the direction

- **`from-spec`:** use when a TLA+ model exists, or when code or design is concrete enough to model. Preserve the relevant invariants. Never weaken a rule merely to make the model pass. When the model describes code, bind modeled state and actions to code a reviewer can open.
- **`from-chart`:** use when the intended behavior should be agreed first. Draw a Mermaid `stateDiagram-v2`, add `%% never ...` rules, generate the TLA+ skeleton, then add code-level guards, variables, and assumptions before making implementation claims.
- **`render`:** use only to turn a Mermaid statechart into a PNG. Rendering is presentation, not verification, and does not produce a property verdict.

Use `--fixed` to compare a proposed implementation fix with the current model. Use `--against` to compare a model of the code with an agreed specification. Use `--cover` when the complete overview is too large; bug paths remain included while the command reports what the overview leaves out.

## Interpret model-check results

For every TLA+/TLC model-check result, use statechart as the interpretation layer before handoff. If a rule is violated, surface the shortest readable counterexample path the checker found. If the check is passing, provide a state-machine overview when it materially helps the reader understand the verified behavior.

A chart is interpretation evidence, not proof and not a verdict. `formal-verification` remains responsible for deciding what the model establishes, whether a counterexample maps to real code, and what final status to report. Keep release-sensitive statechart commands, options, and file paths in this reference; project-local verification artifacts should reference statechart by capability instead of copying those details.

## Evidence boundary

A TLC counterexample is evidence about the model. When the model describes implementation code, replay each counterexample against the current code before calling it a product bug. Drive only feasible entry points and map one model action to one indivisible implementation step. If the path cannot occur in the code, treat that as model drift or a modeling error until evidence shows otherwise.

For a design with no implementation yet, the TLC trace may establish a property of that design model only. Say that explicitly. Do not upgrade a design-model result into a claim about future code.

A renderer, Java, TLC, `mise`, npm, or bootstrap failure is a tooling failure. It is never a PASS or FAIL property verdict. Mermaid and TLA+ text remain usable evidence when optional PNG rendering fails.

## Files and bootstrap

Prefer a scratch or project-owned output location for exploratory runs. Use `--out` when generated files should not sit beside canonical source files. The command replaces its own output folder as a unit and refuses folders containing foreign files.

TLC can be supplied with `TLA2TOOLS` and `JAVA`. Otherwise the vendored runtime may use `mise` to install its pinned TLC and Java toolchain; that first install needs network access. PNG rendering may install pinned Pele and resvg packages into the statechart cache through npm. Do not hide these downloads or present them as proof work.

Keep generated `chart.mmd`, bug-path charts, `stories.md`, `summary.json`, and TLC output when they materially support the verification record. The project-local formal-verification artifact defined in `project-contract.md` remains the durable owner of covered code, assumptions, commands, sync commit, and outcome.
