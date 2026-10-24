# Statechart Formal Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pstack's statechart runtime as a nested, pinned capability of Agent Hub `formal-verification` without creating a competing routing owner.

**Architecture:** Keep `formal-verification` as the only skill owner. Vendor the upstream statechart runtime byte-for-byte under `skills/formal-verification/statechart/scripts/`, add an Agent Hub integration reference, and test the local CLI/import boundary independently of external TLC/Pele downloads.

**Tech Stack:** Node.js ESM, TLA+/TLC, Mermaid statecharts, pstack statechart runtime, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-statechart-formal-verification-design.md`

## Global Constraints

- Upstream pin: `076f4b2f57844ff9eb4ada914d4763884d40146e`.
- Preserve `pstack/LICENSE` copyright and permission text.
- Keep vendored runtime scripts byte-identical to the pin unless `UPSTREAM.md` records an explicit divergence.
- `formal-verification` remains the proof/verdict owner; statechart rendering alone is not proof.
- Do not make CI depend on network downloads, Java, TLC, or PNG renderer installation.

## Review Focus

- Missing relative runtime import must fail the local integration test rather than surface only at user runtime.
- Upstream pin drift must be visible in `UPSTREAM.md` and the adoption test.
- A statechart request must not create a second top-level routing owner.
- Rendering/tool bootstrap failure must stay a tooling failure, not become a formal property verdict.
- Counterexamples must be replayed against code before being reported as product bugs.

---

### Task 1: Lock the integration contract with failing tests

**Files:**
- Create: `tests/skill-catalog/statechart-adoption.test.mjs`
- Create: `skills/formal-verification/tests/statechart-runtime.test.mjs`
- Modify: `.github/workflows/verify-skill-routing.yml`

**Interfaces:**
- Consumes: current `formal-verification` skill and workflow.
- Produces: tests that require the nested statechart reference, upstream pin/license, complete runtime import graph, and a working local `--help` command.

- [ ] **Step 1:** Add catalog assertions for one-owner routing, the pinned upstream commit, MIT attribution, code-bound counterexample replay, and no top-level `skills/statechart/SKILL.md`.
- [ ] **Step 2:** Add runtime assertions that every relative ESM import in vendored scripts resolves to a file and `node statechart.mjs --help` exits 0 with `from-spec`, `from-chart`, and `render` in stdout.
- [ ] **Step 3:** Add an early workflow step `Test formal verification statechart runtime` before the known catalog gate.
- [ ] **Step 4:** Run the new tests and confirm RED because the statechart integration/runtime does not exist yet.
- [ ] **Step 5:** Commit the failing tests.

### Task 2: Vendor the pinned runtime and license

**Files:**
- Create: `skills/formal-verification/statechart/scripts/*.mjs`
- Create: `skills/formal-verification/statechart/LICENSE`
- Create: `skills/formal-verification/statechart/UPSTREAM.md`

**Interfaces:**
- Consumes: pstack statechart at commit `076f4b2f57844ff9eb4ada914d4763884d40146e`.
- Produces: local CLI entrypoint `skills/formal-verification/statechart/scripts/statechart.mjs` with upstream command surface `from-spec`, `from-chart`, `render`.

- [ ] **Step 1:** Copy every non-test runtime script from upstream byte-for-byte.
- [ ] **Step 2:** Copy `pstack/LICENSE` and add `UPSTREAM.md` with pin, source path, sync boundary, and omitted upstream test-corpus note.
- [ ] **Step 3:** Run the runtime test and confirm GREEN for import closure and `--help`.
- [ ] **Step 4:** Commit the vendor import.

### Task 3: Integrate statechart semantics into formal verification

**Files:**
- Create: `skills/formal-verification/references/statechart.md`
- Modify: `skills/formal-verification/SKILL.md`
- Modify: `skills/formal-verification/tests/evals/cases.jsonl`
- Modify: `knowledge/index.json`

**Interfaces:**
- Consumes: vendored statechart CLI.
- Produces: formal-verification routing for chart-to-spec, spec-to-chart, and TLC counterexample visualization while preserving proof ownership.

- [ ] **Step 1:** Add a focused statechart reference describing when to use `from-spec`, `from-chart`, and `render`, scratch/output behavior, TLC/Pele bootstrap failures, and code replay requirements.
- [ ] **Step 2:** Add a `Statechart mode` section to `SKILL.md` and declare the new reference in the evaluation reference block without changing frontmatter routing ownership.
- [ ] **Step 3:** Add canonical evaluation cases for a TLA+ counterexample visualization and an agreed chart-to-TLA+ skeleton request.
- [ ] **Step 4:** Update only the generated formal-verification `contentHash` in `knowledge/index.json`; the frontmatter description remains unchanged so `knowledge/INDEX.md` should remain stable.
- [ ] **Step 5:** Run catalog/runtime/Skill Ratchet structural checks and confirm statechart-specific GREEN; report the known independent Swift catalog failure if the full workflow still stops there.
- [ ] **Step 6:** Commit the integration.

### Task 4: Verify the branch as shipped

**Files:**
- No new production files.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: auditable branch verification evidence.

- [ ] **Step 1:** Compare the branch to `main` and confirm no top-level statechart skill was added.
- [ ] **Step 2:** Check GitHub Actions for the final head; require the early statechart runtime step to pass.
- [ ] **Step 3:** Inspect the catalog step and distinguish statechart failures from the already-known `write-swift` baseline failure.
- [ ] **Step 4:** Verify the pinned runtime file list against the upstream non-test tree and record any intentional omission/divergence.
