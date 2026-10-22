---
name: grilling
description: >-
  Interview or explore with the user before acting. Use when the user says grill,
  grill me, stress-test this plan/decision/idea, explicitly wants intent
  extracted before a spec, or asks to ideate/refine a still-vague idea before
  choosing a direction. `decision` mode works a decision frontier, `intent` mode
  discovers the desired outcome one question at a time, and `ideation` mode
  expands distinct options before converging. Not a code review or an
  implementation skill.
---

# Grilling

Choose the interaction shape from the request. Do not silently combine modes.

## Mode routing

- **`decision` (default for "grill", "stress-test", plan/architecture choices):** use the decision tree below. Ask the currently unblocked frontier in rounds.
- **`intent` (explicit "interview me", "figure out what I actually want", underspecified product outcome before a spec):** load `references/intent-interview.md`. Ask one focused question at a time with a visible hypothesis/guess, then produce a confirmed intent statement.
- **`ideation` (explicit "ideate", "refine this idea", "explore directions", or a vague idea that the user wants expanded before choosing):** load `references/ideation.md`. Ground in the rawest useful evidence, create meaningfully different directions, then converge on assumptions and trade-offs without implementing.

If the user explicitly names a mode, honor it. If the ask is merely underspecified but the user did not ask for an interview or ideation, do not hijack a clearly actionable task with a long discovery process; ask only the genuinely blocking question or let the owning downstream skill handle its normal clarification contract.

## Decision mode

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each question should be formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it when the host supports that; don't ask the user for anything you could look up yourself. A running exploration is an unsettled prerequisite, so only downstream questions wait; ask the rest of the frontier now. The _decisions_ are the user's — put each to them and wait.

The session is done when the frontier is empty: every material branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

## Intent mode

Load `references/intent-interview.md`. Its deliverable is a user-confirmed statement of intent, not a spec or implementation plan.

## Ideation mode

Load `references/ideation.md`. Its deliverable is a bounded set of genuinely different directions, a recommended direction when the user is ready to converge, explicit assumptions, and a `Not Doing` list. It does not implement the idea or silently turn exploration into a build plan.

## References
<!-- eval:references -->
- references/intent-interview.md -- when to read: intent mode
- references/ideation.md -- when to read: ideation mode
- tests/evals/cases.jsonl -- when to read: as canonical acceptance criteria during qualification review
- tests/evals/regression-cases.jsonl -- when to read: when reviewing retained failures and successors
- tests/evals/regression-lock.json -- when to read: when validating immutable retained regressions
<!-- /eval:references -->
