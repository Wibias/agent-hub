---
name: writing-ticks
description: >
  Use when auditing prose for AI writing tells, humanizing LLM-sounding text,
  reviewing docs/blog/README/PR/email/essay copy for ChatGPT cadence, "writing
  ticks", signs of AI writing, AI slop in text, or when the user asks to make
  writing sound human. Distinct from design-with-ai (UI marketing anti-slop) and `intent` content strategy (product UX microcopy). `articulate` is not installed.
---

# Writing ticks

Audit and rewrite prose against known LLM style patterns (source:
[Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)).

**Core principle:** Signs are *symptoms*, not a verdict. Fix the hollow voice —
generic significance, puffy analysis, template structure — not just the
surface words. Synonym-swapping "delve" while keeping empty legacy claims is a
failed audit.

## When to use

- "Does this sound AI?" / "humanize this" / "remove AI writing ticks"
- Docs, README, blog, email, essay, PR description, release notes, proposal
- Reviewing agent-drafted prose before ship

## When not to use

- **UI / marketing landing copy** → `design-with-ai` (+ `references/copy-authenticity.md`)
- **Product microcopy** (errors, CTAs, empty states) → `intent` plus `references/content-strategy.md` (`articulate` is not installed)
- **Code style** → domain skills, not this
- Claiming "human-written" as a legal/forensic fact — this is a style audit only

## Workflow

### 1. Intake

- Get the full text (paste, path, or selection). Prefer the real draft, not a summary.
- Note audience and register (technical, casual, encyclopedic, sales). Do not
  force Wikipedia tone onto marketing or chatty email.
- Mode: **audit only** (default) or **audit + rewrite**.

### 2. Load the checklist

Read `references/signs-checklist.md` before scoring. For edge cases or Wikipedia
wiki-markup tells, fetch the live page:
`https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing`

Do **not** rely on GPTZero-class detectors as primary evidence.

### 3. Audit (pass every category)

Score findings as:

| Severity | Meaning |
|----------|---------|
| **High** | Dense AI vocab cluster, legacy/puff template, negative parallelisms stacked, outline "Despite challenges… future outlook" formula |
| **Med** | Occasional copula avoidance, rule-of-three lists, superficial -ing closers, em-dash cadence |
| **Low** | Single common word, one bold phrase, minor elegant variation |

For each finding: **quote** → **sign id** (from checklist) → **why it reads LLM** → **fix direction**.

### 4. Report shape (required)

```markdown
## Verdict
[clean | mild ticks | heavy LLM voice] — one sentence why

## Findings
1. **[High|Med|Low]** `sign-id` — "quoted span…"
   - Why: …
   - Fix: …

## Density notes
- AI-vocab hits (count + words)
- Structural templates present/absent
- Copula avoidance / negative parallelisms / RO3

## Keep as-is
- Legitimate technical terms, brand voice, intentional rhetoric
```

Never invent findings to look thorough. Empty findings + clean verdict is fine.

### 5. Rewrite (only if asked or mode = rewrite)

Rewrite goals, in order:

1. **Specific over grand** — drop unearned "pivotal / testament / landscape" claims
2. **Plain copulas** — prefer *is/are/has* over *serves as / boasts / stands as*
3. **Kill template arcs** — no forced Challenges → Future Outlook unless content needs it
4. **Break false triples** — two items or a real list beats decorative threes
5. **One idea per sentence** — cut trailing "-ing" significance clauses
6. **Match the user's voice** — if samples exist, mirror them; else plain and concrete

After rewrite: re-run steps 3–4 on the new text. Ship only when High findings are gone
and Med findings are intentional or rare.

### 6. Anti-patterns (do not)

| Excuse | Reality |
|--------|---------|
| "I replaced delve with explore" | Vocab alone ≠ human; structure and puff remain |
| "Add more personality with emojis" | Emoji chrome is itself an AI/style tell in serious prose |
| "Make it more formal to sound human" | Formality without specificity still reads LLM |
| "Detector said 12% AI so we're fine" | Detectors error; checklist judgment wins |
| "This is technical so ticks don't matter" | Technical prose still benefits from plain verbs |

## Sibling skills

- `design-with-ai` / `references/copy-authenticity.md` — UI strings, hero copy, component labels
- `intent` plus `references/content-strategy.md` — product voice, errors, CTAs, empty states (`articulate` is not installed)

## Source hygiene

Checklist is a **condensed field guide** adapted for general writing. Upstream:
WikiProject AI Cleanup essay (descriptive, not Wikipedia policy). Patterns drift
as models change — prefer live page when the draft is contested or post-dates
the skill.
