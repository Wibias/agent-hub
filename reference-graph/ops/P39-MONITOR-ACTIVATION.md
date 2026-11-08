# P39 P38 monitoring activation packet

Status: **PREPARED / NOT ACTIVATED**. This packet does not change Supabase cron,
database objects, routing, or Graph activation.

## Two monitoring scopes

1. **Public 5-minute freshness monitor (prepared here).** It uses the existing
   publishable-key config and the three-column public freshness view. It checks
   exact row count, Content-Range total, current UTC date, refresh age, mixed
   refresh instants, and Data API latency. It does not claim source-hash or
   cron-history verification.
2. **Full privileged P38 monitor (BLOCKED).** The existing full evaluator needs
   `cron.job`, `cron.job_run_details`, P7 source count/hash and projection
   count/hash. No local read-only DB health credential/role exists. Creating
   one is a separate database-credential/RPC decision and is not part of this
   activation packet.

## Existing trusted execution environment

The local Windows Task Scheduler already hosts two AgentHub tasks:

- `AgentHub Reference Graph P10 Transport Watch`: five-minute trigger, RunAs
  `ws`, Interactive/Limited, hidden PowerShell; trigger currently expired and
  last run 2026-10-27.
- `AgentHub Reference Graph P19 Soak`: hourly, RunAs `ws`, Interactive/Limited;
  last run succeeded.

Do not modify either existing task. The prepared task is separate:
`AgentHub Reference Graph P38 Monitor`.

## Security and state

- Publishable key and URL come from the existing
  `%LOCALAPPDATA%\agent-hub\reference-graph\p19-soak-hourly-config.json`.
  The key is public, not a service credential.
- The runner explicitly removes `SUPABASE_SECRET_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY` from its child environment. It never reads them.
- Optional alert webhook URL is stored as a DPAPI CurrentUser secret at
  `%LOCALAPPDATA%\agent-hub\reference-graph\p39-alert-webhook.dpapi`; it is
  never placed in task arguments or logs.
- Alert events contain only severity, codes, observed/checked timestamps and
  the alert key. No candidates, headers, URLs or credentials are logged.
- State is written atomically with a backup. A stale lock older than ten
  minutes is recovered; an active lock makes the run fail closed.
- Alert delivery failure does not advance state, so the next five-minute run
  retries the same page/resolve event.

## Files

- `reference-graph/ops/p39-p38-monitor-runner.ps1`
- `reference-graph/ops/set-p39-alert-webhook.ps1`
- `reference-graph/ops/register-p39-p38-monitor.ps1`
- `reference-graph/p39-p38-public-health.mjs`
- `reference-graph/p39-p38-runtime.mjs`
- `reference-graph/cli/p39-p38-public-monitor.mjs`

## Activation steps (separate approval required)

1. Confirm the tested commit/branch and clean worktree. Update the expected
   branch/head in the registration invocation to the exact approved commit.
2. Store the optional webhook URL through DPAPI:

```powershell
$RepoRoot = (Resolve-Path '.').Path
& (Join-Path $RepoRoot 'reference-graph\ops\set-p39-alert-webhook.ps1')
```

3. Dry-run the public monitor in a trusted local shell. This makes no state or
   alert writes:

```powershell
$cfg = Get-Content "$env:LOCALAPPDATA\agent-hub\reference-graph\p19-soak-hourly-config.json" -Raw | ConvertFrom-Json
$env:SUPABASE_URL = [string]$cfg.supabase_url
$env:SUPABASE_PUBLISHABLE_KEY = [string]$cfg.supabase_publishable_key
try {
    node "reference-graph\cli\p39-p38-public-monitor.mjs" `
      --state "$env:LOCALAPPDATA\agent-hub\reference-graph\p39-p38-monitor-state.json" `
      --log "$env:LOCALAPPDATA\agent-hub\reference-graph\p39-p38-monitor-alerts.jsonl" `
      --dry-run
} finally {
    Remove-Item Env:SUPABASE_URL, Env:SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
}
```

4. Register the new task only after the separate approval. This creates exactly
   one local five-minute task and does not change Supabase cron:

```powershell
$RepoRoot = (Resolve-Path '.').Path
& (Join-Path $RepoRoot 'reference-graph\ops\register-p39-p38-monitor.ps1') `
  -Apply `
  -ExpectedBranch "codex/p39-profile-access-monitoring-20261108" `
  -ExpectedHead "0fb1e28267f5ae7e4e99bcd7d864e2e8d93d8f04"
```

5. Verify the task, next run, state, and redacted logs:

```powershell
Get-ScheduledTask -TaskName 'AgentHub Reference Graph P38 Monitor' | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName 'AgentHub Reference Graph P38 Monitor'
Get-Content "$env:LOCALAPPDATA\agent-hub\reference-graph\p39-p38-monitor-runs.jsonl" -Tail 5
Get-Content "$env:LOCALAPPDATA\agent-hub\reference-graph\p39-p38-monitor-alerts.jsonl" -Tail 5
```

6. Rollback is local only:

```powershell
Unregister-ScheduledTask -TaskName 'AgentHub Reference Graph P38 Monitor' -Confirm:$false
```

Keep logs/state for audit. No database, cron or routing rollback is involved.

## Current blockers

- Full cron/source-hash monitor: **BLOCKED** on a read-only DB health
  credential/role or an approved aggregate health RPC.
- 24h P38 soak: **IN PROGRESS**; two successful two-hour cycles observed at the
  last read (four successful invocations, zero failures), not the full 12
  cycles.
- Independent P31 original refresh receipt, externally confirmed P33/P37 report
  pins and P34 baseline provenance: **BLOCKED** as documented in `P39.md`.
- P35 human approval: **OPEN**; this packet claims no approval or exception.
