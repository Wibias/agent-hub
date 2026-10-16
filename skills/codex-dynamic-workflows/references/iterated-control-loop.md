# Iterated control-loop recipe

Use this reference when the requested orchestration is a repeated improvement loop: the same measurable property is checked again over time, one bounded change is selected, the result feeds the next run, and human feedback should tune future runs.

This is a recipe inside `codex-dynamic-workflows`, not a new discovery surface. The domain skill still owns the work being changed. The workflow manager owns iteration state, scheduling shape, bounded work-in-progress, and integration artifacts.

## Control-loop model

Design the loop explicitly:

- **Set point**: the desired invariant, threshold, or direction. Make it measurable enough that a run can say whether the gap shrank.
- **Sensor**: a deterministic or evidence-backed command that measures the current gap. Prefer existing tests, linters, static analysis, repository queries, or small scripts over agent judgment when they can measure the property directly.
- **Controller**: chooses the next reviewable increment from sensor output. It should select the smallest useful step, not reinterpret the whole programme on every run.
- **Actuator**: the domain workflow or coding agent that applies that increment and runs its required validation.
- **Disturbances**: changes outside the loop that can move the system, such as teammate commits, dependency updates, generated code, or changed upstream contracts.
- **Dampener**: an optional gate that prevents the measured problem from getting worse while the loop reduces the existing backlog.

The loop is:

```text
set point -> sensor -> controller -> actuator -> changed system
                ^                               |
                |----------- next run ----------|
```

Human feedback tunes the controller, scope, and actuator rules. It does not replace the sensor with narrative judgment when a rerunnable measurement exists.

## Design rules

1. **Start from the repository.** Read existing CI, package tooling, validation commands, relevant skills, and local conventions before inventing components.
2. **Make the sensor local first.** A developer must be able to run the sensor by hand and get a stable result before it is placed in CI or a scheduler.
3. **Make the controller inspectable.** Record how it selects the next target, how large one increment may be, and what makes an increment reviewable.
4. **Keep the actuator domain-owned.** Reuse the existing implementation, migration, design, research, or delivery skill instead of embedding a second copy of its procedure here.
5. **Run the whole cycle locally before automation.** Sensor, controller, actuator, and validation must each have an inspectable local path. CI should orchestrate known-working pieces rather than become the only place the loop can run.
6. **Name disturbances.** A loop that ignores concurrent repository change will eventually optimise stale state. Repository provenance in `state.json` is mandatory for persisted runs.
7. **Offer a dampener when regression is cheap to detect.** Examples: reject new deprecated API uses, prevent coverage from falling below the current baseline, or block new instances of a known structural violation.
8. **Bound work-in-progress.** Default to **one open PR per loop**. A scheduled run no-ops when that loop already has one unresolved PR unless the user explicitly chooses a different bound.
9. **Keep feedback durable but small.** Persist standing reviewer guidance that should change later selections. Do not persist transcripts, one-off instructions, or raw run logs as controller memory.
10. **Do not schedule before the manual loop works.** Frequency is an operational choice after correctness, not a substitute for it.

## Workflow artifact additions

For an iterated loop, add these sections to `.workflow/<slug>/plan.md`:

```text
Set point:
Sensor:
Controller:
Actuator / domain owner:
Disturbances:
Dampener:
WIP bound:
Cadence / trigger:
Standing feedback:
Stop condition:
```

Each run should record compact sensor input, controller selection, exact repository provenance, actuator result, and validation evidence in the normal packet/result artifacts. Do not create a second state store beside `state.json`.

## Controller discipline

A controller can be deterministic or judgment-based. Prefer the least agentic controller that can choose the next useful unit reliably.

Good controller outputs are concrete:

- one deprecated API family with the next N callers;
- one package whose measured coverage is below target;
- the next highest-confidence stale document set;
- one verified cluster of a repeated structural problem.

Bad controller outputs reopen the full problem every run, select work without sensor evidence, or create a change larger than a reviewer can safely evaluate.

## Human-on-the-loop feedback

Standing feedback belongs in a compact repository artifact named by the workflow plan, for example `.workflow/<slug>/feedback.md` when the project has no better owner. Load it after the controller has produced the candidate increment so feedback can tune the selection without replacing measurement.

Useful standing feedback includes:

- permanent scope exclusions;
- known false-positive areas;
- accepted golden patterns;
- reviewer guidance that should alter future target selection.

Do not store secrets, transcripts, temporary CI failures, or a diary of prior runs.

## Completion and stop conditions

A loop should stop or require redesign when:

- the set point is reached;
- the sensor can no longer measure the intended property reliably;
- the controller repeatedly selects low-value or conflicting work;
- repository disturbances invalidate the original model;
- the remaining changes are no longer small and reviewable;
- the user changes the target.

Do not keep automation alive merely because a schedule exists.

## Provenance

Adapted from HumanLayer's MIT-licensed `design-control-loop` skill, reviewed 2026-10-17. Agent Hub keeps domain ownership, workflow state, mutation authority, and host-runtime policy in their existing canonical owners rather than importing HumanLayer's full CI/agent templates.