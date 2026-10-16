# Manager State Reference

This file is the canonical contract for `state.json` — the single authoritative source
for the manager loop in a dynamic workflow. Read this when implementing, extending, or
debugging the orchestration state machine.

## Ownership rule

**Only the thinker/manager writes `state.json`.** Workers write only their own
`result_artifact` under `results/`. External projections (e.g. Linear) are optional
and must never be treated as runtime dependencies.

## `state.json` schema

```jsonc
{
  "workflow_id": "string",
  "status": "pending|in_progress|review|accepted|blocked",
  "repository": {
    "root_name": "repo-directory-name",
    "remote": "origin-url-or-null",
    "base_branch": "main",
    "base_head": "40-char-sha",
    "working_branch": "feature/example",
    "working_head": "40-char-sha",
    "created_at": "ISO-8601",
    "last_validated_head": "40-char-sha"
  },
  "ACCEPT": null,
  "merge_authorization": null,
  "packets": [
    {
      "id": "string",
      "kind": "AFK|HITL",
      "status": "pending|ready|in_progress|review|needs_correction|accepted|blocked",
      "dependencies": ["packet-id"],
      "owner": "string",
      "execution_wave": 1,
      "result_artifact": ".workflow/<slug>/results/<id>.md",
      "checks": ["acceptance check"],
      "validated_findings": [],
      "correction_attempts": 0,
      "reviewer_wave": 0,
      "requested_input": null,
      "input_evidence": null
    }
  ]
}
```

## Repository provenance

Durable workflow state is valid only for the repository state it was designed against. `scripts/new_workflow.py` captures the repository identity, base branch/head, current working branch/head, creation time, and the last validated head when the workflow is scaffolded.

Before resuming a persisted workflow, run `scripts/verify_workflow.py`. It fails with `stale workflow provenance` when the repository, origin, base branch head, working branch, or working head no longer matches the captured state. Do not silently reuse a plan after that failure. Inspect what changed and decide whether the existing plan still applies, needs repair, or should be replaced.

When the manager intentionally advances the same working branch after reviewing the new head, run:

```text
python scripts/verify_workflow.py .workflow/<slug> --refresh-provenance
```

Use `python3` when that is the host launcher. The refresh path may update only `working_head` and `last_validated_head`, and only when repository identity, branch, and base provenance still match. A moved base branch or changed repository identity requires explicit reconciliation rather than an automatic refresh.

`base_head` is the design baseline. `working_head` is the last manager-accepted working-tree head. `last_validated_head` is the head most recently recorded through the provenance refresh path. Keep these as full Git SHAs. Do not replace them with branch names, timestamps, or human descriptions.

## Packet lifecycle

```
pending -> ready -> in_progress -> review -> accepted
                                   review -> needs_correction -> in_progress  (at most once per packet)
any nonterminal -> blocked
```

No other automatic transitions. No wave 3 for reviewer. No automatic retry after
the first `needs_correction` cycle — the thinker takes ownership or marks blocked.

## Field notes

| Field | Notes |
|---|---|
| `status` (workflow) | Lifecycle of the whole workflow. |
| `repository` | Head-bound provenance for safe resume; stale state blocks until reconciled. |
| `ACCEPT` | `null` until CEO Phase 7 final review passes; then `{ summary, recorded_at (ISO-8601) }`. |
| `merge_authorization` | Set when user explicitly grants it: `{ verbatim_instruction, source, recorded_at, consumed_at: null }`. Consumed only in CEO Phase 8 after `ACCEPT` exists; recording early never bypasses final review. |
| `kind` | `AFK` = agent can implement without human judgment. `HITL` = human decision needed. |
| `dependencies` | Packet IDs that must all be `accepted` before this packet becomes `ready`. |
| `execution_wave` | Integer; 1 = first wave; higher values depend on lower waves completing first. |
| `result_artifact` | Single relative path to the worker output file. Workers write only this file. |
| `checks` | Acceptance criteria matched by the reviewer. |
| `correction_attempts` | Max 1 per packet. After that the thinker takes over or marks blocked. |
| `reviewer_wave` | 0 = not yet reviewed; 1 = first pass; 2 = final. No automatic wave 3. |
| `requested_input` | HITL only — the question or decision required before proceeding. |
| `input_evidence` | HITL only — recorded answer. Packet must not become `ready` until both fields are populated. |

Never embed transcripts or full logs in `state.json`; reference `result_artifact` instead.

## ACCEPT and merge_authorization

- `ACCEPT` is the gate for final CEO Phase 7 review. The structured merge integration
  step (Phase 8) may only proceed after `ACCEPT` is an object.
- `merge_authorization` records an explicit user grant and may be set at any time,
  but is **consumed** only after `ACCEPT` exists.
- Neither field bypasses the reviewer loop or the correction limit.

## AFK / HITL gates

- `AFK` packets may proceed without additional human input.
- `HITL` packets block until `requested_input` is resolved and `input_evidence` is populated.
- A packet must not transition to `ready` while its HITL gate is unresolved, even if
  all `dependencies` are `accepted`.

## Dependency and input gates

A packet becomes `ready` only when:
1. All `dependencies` are in state `accepted`.
2. If `kind == "HITL"`: `input_evidence` is populated.

## Correction and reviewer limits

- `correction_attempts` max 1 per packet.
- `reviewer_wave` max 2 per packet; no automatic wave 3.
- After one correction cycle the thinker takes ownership or marks the packet `blocked`.

## Compact artifact rule

Workers write a single `result_artifact` file per packet. No transcripts, no raw
logs, no bulk history. The thinker synthesizes across artifacts during integration.

## Linear (optional external projection)

Linear is an optional external projection of `state.json`, not a runtime dependency.

- Use github-delivery `references/issue-workflows.md` → Issue Breakdown for vertical slices, dependencies, and AFK/HITL classification.
- Draft issues locally without external authority.
- Create or update Linear only with explicit user authority and a resolved toolkit, team, project, and state.
- Never block execution on Linear availability.