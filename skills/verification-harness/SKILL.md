---
name: verification-harness
description: >
  Create, repair, or maintain a portable project-local verification skill that
  lets agents launch the real application, health-check the intended instance,
  drive user-facing behavior through a reusable control surface, capture
  head-bound runtime evidence, and clean up owned resources. Use when a
  repository lacks a reusable agent-facing runtime proof layer, when an existing
  verify-* skill has drifted, or when a project verifier needs maintenance.
  Reuse existing Playwright/Cypress/CLI/PTY/CDP/HTTP harnesses instead of
  replacing them, and encode repeated interactions into persistent tooling
  instead of per-task throwaway scripts. Do not use merely to run an existing
  smoke suite, write ordinary unit tests, or review GitHub merge readiness.
---

# Verification Harness

Own the lifecycle of project-local runtime verification. The project verifier is the reusable interface. Existing test and control frameworks remain implementation details behind it.

## Boundary

This skill owns:

- discovery of existing runtime verification primitives;
- `REUSE / EXTEND / CREATE` decisions for a project verifier;
- creation and repair of `.agents/skills/verify-<app>/`;
- the portable verifier contract;
- the persistent agent-facing control surface used to drive the verifier;
- head-bound evidence semantics;
- feature-map maintenance;
- deterministic structural validation of project verifiers.

This skill does not own ordinary smoke-test execution, unit-test authoring, GitHub delivery, or product implementation. When the user only asks to run an already-defined test suite, route to that suite's existing owner.

## 1. Inspect before creating

Read the project rules and repository evidence. Determine the primary user surface, local run path, existing drive primitives, observable proof, isolation model, and the command interface future agents can reuse.

Prefer, in order:

1. an existing project-local `verify-*` skill;
2. an existing stable agent-facing command/control surface that already drives the real application;
3. an existing application test/control harness that can sit behind a small reusable project-verifier interface;
4. a small project-owned helper using an already-present dependency or platform primitive;
5. a new dependency only when the first four cannot exercise the required real surface.

Do not ask the user for facts available from source, scripts, docs, or the live application.

Before creating a new skill directory, run Skill Ratchet preflight with the project root and classify the result. `CREATE` requires rejecting plausible owners with evidence. A lower-level smoke-test runner may be a reusable drive primitive without owning this lifecycle.

## 2. Create or repair the project verifier

Read `references/generated-skill-contract.md` and `references/evidence-contract.md`.

Create or extend:

```text
<project>/.agents/skills/verify-<app>/
```

Keep it host-portable. Do not emit `.cursor/skills/` paths, Cursor-only mode metadata, or cloud-agent assumptions.

Build the smallest durable lever future agents can call directly. A verifier must declare a `Control surface` using either an existing maintained project command or a verifier-owned helper under `scripts/`. Temporary exploratory scripts may be useful while discovering the application, but remove them before completion. If the same interaction is useful again, encode it in the persistent control surface instead of making the next agent reconstruct it.

Generated helper commands must be directly runnable from the project root and clearly documented in the generated `SKILL.md`. A custom helper must expose useful `--help`, fail non-zero with actionable errors, provide machine-readable inspection output when practical, prefer semantic interaction handles, and support meaningful `--dry-run` behavior for destructive or externally visible actions when possible. Prefer composable subcommands over one giant operation. Do not create a generic arbitrary-code backdoor just to make automation convenient.

## 3. Validate structure and receipts

Run the hub validator from the installed `.agents` root. Resolve `<agent-home>` to the current host's agent home, for example `%USERPROFILE%\.agents` on Windows or `$HOME/.agents` on POSIX:

```text
node "<agent-home>/skills/verification-harness/scripts/validate-verification-skill.mjs" "<project>/.agents/skills/verify-<app>"
```

When a runtime receipt exists, validate it too:

```text
node "<agent-home>/skills/verification-harness/scripts/validate-verification-skill.mjs" "<project>/.agents/skills/verify-<app>" --receipt "<receipt.json>"
```

A non-zero validator result blocks completion. Fix the verifier or surface the concrete blocker.

## 4. Prove the verifier live

A generated or repaired verifier is not complete until it has driven the real application once through its declared persistent control surface.

For helper mode, run the canonical helper `--help` path successfully. Then run Doctor, drive one affected or seeded feature, capture the observable result and material side effects, produce a receipt, run cleanup, and confirm retained evidence was not removed by cleanup.

Use `pass`, `fail`, and `blocked` exactly as defined in `references/evidence-contract.md`. Never turn unexecuted or stale verification into a pass.

## 5. Maintain an existing verifier

For a maintenance or drift-audit request, read `references/maintenance-contract.md` and follow its source plus live pass.

Keep product code read-only during verifier maintenance. A product regression is a reported finding, not permission to rewrite the feature map around broken behavior.

When maintenance finds repeated ad-hoc automation for an already mapped interaction, consolidate that behavior into the existing control surface rather than preserving parallel throwaway scripts.

## Delegation

Read-only source analysis may fan out to subagents with disjoint feature ownership. Runtime driving stays with one coordinator unless the project verifier proves isolated ports, profiles/data roots, and other mutable resources for concurrent instances.

Fresh verification is useful after high-risk or cross-cutting implementation. Give a verifier only the acceptance criteria, current head identity, project verifier, and affected feature entries. Do not preload the implementation worker's confidence claims or full transcript.

## Report

Return:

```text
Classification: REUSE | EXTEND | CREATE
Project verifier: <path>
Surface: <surface>
Control surface: existing | helper
Drive primitive: <existing primitive behind the control surface>
Isolation: serial | isolated parallel
Structural validation: pass | fail | blocked
Live verification: pass | fail | blocked
Head: <40-char SHA when a receipt was produced>
Evidence: <receipt/artifact paths>
Remaining gaps: <none or concrete gaps>
```

Do not claim the runtime pass when only structural validation ran.

## References
<!-- eval:references -->
- references/generated-skill-contract.md -- when to read: creating or repairing a project verifier
- references/evidence-contract.md -- when to read: creating, validating, or consuming runtime evidence
- references/maintenance-contract.md -- when to read: maintaining or auditing an existing project verifier
- tests/evals/cases.jsonl -- when to read: evaluating this skill's discovery and behavior
- tests/evals/regression-cases.jsonl -- when to read: rerunning retained regressions
- tests/evals/regression-lock.json -- when to read: validating retained regression immutability
<!-- /eval:references -->
