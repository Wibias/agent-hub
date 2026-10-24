# PStack Statechart Result Interpretation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt pstack #794 semantics so TLA+/TLC-backed formal-verification handoffs interpret every model-check result through the nested statechart capability without transferring proof authority to statechart.

**Architecture:** Keep `formal-verification` as the sole verdict owner. Extend the existing statechart reference and project-local verification contract so TLA+/TLC results are rendered into readable paths/overviews as evidence, while volatile statechart commands and paths remain centralized in the statechart reference.

**Tech Stack:** Markdown contracts, Node.js `node:test` catalog regression tests.

**Spec:** `skills/formal-verification/references/statechart.md` and `skills/formal-verification/references/project-contract.md`

## Global Constraints

- Do not refresh or modify vendored `skills/formal-verification/statechart/scripts/`; upstream runtime has no subtree delta.
- `formal-verification` remains the proof and verdict owner.
- Statechart output is evidence/interpretation, never proof by itself.
- Generated/project-local verification guidance must reference statechart semantically, not copy release-sensitive commands, options, or paths.

## Review Focus

- A failing TLC result is translated into a readable shortest counterexample path without becoming the verdict itself.
- A passing TLC result may produce a state-machine overview without being called proof.
- Tooling/render failures remain tooling failures, not property verdicts.
- The project contract makes result interpretation part of a reproducible TLA+/TLC handoff.
- No statechart runtime/vendor files change.

---

### Task 1: Lock the pstack #794 semantics with a failing catalog test

**Files:**
- Modify: `tests/skill-catalog/statechart-adoption.test.mjs`

**Interfaces:**
- Consumes: current statechart integration reference and project contract.
- Produces: regression assertions for result interpretation, proof ownership, and non-copied volatile command details.

- [x] **Step 1: Write the failing test**

Add assertions that the statechart reference requires interpreting each TLA+/TLC result, describes shortest readable counterexample paths and PASS overviews, and that the project contract records this handoff while preserving `formal-verification` ownership.

- [x] **Step 2: Run test to verify it fails**

Run through Release governance on RED commit `a16feb57b3188abac8d7c5b87c71463a1eefc4a2`.
Observed: the new statechart contract test failed because the result-interpretation text was absent. The same catalog run also exposed the unrelated existing `write-swift skill must exist` failure.

### Task 2: Extend the existing statechart and project contract minimally

**Files:**
- Modify: `skills/formal-verification/references/statechart.md`
- Modify: `skills/formal-verification/references/project-contract.md`

**Interfaces:**
- Consumes: Task 1 assertions.
- Produces: documented TLA+/TLC result-interpretation contract.

- [x] **Step 1: Update `statechart.md`**

State that every completed TLA+/TLC model-check result should be interpreted through statechart: shortest readable path for violations, state-machine overview for passing checks when useful, with chart output explicitly remaining evidence rather than proof. Keep commands/options/paths centralized in this reference.

- [x] **Step 2: Update `project-contract.md`**

Require TLA+/TLC-backed project-local verification handoffs to reference the statechart interpretation step rather than embedding statechart CLI details.

- [x] **Step 3: Run focused tests**

Release governance on GREEN head `9c4d305468efc9fed208546eb4fd6adba403c499` observed:
- statechart runtime tests: 2/2 PASS;
- the new statechart result-interpretation catalog test: PASS;
- existing statechart ownership/vendor tests: PASS.

- [x] **Step 4: Run routing/catalog verification**

Release governance on GREEN head observed:
- `node scripts/verify-skill-routing.mjs`: PASS;
- formal-verification structural validation: PASS;
- catalog: 57/58 PASS. The only remaining failure is the unrelated pre-existing Emil assertion `write-swift skill must exist`; the new statechart test is green.

- [x] **Step 5: Review diff**

Confirmed the change is limited to this plan, the two contract/reference files, and the focused regression test. No vendored `skills/formal-verification/statechart/scripts/` files changed.
