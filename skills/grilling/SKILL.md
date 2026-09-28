---
name: grilling
description: >-
  Interview the user to reach shared understanding before acting. Use when the
  user says grill, grill me, stress-test this plan/decision/idea, wants a
  decision-tree interview, or explicitly wants intent extracted before a spec.
  `decision` mode preserves the multi-question frontier/tree workflow; `intent`
  mode asks one question at a time to discover outcome, user, success, binding
  constraint and out-of-scope. Called by improve-codebase-architecture after a
  candidate is picked. Not a code review and not an implementation skill.
---

# Grilling

Choose the interview shape from the request. Do not silently combine both modes.

## Mode routing

- **`decision` (default for "grill", "stress-test", plan/architecture choices):** use the decision tree below. Ask the currently unblocked frontier in rounds.
- **`intent` (explicit "interview me", "figure out what I actually want", underspecified product outcome before a spec):** load `references/intent-interview.md`. Ask one focused question at a time with a visible hypothesis/guess, then produce a confirmed intent statement.

If the user explicitly names a mode, honor it. If the ask is merely underspecified but the user did not ask for an interview, do not hijack a clearly actionable task with a long interview; ask only the genuinely blocking question or let the owning downstream skill handle its normal clarification contract.

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
