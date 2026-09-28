---
name: code-simplification
description: >-
  Specialist behavior-preserving readability refactor for already-working code. Use only when the user explicitly names code-simplification or asks for that named specialist. Covers guard clauses, descriptive names, local deduplication, and extraction of duplicated logic without changing behavior. Not for ordinary cleanup or generic simplify requests; use simplify.
---

# Code Simplification

> Adapted from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT). Inspired by Anthropic's code-simplifier plugin. Additional review lenses informed by [bholmesdev/skills](https://github.com/bholmesdev/skills/tree/main/skills/simplify).

## Overview

Simplify code by reducing complexity while preserving exact behavior. The goal is not fewer lines — it's code that is easier to read, understand, modify, and debug. Every simplification must pass: "Would a new team member understand this faster than the original?"

## When to Use

- After a feature works and tests pass, but the implementation feels heavier than needed
- During code review when readability or complexity issues are flagged
- Deep nesting, long functions, unclear names
- Refactoring code written under time pressure
- Consolidating scattered duplicate logic
- After merges that introduced duplication

**When NOT to use:**

- Code is already clean — don't simplify for its own sake
- You don't understand what the code does yet
- Performance-critical path where simpler version is measurably slower
- About to rewrite the module entirely

## The Five Principles

### 1. Preserve Behavior Exactly

All inputs, outputs, side effects, error behavior, and edge cases must remain identical. If unsure, don't make the change.

### 2. Follow Project Conventions

Read `AGENTS.md`, `.cursor/rules/*.mdc`, and neighboring code before simplifying. Simplification that breaks project consistency is churn.

### 3. Prefer Clarity Over Cleverness

Explicit code beats compact code that requires a mental pause.

### 4. Maintain Balance

Watch for over-simplification: inlining named helpers, merging unrelated logic, removing extensibility abstractions, optimizing for line count.

### 5. Scope to What Changed

Default to recently modified code. No drive-by refactors unless explicitly asked.

## The Simplification Process

### Step 1: Understand Before Touching (Chesterton's Fence)

Before changing or removing anything, understand why it exists:

- What is this code's responsibility?
- What calls it? What does it call?
- Edge cases and error paths?
- Tests defining expected behavior?
- Why written this way? (performance, platform, historical)
- Check git blame for original context

### Step 2: Identify Opportunities

**Structural:** deep nesting → guard clauses; long functions → split; nested ternaries → if/else or lookup; boolean flags → options object or separate functions.

**Naming and vocabulary:** generic (`data`, `result`) → descriptive; abbreviations → full words unless universal (`id`, `url`, `api`). Use one established term per concept and do not reuse the same term for materially different concepts. Remove words that merely repeat context already supplied by the module, type, namespace, or owning object, but never shorten a name into ambiguity. Prefer precise project or domain vocabulary over stylistic rules about word length.

**Comments and documentation:** keep comments that explain a non-obvious constraint, lifecycle rule, side effect, failure mode, or rationale the code cannot express. Remove comments that restate visible code, narrate the PR or conversation, or require implementation history to make sense. Add a doc comment when complex behavior or side effects are otherwise easy to miss.

**Reading order and cohesion:** make the primary or exported behavior easy to find when project conventions support it. Move low-level helpers below the behavior they support only when that improves local reading order without formatting churn. Split large files by owned concept, and combine overlapping concepts only when their responsibilities and invariants are genuinely the same.

**Redundancy and reuse:** duplicated logic → extract; dead code → remove; wrapper adding no value → inline; speculative abstractions → remove. Search for existing repository utilities before introducing or retaining a local copy, but do not increase coupling merely to deduplicate a small amount of clear code.

**Derivable state:** identify stored, passed, cached, or synchronized values that can be computed from an existing authoritative value. Remove them only after proving recomputation preserves performance, timing, snapshot semantics, consistency boundaries, and side effects.

**Unshipped compatibility:** identify aliases, adapters, fallback formats, old signatures, or data shapes introduced and superseded entirely within the current unmerged change. Remove them only after proving the old form was never shipped, persisted, externally consumed, or relied on by fixtures, generated artifacts, downstream branches, or tests.

**Standalone readability:** names, comments, and structure must make sense to a reader who never saw the issue, PR, conversation, or commit history. Replace temporary discussion language with the codebase's own vocabulary.

Treat every item above as a candidate signal, not an automatic edit. Repository conventions and the local design override generic style preferences. When behavioral equivalence or the ownership boundary is uncertain, leave the code unchanged and report why.

### Step 3: Apply Incrementally

One simplification at a time. Run tests after each. **Separate refactoring PRs from feature/bugfix PRs.**

**Rule of 500:** If refactoring touches >500 lines, use codemods/AST transforms — not manual edits.

### Step 4: Verify the Result

- Genuinely easier to understand?
- Uses consistent, precise project vocabulary?
- Comments explain hidden constraints rather than visible mechanics?
- No duplicated or manually synchronized state remains without a reason?
- Understandable without the issue, PR, conversation, or commit history?
- Consistent with codebase?
- Clean, reviewable diff?
- Would a teammate approve?

If "simplified" is harder to follow, revert.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It's working, no need to touch it" | Hard-to-read working code costs on every future fix. |
| "Fewer lines is always simpler" | Comprehension speed matters, not line count. |
| "I'll simplify unrelated code too" | Unscoped simplification creates noisy diffs and regressions. |
| "I'll refactor while adding this feature" | Split changes — mixed PRs are harder to review and revert. |
| "This state can be derived" | Derivation is safe only when timing, performance, snapshots, and side effects remain equivalent. |
| "That compatibility path never shipped" | Prove it across persistence, fixtures, generated artifacts, downstream branches, tests, and external consumers. |

## Verification

- [ ] All existing tests pass without modification
- [ ] Build and lint pass
- [ ] Incremental, reviewable changes only
- [ ] No inputs, outputs, ordering, errors, side effects, timing guarantees, persistence, or compatibility changed
- [ ] No error handling, validation, authorization, security control, or auditability removed or weakened
- [ ] Derivable-state and unshipped-compatibility claims are backed by repository evidence
- [ ] Names, comments, and structure stand alone without PR or conversation context
- [ ] Follows `AGENTS.md` and project conventions
- [ ] Net improvement a reviewer would approve
