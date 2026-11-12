# Diagnose missing Codex memories without changing local data

The global AgentHub Memory MCP is **read only**. Registering an approved project for reads does not enable capturing memories from that project's Codex conversations.

The separate Codex UserPromptSubmit hooks perform candidate capture, based on narrow explicit decision/preference/correction rules; prompts that do not match can remain unrecorded. Even when --auto-pipeline appears in hook configuration, the **UserPromptSubmit auto-pipeline launch is gated off on Windows** in the current runtime. This is a code-level observation, not proof that a specific user's hooks have actually executed or that no alternative Stop/passive pipeline has run.

**Windows Stop backlog repair:** Codex `Stop`/`SubagentStop` events may legitimately contain `last_assistant_message: null`. The background Stop pipeline now checks the pre-existing current-project/current-branch candidate queues even in this case, without pretending a missing assistant reply was an agent decision. It performs an inexpensive **read-only** queue preflight and skips empty queues, keeping judge execution and unnecessary pipeline records out of empty turns. A failed agent-decision capture does not suppress already captured direct-user candidates. This does **not** enable the disabled Windows UserPromptSubmit detached worker, bypass confirmation requirements, or promote ordinary prompts automatically without the existing judge/promotion gates. The Win32 Codex CLI executable prerequisite and retry backoff continue to apply.

## Local judge prerequisites (read-only, no model calls)

The diagnostic output now includes a `judge_prerequisites` object: `executable` is a sanitized, no-shell Codex CLI resolver result, `executable_kind` is `native`, `npm_js`, `node_js` or `path_command`; `auth_file` reports only whether the source Codex home's `auth.json` is an ordinary file. Paths, tokens, accounts and auth file contents are neither read nor included in the report. The diagnostic does **not** execute the Codex CLI, perform a model call, refresh the database or validate actual login/credits.

- `cli_not_resolved`: Codex CLI is not locatable through the Judge's real no-shell resolver. Installing/configuring only Codex Desktop will not fix this.
- `auth_file_not_ready`: The isolated judge cannot copy the required `auth.json`; check the original CLI auth location, not the memory database.
- `prerequisites_present_unverified`: The preflight passed, but this does **not** prove the CLI can authenticate to the model, that the model exists, or that rate limits allow the judge. Historical `codex_exec_nonzero` cannot be attributed to any one root cause from aggregate counters alone.

The regular diagnostic's `runtime_execution_observed: false` remains a deliberate limitation. Configuration and historical evidence counts are not direct proof of a new post-update Desktop hook invocation.

## Operator-safe diagnosis (PowerShell 7, Node.js 24+)

Run in the AgentHub checkout after pulling the merged feature:

~~~powershell
Set-Location "$HOME\Downloads\AgentHub-ReadOnly-Preview"
git pull --ff-only
node .\scripts\diagnose-codex-memory-pipeline.mjs
~~~

The command loads the existing per-user approved scope manifest and opens exactly its configured canonical SQLite in read-only mode. It reports **counts only** for all enrolled projects and the current Git branch: captured evidence (including user prompts), memory candidates by status, active/other-branch Claims, claim authority classes, FTS coverage, pipeline history and failures, and a conservative upper bound on Claims that might be recalled. A snapshot of the global Codex hook **configuration** is included, not verification that the Codex Desktop host actually executed these hooks.

No claim content, evidence text, transcripts, credentials, model prompts, or individual user messages are read or emitted. There is no memory capture, approval, promotion, freshness update, diagnostic telemetry write, or Codex configuration change.

## Failure triage without opening private logs

For projects with repeated `partial` runs, the same command additionally reports these **aggregate codes only**:

- `pipeline_failure_codes.by_stage`: counts by internal pipeline stage (such as importance, relation, promotion, pipeline_control or worker).
- `pipeline_failure_codes.by_error_class`: counts by exception type (such as TimeoutError or PipelineStalled). **No error_text is selected or displayed.**
- `pipeline_latest_failure_at`: the time of the newest recorded failure.
- `pipeline_running_older_than_30m`: persistent "running" records older than 30 minutes. These may indicate interrupted observability; they do not prove a live process exists. **Do not delete SQLite rows or lock files solely because a run is old.**
- `active_claim_blockers`: *overlapping* counts of disallowed primary authority, stale/unverified file-path evidence, historical runtime E2E seed markers and open conflict membership. These do not exhaust supporting-Evidence restrictions.

### Importance failure signatures without model-output disclosure

When Stage=importance and error_class=candidate_stage_failure, the existing local diagnostic now reports **importance_failure_signatures**. It groups persisted error_text using fixed SQL patterns **inside SQLite**, returning only predefined categories and counts. The raw error strings, paths, stderr, model responses, and secrets are never selected into Node or printed. No candidate is retried and the database remains read-only.

The fixed categories are: auth_file_missing, codex_executable_not_found, codex_spawn_permission_denied, isolated_git_init_failed, judge_timeout, auth_rejection_possible, rate_limited_possible, quota_exceeded_possible, judge_json_missing, judge_json_invalid, judge_schema_invalid, judge_policy_invariant_failed, codex_exec_nonzero, and unclassified. Labels ending in _possible indicate a substring match, not proven root cause. codex_exec_nonzero only means the CLI failed; it does not establish why.

PowerShell 7 (summary only):

~~~powershell
Set-Location "$HOME\Downloads\AgentHub-ReadOnly-Preview"
git pull --ff-only
$report = node .\scripts\diagnose-codex-memory-pipeline.mjs | Out-String | ConvertFrom-Json
$report.projects | Where-Object { $_.status -eq 'inspected' } |
    ForEach-Object {
        [pscustomobject]@{
            Project = $_.project_id
            ImportanceErrors = ($_.counts.importance_failure_signatures | ConvertTo-Json -Compress)
        }
    } | Format-List
~~~

A single looping candidate may generate hundreds of failure rows. The code summarizes the top 100 distinct stage/class pairs, not the full unsanitized error logs. If codes point to transient model availability, invalid judge output or pipeline control stalls, inspect the relevant implementation and plan one targeted fix rather than repeatedly re-running the pipeline.

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

## Windows Codex CLI judge execution and bounded automatic retry

The original Codex Desktop global MCP can read memory independently of the Codex **CLI** used by the separate candidate and agent-decision judges. A working MCP does **not** imply that the background Judge can spawn the CLI.

Windows Node child_process.spawn('codex') does not reliably execute an npm codex.cmd shim without a shell. The judge now resolves an actual codex.exe from PATH or the standard current-user standalone installer path, or resolves an npm codex.cmd to its @openai/codex/bin/codex.js entrypoint and executes it via process.execPath. It never runs the shim through cmd.exe, shell:true, or interpolates candidate text into command arguments. If neither is available, it reports a clean CODEX_JUDGE_CLI_NOT_FOUND without launching a failing judge.

The same no-shell resolver is used by direct-user importance/relation judges and agent importance/relation judges. An explicitly configured AGENT_HUB_MEMORY_JUDGE_CODEX_BIN or CODEX_BIN must be an absolute existing native executable, JavaScript entrypoint or supported npm shim. Do not set this to a PowerShell shim, arbitrary batch file or untrusted path.

The automatic Stop/SubagentStop pipeline worker (only) now performs this CLI prerequisite check before it creates another pipeline run. It uses existing failure records to apply a **temporary**, read-only circuit breaker: rate-limit signals pause automated attempts for 10 minutes; two recent auth signals pause them for 10 minutes; five recent non-missing-CLI failures pause them for 3 minutes. Historical missing-CLI failures alone never suppress a newly working CLI. A deferred run does not change, reject, or promote any memory candidate and does not write another run/failure record. The backoff does not claim to fix authentication or rate limits, and the current `codex exec` failure may still require direct diagnosis.

To inspect Windows CLI availability without sending data or invoking a model:

~~~powershell
Get-Command codex -All | Select-Object Name, CommandType, Source
where.exe codex
~~~

Codex CLI installation and authentication are separate prerequisites from the desktop app/MCP. After installation changes, restart Codex Desktop so its background hook processes get the updated PATH. Do not copy auth.json into chat or log it. A missing auth.json, a rejected token, 429, and an unsupported model are different failure modes; the resolver fixes only executable discovery.
