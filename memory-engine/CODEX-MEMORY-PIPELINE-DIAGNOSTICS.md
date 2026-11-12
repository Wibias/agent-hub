# Diagnose missing Codex memories without changing local data

The global AgentHub Memory MCP is **read only**. Registering an approved project for reads does not enable capturing memories from that project's Codex conversations.

The separate Codex UserPromptSubmit hooks perform candidate capture, based on narrow explicit decision/preference/correction rules; prompts that do not match can remain unrecorded. Even when --auto-pipeline appears in hook configuration, the **UserPromptSubmit auto-pipeline launch is gated off on Windows** in the current runtime. This is a code-level observation, not proof that a specific user's hooks have actually executed or that no alternative Stop/passive pipeline has run.

## Operator-safe diagnosis (PowerShell 7, Node.js 24+)

Run in the AgentHub checkout after pulling the merged feature:

~~~powershell
Set-Location "$HOME\Downloads\AgentHub-ReadOnly-Preview"
git pull --ff-only
node .\scripts\diagnose-codex-memory-pipeline.mjs
~~~

The command loads the existing per-user approved scope manifest and opens exactly its configured canonical SQLite in read-only mode. It reports **counts only** for all enrolled projects and the current Git branch: captured evidence (including user prompts), memory candidates by status, active/other-branch Claims, claim authority classes, FTS coverage, pipeline history and failures, and a conservative upper bound on Claims that might be recalled. A snapshot of the global Codex hook **configuration** is included, not verification that the Codex Desktop host actually executed these hooks.

No claim content, evidence text, transcripts, credentials, model prompts, or individual user messages are read or emitted. There is no memory capture, approval, promotion, freshness update, diagnostic telemetry write, or Codex configuration change.

Typical findings:

- **no_captured_evidence:** no evidence was stored for the project. Check actual hook installation/trust and whether UserPromptSubmit fired; read-only MCP registration is not capture registration.
- **no_user_prompt_evidence:** other evidence exists but no user prompt captures.
- **evidence_but_no_candidates_or_claims:** evidence capture alone has not created durable Claims.
- **pending_user_candidates_without_pipeline_runs:** capture worked; the candidate pipeline has not processed it in that branch. On Windows the prompt-hook auto-launch is intentionally absent.
- **candidates_need_confirmation:** safe promotion requires user review.
- **candidate_or_pipeline_failures:** pipeline attempted processing but failed; use focused logs before any repair.
- **claims_exist_only_on_other_branches:** current-branch recall will not return those Claims.
- **no_potentially_authorized_current_claims:** no current active Claims pass a simplified path/authority/conflict check (supporting provenance may also matter).
- **some_potentially_retrievable_claims_check_query_matching:** at least one Claim could be available, but a keyword search such as "Rillmux" can still legitimately return nothing if the terms do not occur in an eligible Claim.

The eligible count is an **upper bound**, not a guarantee of a retrievable Claim: it does not fully model supporting evidence or every synthetic-provenance exclusion. Do not promote/rewrite memories just to obtain a PASS.

## What to report

Return the command's JSON status, hooks section, and per-project counts/findings. This is sufficient to identify whether the blocker is capture, candidate evaluation/promotion, branch-scoping, reliance/freshness or recall-term matching, without sharing memory content.

**Production:** this diagnosis does not change the C9 Write-Broker, Graph P70 production pins or security gates.
