# Project verification skill contract

A project verifier turns an existing application and its existing test or control primitives into a repeatable agent-facing runtime proof. It does not replace the project's test framework.

## Target

Create or extend a project-local Agent Skill at:

```text
<project>/.agents/skills/verify-<app>/
```

Use lowercase letters, digits, and hyphens in `<app>`. Keep the skill portable across Agent Skills hosts. Do not write `.cursor/skills/` paths or host-only metadata into the generated verifier.

## Inspect before writing

Answer these from repository evidence before creating files:

1. **Surface:** web, desktop, CLI, TUI, API, mobile, library, or a small set of primary surfaces.
2. **Run:** exact local start/build command, required environment, readiness signal, and teardown.
3. **Drive:** existing Playwright/Cypress tests, browser or CDP driver, PTY helper, CLI, HTTP client, mobile harness, or another real user-facing primitive.
4. **Observe:** screenshots, terminal output, response bodies, logs, files, database state, network/RPC traces, or other observable side effects.
5. **Isolate:** ports, user-data dirs, profiles, data roots, temporary state, and credentials that must not be shared across concurrent runs.
6. **Control surface:** the stable command interface future agents can reuse instead of reconstructing the same interaction in per-task scripts.

Prefer existing project harnesses. Reuse an existing durable command surface when it already exposes the required behavior. Otherwise add the smallest project-local helper that composes existing dependencies or platform primitives. Do not add a second test framework only to satisfy this skill.

Temporary exploratory scripts are allowed only while discovering how to drive the application. Delete them before verifier completion. If an interaction is useful for verification again, encode it in the persistent control surface instead of leaving the next agent to recreate it.

## Required skill shape

`SKILL.md` must contain these H2 sections exactly:

- `Launch`
- `Doctor`
- `Control surface`
- `Drive`
- `Evidence`
- `Cleanup`
- `Feature map`

Also create `features/README.md`. Seed the top 3-5 user-facing features when the repository exposes that many. Add one feature file per seeded feature when a short index entry is not enough to carry its drive and proof details.

### Launch

State the exact command or existing project entry point. Define an observable readiness condition. Record how the verifier knows which checkout and build it started. For short-lived CLIs, launch may mean build once and start a fresh command/session for each drive.

### Doctor

Doctor is read-only. It must answer whether the instance is safe to drive:

- intended checkout/repository;
- current build or full git HEAD identity when observable;
- process or endpoint is the verifier's intended target;
- application is ready;
- required auth or environment prerequisites are available.

A surprising runtime result invalidates the previous health assumption. Run doctor again or restore a known state before continuing.

### Control surface

Declare one persistent agent-facing control interface using this exact shape:

```text
## Control surface
Mode: existing | helper
Command: <stable reusable invocation from the project root>
Helper: scripts/<path>   # required only when Mode: helper
```

Use `Mode: existing` when the repository already has a stable composable interface, such as an application CLI, npm script, Playwright wrapper, HTTP client, PTY controller, or other maintained project command. The verifier may document several subcommands beneath the required `Command:` line, but it must identify one canonical project-root entry point.

Use `Mode: helper` only when no existing interface is sufficient. Put the helper under the verifier's own `scripts/` directory and build it from existing project dependencies or native platform primitives whenever possible. The `Helper:` path is relative to the verifier root, while `Command:` must be directly runnable from the project root, for example `node .agents/skills/verify-demo/scripts/control-demo.mjs`. The helper is verifier-owned product tooling for agents, not a disposable test script.

A custom helper must:

- support `--help` with commands, arguments, prerequisites, and material side effects;
- return a non-zero exit code on failure with an actionable error that names the failed prerequisite or next useful action;
- provide machine-readable output such as JSON for inspection/state commands when practical, unless the underlying stable interface is already machine-readable;
- use stable semantic selectors, routes, commands, or accessibility handles rather than coordinates when possible;
- support `--dry-run` for destructive or externally visible operations when a dry run can meaningfully predict the action, otherwise document the isolation/safety boundary;
- track explicit resource identities for anything that cleanup must later remove.

Prefer composable subcommands over one giant operation. Do not create generic arbitrary-code backdoors merely for convenience. Add only commands that make real verification or debugging repeatable. If a feature repeatedly needs a new interaction, extend this control surface instead of generating another temporary script.

### Drive

Drive the public user surface through the declared control surface. Prefer stable selectors, registered commands, protocol routes, prompt strings, ARIA/data attributes, or other semantic handles. Do not use internal state setters or test-only endpoints as the primary proof of user behavior.

Wait for observable state changes instead of fixed sleeps when the surface supports it.

### Evidence

Follow `evidence-contract.md`. A proof must capture the trigger and the resulting stable state. When the behavior has side effects, verify those side effects as well as the visible result.

### Cleanup

Remove only resources created by the verification run. Track resource identities at creation time. Do not kill by broad process name. Preserve evidence artifacts and the receipt after cleanup.

### Feature map

`features/README.md` is the maintained behavior index. Each feature entry should identify:

- user intent;
- user-visible entry points;
- source anchors when useful;
- which persistent control-surface command drives it;
- observable success state;
- important error, empty, cancel, persistence, or prerequisite states.

Keep the map about behavior, not implementation narration.

## Isolation

Parallel runtime driving is allowed only when the verifier can prove independent resources for every instance that can mutate state. Typical isolation keys are port, profile/user-data dir, temp/data root, database/schema, and worktree. If isolation cannot be proved, declare runtime driving serial and refuse a second live driver against shared state.

Read-only source analysis may still fan out in parallel.

## Prove the generated verifier

Before calling a create or repair complete:

1. For helper mode, run the canonical `Command: ... --help` path successfully.
2. Run `doctor`.
3. Drive one affected or seeded feature through the real surface using the persistent control surface.
4. Produce a receipt that passes `validate-verification-skill.mjs --receipt`.
5. Run cleanup.
6. Confirm the evidence named by the receipt still exists when it is intended to persist.

If the application cannot start or the live path cannot be exercised, return `blocked` with the concrete prerequisite or failure. Do not convert an unexecuted verifier into a pass.
