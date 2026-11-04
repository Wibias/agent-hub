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

The installer adds three cooperating command handlers to `~/.codex/hooks.json`:
`UserPromptSubmit`, `PostToolUse` (Bash matcher), and `Stop`. It preserves
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
recorded. On `Stop`, the hook verifies the current turn's gate proof.

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
4. Permit `COMPLETE` only for a current, input-bound, valid COMPLETE proof.
   Permit `PARTIAL` / `NOT_VERIFIED` only with a valid matching proof
   and the corresponding **explicit verdict** in the final message.
5. Otherwise request one Codex automatic continuation asking it to run
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
    Format-Table at, decision, cause, proof, retry, transcript -AutoSize
```

Each record contains only timestamp, decision, an allowlisted cause, retry
flag, transcript scan state, presence of a user-turn boundary and skill file
reference, number of candidate gate commands, and a coarse proof outcome.
**No prompts, tool commands, tool outputs, paths, session IDs, tokens, or
full receipt contents** are written. The event timestamp helps correlate
with the local Codex session, but does not authenticate that an event was
triggered by Codex rather than a manual simulation.

Key outcomes:

- `BLOCK` / `MISSING_VERIFIED_GATE_PROOF`: current modifying design turn
  lacks a verified gate proof; Codex should request one continuation.
- `ALLOW` / `VERIFIED_COMPLETE` or `VERIFIED_INCOMPLETE`: gate proof was
  valid and matched the declared verdict.
- `ALLOW` / `RETRY_LIMIT_NOT_VERIFIED`: the one permitted correction was
  used, but no passing proof was found.
- `ALLOW` / `NO_TURN_BOUNDARY`, `READ_ONLY_OR_OUT_OF_SCOPE`, or
  `SKILL_NOT_OBSERVED`: the hook ran but did not classify this as a
  modifying design-with-ai turn.
- `TRANSCRIPT_UNAVAILABLE` or `TRANSCRIPT_SCAN_ERROR`: inspection
  could not establish the current turn; the hook fails open.
- `proof=PROOF_MISSING`, `PROOF_INVALID_OR_STALE`,
  `VALIDATOR_NONZERO`, or `PATH_REJECTED`: why a candidate proof failed.

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
- **Proof scope:** The proof validates receipt structure, current input
  hashes and observed validator subprocess result. It does not authenticate
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
