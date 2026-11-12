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

## Codex usage-limit and quota failure classification (2026-11-12)

The opt-in synthetic Judge smoke now classifies the *actual process error text* into fixed, secret-free codes without printing CLI stdout/stderr, model results, account names, local paths or reset timestamps. It reports only a sanitized `process_exit_code` integer when present. **A classification with `_possible` is evidence that the CLI error contains a matching signature, not independent proof that the account has zero quota.**

- `usage_limit_reached_possible`: Codex-specific usage-window messages such as `You've hit your usage limit`, including errors that happen to carry HTTP 429.
- `credits_exhausted_possible`: `Your workspace is out of credits` or equivalent depleted-credit errors.
- `spend_cap_reached_possible`: workspace spending cap or hard billing limit.
- `quota_exceeded_possible`: `Quota exceeded` or `insufficient_quota`.
- `rate_limited_possible`: generic 429, rate limit exceeded or too many requests, *without* a stronger usage-window/credit/quota signature.
- `authentication_rejected_possible`, `model_unavailable_possible`, `cli_configuration_or_arguments_possible` and `network_unavailable_possible` cover other common messages.
- `codex_exec_nonzero_unclassified` remains valid when no reliable pattern matches. Never guess quota based on the integer exit code alone.

The automatic Stop/SubagentStop candidate worker additionally applies a **read-only 15-minute cooldown** after an actual logged quota/usage-window/credit/spend-cap error, rather than retrying expensive model calls on every turn. A generic transient HTTP 429 retains its separate 10-minute cooldown. The database is unchanged by this preflight. There is no automatic credit purchase, claim promotion, bypass of permissions or broker production gate.

**Previously emitted smoke JSON cannot be reclassified retroactively:** the deliberate privacy design discarded the original process stderr, so the old `codex_exec_nonzero_unclassified` result alone cannot reveal whether quota was the cause. Prefer checking the Codex usage page before any new model smoke. A new opt-in `--run-model` invokes a real model and may consume quota; it is not required to install or test the improved classifier.

## Offline follow-up for an unclassified Judge exit

A result of `codex_exec_nonzero_unclassified` from the synthetic model smoke means that the process exited unsuccessfully, but the known failure classifications did not identify why. **Do not share the raw Codex CLI stderr**, which can contain account details or local paths. Do not repeatedly run the model smoke.

First inspect the exact Codex runtime in the same disposable, auth-only environment with **zero model calls**:

~~~powershell
$preview = Join-Path $env:LOCALAPPDATA 'AgentHub-Memory-Write-Preview'
git -C $preview pull --ff-only
node "$preview\scripts\smoke-codex-memory-judge.mjs" --inspect-cli
~~~

The inspection runs only `codex --version`, `codex login status` and `codex exec --help` with the same no-shell resolver and a fresh isolated `CODEX_HOME`. It reads only metadata about the user's `config.toml`; the config is **not** copied or printed. The tool discards all CLI stdout/stderr except for narrow extraction of a version string and a fixed set of supported flags. It reports `isolated_login_status` as `accepted_by_cli_unverified` or `not_accepted_or_unavailable`, never an account name or token.

The distinction matters: the production Judge copies `auth.json`, but intentionally **does not copy `config.toml`**, profiles, MCPs or arbitrary provider settings. A user who depends on a custom model/provider in the main Codex configuration may have different effective settings inside the isolated Judge. The presence of source `config.toml` alone does not prove that it is needed; do not copy an unreviewed config into the isolated home. CLI login status does not verify actual model entitlement or network availability.

## Explicit synthetic Judge smoke (one real CLI model call, optional)

After the read-only `judge_prerequisites` check reports `prerequisites_present_unverified`, use this **opt-in** probe to distinguish an actually usable isolated Codex model Judge from mere file presence:

~~~powershell
$preview = Join-Path $env:LOCALAPPDATA 'AgentHub-Memory-Write-Preview'
git -C $preview pull --ff-only
node "$preview\scripts\smoke-codex-memory-judge.mjs" --run-model
~~~

This command **does send one small, synthetic, fixed test candidate to the Codex model**. It may use account quota. It reuses the exact `createCodexMemoryCandidateJudge` code path, copying only `auth.json` into its temporary isolated home, creating a disposable Git workspace, spawning the resolved executable without a shell, and applying the same strict candidate judgment schema parser. It does **not** open the canonical Memory SQLite or evaluate any actual pending project candidate. On completion it deletes the isolated workspace and copied credentials.

The only output is sanitized JSON: `judge_usable` with a schema-valid result, or `judge_failed` with a fixed `failure_code` (e.g. `authentication_rejected_possible`, `rate_limited_possible`, `model_unavailable_possible`, `codex_exec_nonzero_unclassified`). It never prints credentials, local paths, candidate text, Codex stderr, stdout or the model result. No separate user project authorization is granted. Running without `--run-model` performs no work and makes no model call. A successful smoke does not prove a live Codex Desktop hook actually fired, and it does not waive the G2/G3/G4/G5 production holds.

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

### Semantic index failure signatures without exposing local paths

The project diagnostics also report `counts.semantic_failure_signatures`, generated by SQL-only pattern classification of `memory_pipeline_failures` rows with `stage = 'semantic_sync'`. Raw `error_text`, Windows named-pipe paths, local folders, model text and secrets are **never selected or displayed**.

Possible codes include `embedding_worker_unavailable`, `embedding_worker_model_mismatch`, `embedding_worker_request_failed`, `embedding_worker_invalid_response`, `embedding_worker_readiness_failed`, `embedding_permission_denied`, `embedding_database_busy`, `embedding_unknown_project` and `unclassified`. These are observed error signatures, not assumptions about causes. `semantic_embedding_worker_unavailable` and `semantic_sync_failure_unclassified` can appear in the findings.

**Windows repair (in-process, offline only):** `scripts/reindex-memory-semantic.mjs` now first tries its existing E5 IPC worker; when and only when that worker reports `embedding worker unavailable` under Windows, it can instead load the pinned `intfloat/multilingual-e5-small` model *inside the same pipeline worker*, directly from the repo-local `.cache/memory-engine/e5` directory. It never launches a Windows pipe, loosens ACLs, downloads weights, enables arbitrary models or changes the candidate-promotion policy. Loading must use `allowRemoteModels:false`. It fails closed on a missing or symlinked cache root, an incomplete model, model identity mismatch, invalid 384-dimensional vector or any IPC failure other than unavailable. On non-Windows hosts, existing IPC behavior is unchanged. This is an optional index repair, not part of the already proven Claim persistence/read-only keyword recall.

New historical failure signatures: `offline_e5_cache_missing`, `offline_e5_initialization_failed`, `offline_e5_model_mismatch`, and `offline_e5_readiness_failed`. Old `embedding_worker_unavailable` entries remain intact and do not change retroactively.

To check which model cache the preview branch would use **without creating a model or changing memory**, run:

~~~powershell
$preview = Join-Path $env:LOCALAPPDATA 'AgentHub-Memory-Write-Preview'
$cache = Join-Path $preview '.cache\memory-engine\e5'
[pscustomobject]@{
  PreviewCacheDirectory = Test-Path -LiteralPath $cache -PathType Container
  LiveHubCacheDirectory = Test-Path -LiteralPath (Join-Path $HOME '.agents\.cache\memory-engine\e5') -PathType Container
  PreviewTransformersPackage = Test-Path -LiteralPath (Join-Path $preview 'memory-engine\node_modules\@huggingface\transformers\package.json') -PathType Leaf
}
~~~

`Test-Path` proves only presence, **not** complete model integrity. Do not copy credentials, automatically download a model, invoke reindex on the canonical DB, or run an unprotected Windows named-pipe server just to get a PASS. Reindex is an explicit canonical SQLite write; only do it after local-cache verification and approval. Existing historical partial runs remain partial.

The current reindex stage requires a local `intfloat/multilingual-e5-small` worker on the embedding IPC endpoint. Its Windows default is a local named pipe. Codex `UserPromptSubmit` currently does **not** launch its embedding worker under `win32`; therefore an unavailable worker is plausible but not proven by a generic `Error` stage count alone. Never auto-start an unreviewed Windows named-pipe worker or relax its access boundaries based only on these signatures.

A missing semantic vector does **not** invalidate a stored Claim or an already successful read-only FTS keyword recall. It means semantic/hybrid retrieval is not yet verified. The historical `partial` event is retained honestly; do not edit or remove previous pipeline records to manufacture a PASS.

Read-only probe for the actual local E5 IPC worker, from the Preview checkout:

~~~powershell
$preview = Join-Path $env:LOCALAPPDATA 'AgentHub-Memory-Write-Preview'
node --input-type=module -e '
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const path = join(root, "memory-engine", "embedding-worker-launcher.mjs");
const { checkEmbeddingWorker } = await import(pathToFileURL(path).href);
console.log(JSON.stringify({
  embedding_worker_healthy: await checkEmbeddingWorker({ timeoutMs: 1000 }),
  model_call_attempted: false,
  memory_db_modified: false,
}, null, 2));
' $preview
~~~

This sends only a local IPC `health` request. It does not create semantic vectors, launch a worker, consume a remote Codex quota or change SQLite. Also inspect `counts.semantic_failure_signatures` in `diagnose-codex-memory-pipeline.mjs`.

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


### Canonical-fact validation after restoring Windows Codex CLI

If an Importance judge reaches the model but still fails on `canonical_fact`, diagnostic signatures now distinguish `canonical_fact_not_nonempty_string` from `canonical_fact_over_500_chars`. The classification uses SQL substring tests inside read-only SQLite, without selecting the original error text. The first category means a null/empty/non-string *required fact value* was rejected; the exact original model output is not exposed by the diagnostic.

For `ignore`, `keep_candidate`, and `needs_confirmation` decisions, a returned `canonical_fact: ""` or whitespace-only string is safely normalized to `null` because these decisions cannot directly create durable Claims. For `promote`, a non-empty canonical fact of at most 500 characters remains mandatory. Non-string facts, meaningful but overlong facts, unexpected fields, non-empty `canonical_fact` on `ignore`, and all existing authority/risk checks continue to be rejected. **No automatic promotion or retroactive candidate rewriting occurs.** Prompt instructions explicitly request `null` rather than an empty string and cap non-null facts at 500 characters. The policy is not relaxed to truncate meaningful facts.

Confirm the dominant original subcase from the owner's private snapshot after pulling current main before attributing all six earlier errors to empty strings. If the counters indicate only overlong facts, their resolution needs a separate semantic-preserving judge improvement; do not truncate stored evidence or relax the 500-character limit.

### Bounded overlong canonical-fact re-evaluation

On 2026-11-13, the owner's Streamer Content counts-only diagnosis isolated **six** historical importance failures to `canonical_fact_over_500_chars` from **three** distinct candidates, each involved in two failed attempts. The earlier empty-string normalization cannot address this case.

The automatic importance evaluator now makes at most **one additional isolated Codex Judge call per candidate per pipeline attempt**, and only if parsing the first model judgment fails with the exact error `canonical_fact must be at most 500 characters`. The second call uses **the original user-direct candidate**, not the previously rejected long fact, plus explicit guidance to preserve scope, conditions, negations and exceptions. If an accurate <=500-character fact is impossible, the Judge must choose `needs_confirmation` with `canonical_fact=null`, not fabricate an abbreviated `promote`. Every second judgment passes the unchanged strict validator. If the second result still contains an overlong canonical fact, the evaluator routes the **original candidate** to `needs_confirmation`, records a technical review reason and no advisory fact, and does **not** create a Claim. This stops repeated automatic attempts without fabricating a shorter assertion. A different second validation error still leaves the candidate unmodified. For `keep_candidate` or `needs_confirmation`, an overlong advisory fact is set to `null`, retaining the complete original candidate and source evidence. A substantive overlong fact on `promote` or `ignore` remains invalid. No string slicing, direct Claim insertion or bypass of provenance/authority checks is permitted.

The retry remains bounded **per pipeline attempt**; a candidate that fails this exact length check twice is flagged `needs_confirmation` and is no longer eligible for automatic importance re-evaluation. Human review, not this fallback, determines whether the full original statement should ever become durable. Model calls can incur quota and cost; the existing short automatic retry guard remains in force for recent repeated failures. Historical failure rows persist for auditability, and an actual owner-side post-merge Codex Desktop run is required to establish whether the pending candidates now progress.

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

**Version-selection repair (2026-11-12):** On Windows the resolver now checks `codex.exe` and supported npm `codex.cmd` **in each PATH directory before searching the next directory**. The old global `.exe` pass could choose an older native CLI from a later PATH directory even when the interactive PowerShell CLI resolved an earlier, newer npm shim. Within a directory, `.exe` still wins; invalid shims are skipped. The existing explicit `AGENT_HUB_MEMORY_JUDGE_CODEX_BIN`/`CODEX_BIN` override continues to take precedence, including when pinned to an older CLI. No unsafe shell execution was added. The offline `--inspect-cli` reports the version actually chosen after this change, not the newest version installed elsewhere or the Codex Desktop app version.

To compare with the interactive shell, run `codex --version`, `Get-Command codex -All | Select-Object Name,CommandType,Source` and `where.exe codex` locally. Different versions indicate multiple installations, PATH order, an override or an app-bundled executable; this alone does not explain a nonzero Judge exit.

The same no-shell resolver is used by direct-user importance/relation judges and agent importance/relation judges. An explicitly configured AGENT_HUB_MEMORY_JUDGE_CODEX_BIN or CODEX_BIN must be an absolute existing native executable, JavaScript entrypoint or supported npm shim. Do not set this to a PowerShell shim, arbitrary batch file or untrusted path.

The automatic Stop/SubagentStop pipeline worker (only) now performs this CLI prerequisite check before it creates another pipeline run. It uses existing failure records to apply a **temporary**, read-only circuit breaker: rate-limit signals pause automated attempts for 10 minutes; two recent auth signals pause them for 10 minutes; five recent non-missing-CLI failures pause them for 3 minutes. Historical missing-CLI failures alone never suppress a newly working CLI. A deferred run does not change, reject, or promote any memory candidate and does not write another run/failure record. The backoff does not claim to fix authentication or rate limits, and the current `codex exec` failure may still require direct diagnosis.

To inspect Windows CLI availability without sending data or invoking a model:

~~~powershell
Get-Command codex -All | Select-Object Name, CommandType, Source
where.exe codex
~~~

Codex CLI installation and authentication are separate prerequisites from the desktop app/MCP. After installation changes, restart Codex Desktop so its background hook processes get the updated PATH. Do not copy auth.json into chat or log it. A missing auth.json, a rejected token, 429, and an unsupported model are different failure modes; the resolver fixes only executable discovery.
