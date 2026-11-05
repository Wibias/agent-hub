# D11: Read-only production monitoring and stale-evidence lifecycle policy

D10 confirmed one verified repository-backed Claim in `agent-hub/main` with
D8 `ready_for_d7_live`, D7 `pass`, and p95 642.37 ms for five samples.
D11 monitors this same contract. It does not change Memory Engine, D9 capture,
Recall, the HTTP API, or UI; no new automatic repository scanning is enabled.

## Operator command (Node 24)

Use an explicit existing SQLite file and the same operator-approved checkout.

```powershell
$Repo = "$HOME\agent-hub-D9-pilot"
$Db = if ($env:AGENT_HUB_MEMORY_DB) { $env:AGENT_HUB_MEMORY_DB } else { Join-Path $env:LOCALAPPDATA 'agent-hub\memory.sqlite3' }
node "$Repo\scripts\monitor-memory-graph-d11.mjs" --db-path $Db --repo-root $Repo --project-id 'github.com/Wibias/agent-hub' --branch main --samples 5 --max-p95-ms 2000
```

D11 is a **one-shot** monitor suitable for later scheduling by a separate
operator-approved scheduler. It opens SQLite through D8 and D7 in read-only
mode, and writes no files. The output is a sanitized, bounded receipt. To
compare runs, save the JSON receipt outside the DB directory and pass it via
`--previous-report PATH`. D11 will read but never modify that file. It rejects
reports from another scope. Scheduled monitoring, notifications, file rotation,
and alert delivery are not enabled by this PR.

- `pass`: D8 coverage ready, D7 live verification pass, all visible repository
  nodes fresh, Git context verified and stable, graph not truncated and p95
  within the configured SLA.
- `blocked`: no repository Claim, unchecked/stale evidence, unstable Git,
  incomplete scope coverage, graph truncation, or diagnostic attention. Do not
  hide these conditions by adding fabricated evidence.
- `fail`: untrusted/invalid diagnostic shape or read-only query failure.
- `transition`: `first_observation`, `unchanged`, `regressed`, `recovered` or
  `changed_nonpass`. Changes are only as trustworthy as the user-supplied
  previous report. Do not treat a reported regression as proof of a specific
  cause; cross-check Git and canonical Evidence separately.

Exit codes: 0 `pass`, 2 `blocked`, 1 `fail`. Generic error codes and no raw
SQLite, Git, Claim, Evidence, or absolute path errors are logged.

## Stale Evidence policy

1. Verify the correct project, branch, trusted checkout, and Git permissions.
2. Inspect the relevant canonical primary Evidence privately. D11 never
   guesses whether a source changed, was deleted, became a symlink, or failed
   to verify, because all may appear as stale.
3. Preserve the old Evidence and Claim for history and audit. **Never delete
   or automatically supersede them from D11.**
4. If the old fact is no longer current, use the normal authorized lifecycle
   workflow to review or supersede it, with provenance and review approval.
5. For a selected current committed regular file, D9 capture may create a new
   revision-specific Claim **only after a separate, explicit `--write` and
   backup**. New capture alone does not make old active stale Claims disappear.
6. Rerun D8, D7 and D11 read-only, and require all checks to pass. Do not
   assume a valid original D10 baseline applies after a new commit.

## Scope and limitations

D11 watches one selected project and branch. It is not proof of complete
repository ingestion, long-term uptime, or general UI design quality. It
never authorizes changes to source control or the production database.
End-to-end tests use only disposable Git and SQLite, including clean-to-stale
transitions. The monitor’s read-only contract is regression tested.
