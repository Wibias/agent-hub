# Memory Quality Baseline — 2026-11-23

This baseline records what is currently measured for the normal local Memory MVP. It separates deterministic fixtures, real provider runs and unvalidated assumptions. It is not a claim of production accuracy.

## Scope

- Repository: `Wibias/agent-hub`
- Host: Windows 11 x64, Node.js 24
- Base revision before the atomic-capture changes: `2017c6e9b927e6da847d1bcd63521c3e548ce4e8`
- No protected-approval or Reference-Graph production claim is included.

## 1. Atomic extraction shadow

Command:

~~~text
node scripts/eval-memory-atomic-shadow.mjs
~~~

Dataset: `memory-engine/memory-atomic-shadow-fixtures.mjs`

| Metric | Value | Denominator / definition |
|---|---:|---|
| Fixtures | 22 | Hand-labeled synthetic messages |
| Expected review suggestions | 8 | Fixture labels |
| Actual review suggestions | 8 | Deterministic extractor output |
| Matched | 8 | Same fragment and disposition |
| Missed | 0 | Expected but absent |
| False positives | 0 | Present but not expected |
| Precision on fixtures | 1.0 | 8 / 8 |
| Recall on fixtures | 1.0 | 8 / 8 |
| Old baseline whole-prompt captures | 5 | Of 22 fixtures |

Limits:

- **Synthetic only.** These fixtures are not representative of production messages.
- The metric measures deterministic review-proposal coverage, not model judgment or promotion correctness.
- Status: `PROVISIONAL`, `NOT HUMAN-VALIDATED`.

## 2. Deterministic lifecycle smoke

Command:

~~~text
node scripts/eval-memory-end-to-end-smoke.mjs
~~~

The deterministic mode uses explicit fixture judges, not a model.

| Check | Result |
|---|---:|
| Lifecycle checks | 50 / 50 |
| Promoted candidates | 5 |
| Needs confirmation | 1 |
| Ignored | 1 |
| Kept for review | 1 |
| Superseded | 1 |
| Update | 1 |
| Conflict | 1 |

This verifies transaction and lifecycle mechanics. It does **not** measure real model precision.

## 3. Real provider runs

The isolated judge now copies only model-routing keys from the source Codex config. It uses the configured local `opencode-go` route and no longer falls back to the exhausted default provider.

Observed real results:

- Durable candidate: importance `promote`, relation `unrelated`, Claim created, zero failures.
- Contradiction: importance `promote`, relation `contradict`, new Claim created, one open conflict persisted, no winner chosen.
- Update: importance `promote`, relation `update`, old Claim superseded, new Claim active, lifecycle event persisted.

Full provider smoke:

- Run 1 stopped at `contradict.promoted` with the candidate still `pending`.
- Run 2 stopped at `same.superseded_candidate` with `needs_confirmation`.
- The isolated contradiction and update reruns passed the same stages.

Interpretation: the pipeline is functional; the model is conservative and nondeterministic on near-duplicate and contradiction cases. Do not convert these runs into an aggregate quality score. Status: `PROVISIONAL`, `NOT HUMAN-VALIDATED`.

## 4. Retrieval

Real query: "Which operating systems does the assistant host support?"

| Metric | Value |
|---|---:|
| Retrieval mode | hybrid |
| Fallback | none |
| Retrieved | 1 |
| Retained | 1 |
| Selected | 1 |
| Semantic rank | 1 |
| Similarity | 0.7798897848319597 |

Negative query "zzz": 0 retrieved. An unapproved project was denied with `project_not_approved`. Branch isolation was tested with a separate branch in a temporary database.

This is a small real acceptance sample, not a Precision@K/Recall@K benchmark. Status: `PROVISIONAL`.

## 5. Graph and dashboard

Graph fixture through the real HTTP route:

| Item | Value |
|---|---:|
| Nodes | 3 |
| Edges | 2 |
| Edge types | `conflicts_with`, `supersedes` |
| Claim states | `active`, `active`, `superseded` |

Live dashboard:

- 12 registered projects
- AgentHub: 2 branches, 2 active Claims
- Semantic embedding coverage for the inspected scope: 100%
- Pending candidate: 1 legacy 21,977-character record
- Historical pipeline run: `partial` from the earlier quota failure

Embedding coverage is not memory accuracy. It only means every inspected Claim has an embedding.

## 6. Atomic capture integration

The productive capture path now:

1. Sends prompts above 4,000 characters through the deterministic atomic extractor.
2. Accepts at most 5 suggestions per prompt.
3. Stores the full prompt as parent Evidence.
4. Stores each verbatim fragment as derived Evidence with `parent_evidence_id`, `span_start`, `span_end`, source hash and fragment hash.
5. Creates one ordinary Candidate per fragment, with the existing authority, fingerprint, judge, promotion and lifecycle rules.

Verified cases:

- Long prompt with no durable information: no Evidence, no Candidate.
- Long prompt with one durable statement: one exact span and one Candidate.
- Long prompt with independent statements at start, middle and end: separate Candidates.
- Contradictory or similar statements: separate Candidates; no automatic merge.
- Quoted injection: rejected.
- Prompt above the 20,000-character source bound: rejected.
- Duplicate fragment: no second Candidate.
- Prompt above 24 sentences but below 200 segments: extraction still works.
- Exact source invariant: `parent.slice(start, end) === candidate.proposed_value`.

Limits:

- The extractor is deterministic and cue-based; it is not a semantic model extraction.
- It rejects sources above 20,000 characters and more than 200 segments.
- It caps capture at 5 suggestions.
- Human review and the existing judge remain required.
- The 21,977-character legacy Candidate predates this path and remains non-actionable.

## 7. Human validation status

No independent human ground-truth review has been completed for this baseline. Therefore:

- All quality numbers above are `PROVISIONAL`.
- No accuracy, F1 or retrieval benchmark is reported as human-validated.
- The protected approval lane is unchanged and remains `NO-GO`.

## 8. Repetition commands

~~~text
node --test tests/memory-engine/memory-candidates.test.mjs
node --test tests/memory-engine/memory-atomic-candidate-shadow.test.mjs
node scripts/eval-memory-atomic-shadow.mjs
node scripts/eval-memory-end-to-end-smoke.mjs
node --test tests/memory-engine/codex-hybrid-recall.test.mjs
~~~

The provider smoke requires the configured local Codex provider and a disposable database.

## 9. Human review packet (2026-11-27)

`docs/memory-quality-review-2026-11-27.json` contains 20 synthetic review cases across capture, importance, dedupe, update, conflict, agent provenance and retrieval. It contains no production memory text. The packet is intentionally marked `humanValidated: false`; until a human reviews it, no score derived from these cases is human-validated.

