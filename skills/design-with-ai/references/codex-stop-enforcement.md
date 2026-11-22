# Codex Stop enforcement for design-with-ai

Codex supports a synchronous `Stop` lifecycle event. A command hook may
reply `{"decision":"block","reason":"..."}` to ask Codex for an automatic
continuation. It cannot edit an already sent user response, cannot enforce
future behavior if disabled/not trusted, and cannot override another Stop hook
that returns `continue:false`.

This is an optional **host-level enforcement companion** for
`design-with-ai`, not a universal default that runs merely because the
skill is installed. Do not register it automatically as part of a repo clone.

## Install once (Windows PowerShell)

First update the actual local skill installation to include these scripts.
Then inspect the proposed change before applying it:

```powershell
$skill = Join-Path $HOME ".agents/skills/design-with-ai"
node (Join-Path $skill "scripts/install-codex-stop-gate.mjs")
node (Join-Path $skill "scripts/install-codex-stop-gate.mjs") --apply
```

If the older standalone Impeccable Stop hook is still registered, and
**you explicitly want to remove that older lifecycle integration** because
`design-with-ai` now owns the design workflow, update the local skill first
and run this opt-in, backup-safe migration:

```powershell
$skill = Join-Path $HOME ".agents/skills/design-with-ai"
node (Join-Path $skill "scripts/install-codex-stop-gate.mjs") --remove-impeccable-hooks
node (Join-Path $skill "scripts/install-codex-stop-gate.mjs") --apply --remove-impeccable-hooks
```

The migration removes only hooks executing legacy
`impeccable/scripts/*hook*.mjs|js|cjs`, across Codex events. It retains
GitHub-delivery, memory, other hooks, DWA's own hooks, and all embedded
Impeccable design knowledge. It creates a timestamped backup of
`~/.codex/hooks.json` before changing anything and is idempotent. It
does **not** delete the Impeccable skill directory or edit other active
Codex configuration layers.

The installer adds three cooperating command handlers to `~/.codex/hooks.json`:
`UserPromptSubmit`, `PostToolUse` (regex matcher for `Bash`, `exec_command`, and `functions.exec`), and `Stop`. It preserves
existing handlers and makes a timestamped backup before changes. It is dry-run by default and idempotent. It does not
edit `config.toml`, disable other hooks or bypass Codex trust decisions.
If you already manage the same Stop event in another active configuration
layer, inspect `/hooks` to avoid redundant registrations.

Restart Codex if it does not discover the changed hook. Run `/hooks` and
review/trust **all three commands**, not only the existing Stop hook. Codex
will not execute newly added unmanaged hooks until you explicitly approve them. Never use the broad
`--dangerously-bypass-hook-trust` option just to enable this integration.

## Behavior

The installed hooks use Codex's documented `turn_id` fields. On
`UserPromptSubmit`, only the modifying/explicit-skill flags are stored. On
`PostToolUse`, recognized skill-file reads and gate-command proof paths are
recorded for commands exposed directly by `Bash`, `exec_command`, or
`functions.exec`. An opaque `functions.exec` JavaScript wrapper does not
prove which nested process ran: **never** parse its arbitrary `code` as a
shell command. When `functions.exec` returns a **structured** `proofPath`,
the PostToolUse hook records only that path, not the wrapper or its output.
At Stop, the verifier reconstructs gate inputs from the actual native proof
and independently checks its canonical project ledger, `.csproj` source
root, hashes, prompt/creation time, current source and validator. A bounded
fallback also looks for current proof files directly under the current or
ancestor native project's canonical `.design-with-ai` directory when the
host provides no PostToolUse gate event at all. If Codex starts in the
**immediate parent** of a native project, the fallback inspects at most one
bounded level of direct child directories. It accepts this route only when
exactly one child native project has a current, structurally valid proof
for the active turn. Never recursively crawl unrelated projects, follow
directory junctions, accept a prior turn's proof or silently choose
between multiple current child project proofs.

Codex can omit `PostToolUse` events for nested Code Mode / `functions.exec`
execution, even when the hook is installed and trusted. This external
host coverage gap is not repaired by adding tool-name regex variants.
The independent artifact check is the fallback, not a guarantee that
the host always gives sufficient current-turn context.

The native gate now writes its **own local proof-location hint** when it
produces the real proof (not on `--check-proof`). This does not require a
`PostToolUse` event, does not parse `functions.exec` JavaScript, and works
when Codex starts multiple directory levels above the native project.
Stop looks only in a bounded, flat per-user index at
`~/.codex/design-with-ai/gate-index/`; each project has one record with
absolute proof/source paths and gate timestamp. These are local metadata,
not credentials or prompt text. Hints older than 48 hours are ignored and
old records are pruned on the next write; the index has a hard item cap.
Stop must still establish the active user turn, an unambiguous native source
root under the current working tree, the canonical findings ledger and a
real current immutable proof, then independently run `checkProof()`.
An index entry **alone** can never certify a UI or a successful gate.
When two distinct current native projects qualify, no arbitrary choice is
made. If filesystem access or turn identity is absent, Stop fails
conservatively with a truthful incomplete result rather than inventing
execution evidence.

This is **not** permission to accept a guessed path, arbitrary stdout,
an older turn's proof or an unrelated workspace. Non-native workflows still
prefer explicit command events. If neither typed proof nor a current
canonical native artifact is available, `NO_GATE_COMMAND` remains a truthful
observability limitation, not evidence that the gate never ran.
On `Stop`, the hook verifies the current turn's gate proof.

This **does not depend on `transcript_path`**: Codex documents that field as
nullable and warns that transcript JSONL is not a stable hook interface.
The old transcript reader remains a fallback for older or partially installed
configurations.

1. Load the per-turn state keyed by hashed session/turn/project identity.
   Ignore any stale earlier-turn gate commands. When that state is missing,
   try the legacy transcript-based method if available.
2. Scope only to modifying UI prompts that explicitly mention
   `design-with-ai` or have tool arguments indicating a read of
   `design-with-ai/SKILL.md`. Read-only audits, backend work, unrelated
   work and uncertain activation are not blocked. Missing transcripts alone
   no longer disable checks when the native turn hooks recorded scope.
3. Check gate commands in the current turn for an explicit
   `run-iteration-gate.mjs --receipt ... [--baseline ...] --proof ...`
   invocation and inspect the proof with the already-shipped
   `run-iteration-gate.mjs` `checkProof()` validator.
4. Bind a Git project's tracked and untracked source files (including
   HTML/CSS/TS and small UI assets) to a content-derived SHA-256 snapshot at
   gate execution. For Gitless native work, use `--source-root` to bind an
   explicit source directory without repairing an invalid ancestor `.git`.
   Stop compares the current source snapshot, receipt,
   baseline, ledger, optional final native render screenshots and validators
   to the recorded proof. A code change
   **after** a green gate, such as a late font fix in `ui/index.html`,
   invalidates the earlier evidence even if all other gates passed.
   Re-run the full iteration gate with a **new** proof output path after
   the final code/evidence change.
5. Permit `COMPLETE` only for a current, input-bound, valid COMPLETE proof.
   For an IMPROVE receipt with an otherwise valid `PARTIAL` / `NOT_VERIFIED`
   proof, use `repair-loop-controller.mjs` on the current receipt and frozen
   baseline: if it selects `REPAIR_SOURCE`, `VERIFY_CURRENT`, `RERENDER`,
   or `RUN_GATES`, request one *targeted* continuation rather than treating
   PARTIAL as done. A missing final render/manifest is actionable even if
   all known UI findings have been marked resolved.
   An evidence-backed blocked or stalled task may end with explicit PARTIAL.
   This cannot guarantee a full autonomous loop: `stop_hook_active` still
   caps the hook to one request; the agent must perform the bounded loop
   proactively within its own original task.
6. Otherwise request one Codex automatic continuation asking it to run
   the real validator and produce/verify proof. If `stop_hook_active` is
   already true, allow termination to avoid a loop. This is a bounded
   self-correction opportunity, **not** silent success.

Example ordinary prompt:

> Improve the existing UI using design-with-ai. Preserve the current identity.

The operator should not need to specify a gate command each time.

## Local Stop runtime diagnostics

Once this hook is installed and trusted, **the hook process itself** writes
a small, local JSONL entry for each Stop check to:

```text
~/.codex/design-with-ai/stop-events.jsonl
```

On Windows PowerShell, inspect the latest entries after a normal design task:

```powershell
$log = Join-Path $HOME ".codex/design-with-ai/stop-events.jsonl"
Get-Content $log -Tail 15 | ForEach-Object { $_ | ConvertFrom-Json } |
    Format-Table at, decision, cause, proof, nativeIndex, retry, transcript -AutoSize
```

Each record contains only timestamp, decision, an allowlisted cause, retry
flag, transcript scan state, presence of a user-turn boundary and skill file
reference, number of candidate gate commands, a coarse proof outcome, and an
allowlisted `nativeIndex` rejection category.
**No prompts, tool commands, tool outputs, paths, session IDs, tokens, or
full receipt contents** are written. The event timestamp helps correlate
with the local Codex session, but does not authenticate that an event was
triggered by Codex rather than a manual simulation.

When `proof=NO_GATE_COMMAND` but the native gate has already written its
private index, use `nativeIndex` to distinguish the actual rejection point,
without creating another proof or guessing from the missing tool event:

- `INDEX_CWD_DISJOINT`: the Codex Stop event's cwd and indexed native
  source root are separate trees. This is a deliberate workspace security
  constraint; do not accept unrelated projects merely because both are
  inside the same user profile.
- `INDEX_OUTSIDE_TURN_TIME`: the indexed gate ran before the current
  recorded user-turn boundary or outside the allowed freshness window.
- `INDEX_PROOF_METADATA_INVALID`, `INDEX_PROOF_NATIVE_ROOT_INVALID`,
  `INDEX_PROOF_ARTIFACT_PATH_INVALID`, `INDEX_PROOF_FILES_UNSAFE`:
  the candidate was read but rejected by a specific proof/root/filesystem
  guard before `checkProof()`.
- `INDEX_UNAVAILABLE`, `INDEX_EMPTY`, `INDEX_RECORD_INVALID`: the
  index directory or its entry could not be used.
- `INDEX_PROOF_ACCEPTED`: a native artifact candidate passed preliminary
  path, root and turn guards. A later `checkProof()` failure still cannot
  be called a verified gate.
- `INDEX_AMBIGUOUS_PROJECTS`: more than one distinct current native
  project matches. Do not choose a random project.

This field never includes paths, prompt content, session IDs, process IDs,
hashes or tool output. It is evidence about *why the Stop hook rejected*
a proof hint, not evidence that the UI passed visual verification.

Key outcomes:

- `BLOCK` / `MISSING_VERIFIED_GATE_PROOF`: current modifying design turn
  lacks a verified gate proof; Codex should request one continuation.
- `BLOCK` / `ACTIONABLE_PARTIAL_CONTINUATION`: current IMPROVE turn has a
  valid incomplete proof but an existing finding still needs a real repair,
  current verification or matched rerender. The one Codex continuation must
  attempt this action rather than asking the user to restart the task.
- `ALLOW` / `VERIFIED_COMPLETE` or `VERIFIED_INCOMPLETE`: gate proof was
  valid and matched the declared verdict.
- `ALLOW` / `RETRY_LIMIT_NOT_VERIFIED`: the one permitted correction was
  used, but no passing proof was found.
- `ALLOW` / `NO_TURN_BOUNDARY`, `READ_ONLY_OR_OUT_OF_SCOPE`, or
  `SKILL_NOT_OBSERVED`: the hook ran but did not classify this as a
  modifying design-with-ai turn.
- `TRANSCRIPT_UNAVAILABLE` or `TRANSCRIPT_SCAN_ERROR`: inspection
  could not establish the current turn; the hook fails open.
- `proof=RECEIPT_CHANGED`, `BASELINE_CHANGED`, `LEDGER_CHANGED`,
  `WORKTREE_CHANGED`, `VALIDATOR_CHANGED`, or `PROOF_TOO_OLD`:
  precise source of stale gate evidence. `WORKTREE_UNBOUND` means an older
  proof never captured a project source snapshot. Each triggers a final
  gate rerun; the diagnostic journal records only the error code, not paths
  or source content.
- `proof=PROOF_MISSING`, `PROOF_INVALID`, `WORKTREE_UNAVAILABLE`,
  `RENDER_ARTIFACT_CHANGED`, `RENDER_SOURCE_STALE`, or `RENDER_EVIDENCE_CHANGED`,
  `VALIDATOR_NONZERO`, `INCOMPLETE_NOT_DISCLOSED`, or `PATH_REJECTED`:
  additional reasons a candidate cannot certify completion.

Per-turn checkpoint files are stored separately under
`~/.codex/design-with-ai/turns/`. Filenames are hashes, and prompts,
credentials and tool output are not stored. Candidate receipt/baseline/proof
paths can appear in these private ephemeral checkpoint files because Stop
must validate their contents. Entries expire after 48 hours. These private
checkpoints are **not** part of the privacy-minimal diagnostic journal.

The diagnostic log includes `transcript=NATIVE_TURN_EVENTS` when the Stop
hook used the more reliable official turn hooks.

Journal size is bounded to 256 KiB plus one 256 KiB predecessor
(`stop-events.previous.jsonl`). Logging failures never change Stop
decisions. To disable local journaling, start Codex with
`DESIGN_WITH_AI_STOP_DIAGNOSTICS=0` in its environment. Removing the
journal files deletes their local history.

A missing journal is **not conclusive**: the hook may be untrusted, disabled,
not invoked, unable to write, or running an outdated installed copy.
Check `/hooks` and the installed script version before drawing a conclusion.

## Verification

Run the deterministic Node regression tests:

```shell
node --test skills/design-with-ai/tests/codex-stop-gate.test.mjs
node --test skills/design-with-ai/tests/install-codex-stop-gate.test.mjs
node --test skills/design-with-ai/tests/stop-diagnostic-journal.test.mjs
node --test skills/design-with-ai/tests/project-source-snapshot.test.mjs
```

In Codex, `/hooks` shows whether the hook is loaded and trusted. A
single-shot task with missing proof should be continued once by Codex; a
read-only audit should not. Check the actual host transcript and the
generated `--proof` output after the run; do not infer activation merely
from a green test in the Hub repository.

## Limitations and failure boundaries

- **Host dependency:** If the user has not installed/trusted this hook,
  nothing is enforced. A shared skill cannot unconditionally install hooks
  in a different workstation.
- **Turn-state dependency:** `UserPromptSubmit` and `PostToolUse` must also
  be trusted and enabled. If neither native checkpoint nor usable transcript
  is available, Stop fails open to avoid blocking unrelated tasks. A missing
  transcript alone is not sufficient to bypass the gate.
- **Limited correction:** Codex marks an automatic Stop continuation with
  `stop_hook_active`. It is honored as a one-retry limit. The agent can
  still end with unresolved findings and a truthful incomplete verdict.
  Continuous repair is the skill-level within-turn loop, not repeated Stop
  blocks. A host without the trusted hook cannot enforce this final guard.
- **Proof scope:** The proof validates receipt structure, current input
  hashes, a bounded Git-workspace source-content fingerprint, and observed
  validator subprocess result. It includes tracked/untracked source code and
  small UI assets, but intentionally excludes ignored files, generated
  screenshot/report directories, untracked ignored files and large video
  assets. An overlarge source file triggers explicit inability to certify
  rather than a guessed pass. It does not authenticate
  screenshots, prove the baseline was recorded before edits, prove real
  TikTok uploads, or prevent a malicious actor from forging local JSON.
- **Hook precedence:** Multiple matching hooks execute. Another Stop hook
  returning `continue:false` takes priority over this hook's block.
- **False positives/negatives:** Prompt and tool-use classification is
  conservative. General UI work where the skill is never loaded may not
  be recognized. Conversely, a prompt mentioning the skill can cause one
  correction even if the project lacks suitable rendering tools.
- **Not release enforcement:** For fully automated delivery, a project CI
  check must independently require fresh gate evidence and real UI tests.
  Do not present this local interactive Stop hook as an organization-wide
  security or release policy.

Official Codex reference: https://developers.openai.com/codex/hooks

Do not combine this hook with an unbounded repeated custom Stop blocker.
