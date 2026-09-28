# Runtime evidence contract

Runtime verification evidence is an observable receipt, not an agent confidence statement. The receipt is bound to one repository head and one driven feature.

## Receipt

Use JSON with this shape:

```json
{
  "schema_version": 1,
  "run_id": "verify-settings-20260901T120000Z",
  "repository": "owner/repo",
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "surface": "cli",
  "feature": "settings",
  "result": "pass",
  "checks": [
    { "id": "settings-roundtrip", "result": "pass" }
  ],
  "artifacts": [],
  "side_effects": [],
  "started_resources": [],
  "cleanup": "pass",
  "blocked_reason": null
}
```

Allowed surfaces are `cli`, `tui`, `web`, `desktop`, `api`, `mobile`, and `library`.

`result` and `cleanup` use `pass`, `fail`, or `blocked`.

## Pass semantics

`pass` means all of these are true:

- the full 40-character `head_sha` identifies the code that was driven;
- the real user-facing path was exercised;
- at least one falsifiable check passed;
- every check in the receipt passed;
- material side effects were checked when the feature has side effects;
- cleanup passed;
- the verifier did not rely on a stale or foreign runtime instance.

Compilation, unit tests, a final screenshot without the triggering action, or an agent statement that behavior "looks correct" are not runtime verification by themselves.

## Fail and blocked

Use `fail` when the verification ran and observed incorrect behavior.

Use `blocked` when required coverage could not run. `blocked_reason` must name the concrete prerequisite or failure, for example missing credentials, unsupported OS integration, unavailable external dependency, or a verifier defect that could not be repaired safely.

`blocked` is incomplete coverage. Never relabel it as pass.

## Head freshness

A receipt is valid only for the exact `head_sha` it names. If the candidate head changes, treat the old receipt as stale and run the affected verification again. Do not infer that a later commit is safe because the previous head passed.

A consumer such as GitHub Delivery may retain the old receipt as history, but it must not use it as current positive evidence.

## Checks

Checks should describe outcomes, not preferred tool sequences. Examples:

- `login-session-created`
- `settings-persist-after-restart`
- `cli-exits-zero-and-writes-config`
- `api-response-and-row-state-match`

Assert a process step only when that step is itself part of the contract, such as a required authorization boundary or cleanup action.

## Artifacts and side effects

`artifacts` may point to screenshots, transcripts, traces, logs, response captures, or other proof. Keep secrets and sensitive payloads out of evidence.

`side_effects` records observed external or persistent effects that matter to the claim. Verify safe dry-run claims by observing what did or did not change rather than trusting a mode name.

`started_resources` records the processes, ports, profiles, temporary roots, or other resources owned by the run so cleanup can target identities instead of broad names.

## Validation

Run the hub validator from the installed `.agents` root. Resolve `<agent-home>` to the current host's agent home, for example `%USERPROFILE%\.agents` on Windows or `$HOME/.agents` on POSIX:

```text
node "<agent-home>/skills/verification-harness/scripts/validate-verification-skill.mjs" "<project>/.agents/skills/verify-<app>" --receipt "<receipt.json>"
```

The deterministic validator checks shape and basic invariants. It does not replace the live proof described by the project verifier.
