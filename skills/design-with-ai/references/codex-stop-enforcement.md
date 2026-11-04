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

The installer adds **one** synchronous `Stop` command handler to
`~/.codex/hooks.json`, preserving existing handlers and making a timestamped
backup before changes. It is dry-run by default and idempotent. It does not
edit `config.toml`, disable other hooks or bypass Codex trust decisions.
If you already manage the same Stop event in another active configuration
layer, inspect `/hooks` to avoid redundant registrations.

Restart Codex if it does not discover the changed hook. Run `/hooks` and
review/trust the exact command. Codex will not execute newly added unmanaged
hooks until you explicitly approve them. Never use the broad
`--dangerously-bypass-hook-trust` option just to enable this integration.

## Behavior

The installed hook reads the current `Stop` input from standard input and
the Codex transcript JSONL file from `transcript_path`.

1. Identify the latest **user-turn boundary**. Ignore stale earlier tool
   calls and proofs from prior turns.
2. Scope only to modifying UI prompts that explicitly mention
   `design-with-ai` or have tool arguments indicating a read of
   `design-with-ai/SKILL.md`. Read-only audits, backend work, unrelated
   work, missing transcripts or uncertain activation are not blocked.
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

## Verification

Run the deterministic Node regression tests:

```shell
node --test skills/design-with-ai/tests/codex-stop-gate.test.mjs
node --test skills/design-with-ai/tests/install-codex-stop-gate.test.mjs
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
- **Transcript dependency:** A transcript missing the current user-turn
  boundary or inaccessible to the hook fails open. This avoids blocking
  unrelated tasks but leaves coverage unknown.
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
