# AgentHub Memory: local-first product cutline (2026-11-17)

## Decision: stop stacking security labs before a real Codex memory experience

Our immediate product goal is useful, visible project memory in **original
Codex CLI/Desktop on a personal Windows x64 PC**. The existing global
`agenthub-memory-read` server and `memory_recall` tool already support
this with no new Windows service, VM, extra Windows account, custom
transaction engine, service-SID pipe, registry checkpoint, or new token.

This decision draws a precise distinction:

| Surface | Product behavior today | What we may claim |
| --- | --- | --- |
| Existing local canonical SQLite `memory_recall` | Normal scoped read of existing eligible memories; source Evidence and current Git branch remain visible | Working **local, read-only** project memory, **not** a protected human-approved authority |
| Existing UserPromptSubmit user-direct capture | Capture a user's explicit whole-message instruction under the current hooks | User-supplied local-memory event, still in **user-writable** SQLite |
| Existing Memory Console `E~` review queue | Inspect proposals awaiting review | Pending evidence, **not** an approved Claim |
| Protected Windows LocalService / WebAuthn / one-shot CI bridge | Synthetic one-off consent, protected Claim, replay and rollback tests | **CI lab only**, not installed Codex private Recall |
| Original Codex process identity | Correct observed PID/SID and an operator-owned handle, but attacker-origin relay test succeeds | **Not** independently authenticated or isolated from a hostile same-account process |

### Explicit MVP trust choice

For **ordinary local memory on an operator-controlled PC**, accept the
pragmatic trust model that the user's existing Windows session and local
Codex runtime are trusted. This permits the present read-only canonical
SQLite path, including its candid provenance and output limits, without
pretending that agent-readable SQLite is a write authority.

If the threat is a malicious full-trust process running as the **same user**,
this ordinary convenience path is *not protected*. Process PID, binary
signature, checksum, nonce, Windows Hello or adding another same-SID helper
will not fix that. Do not grant a broader protected Claim by merely
renaming the read-only path.

### Next concrete deliverables (in order, no security research loop)

1. **Local visibility now:** use `doctor-codex-memory-read.mjs` from an
   already approved Git project, verify real stdio `memory_recall` status
   and count without printing Claims or writing DB/config. Then verify
   `codex mcp list` and an actual tool call in original CLI and Desktop.
   Record the observed outputs, not model assertions.
2. **One genuine user action:** prove an existing human-direct memory captured
   by the live hooks appears in `memory_recall` with real project, branch,
   Claim/Evidence ID. Keep unrelated agent-proposed `E~` pending. This
   exercises user utility without introducing a second approval engine.
3. **One protected E~ vertical slice (later, when local workflow is useful):**
   a real user chooses and confirms a selected proposal; the *existing*
   protected service, native window and one-use WebAuthn engine own the
   authoritative decision. Then prove one approved Claim round-trip into
   actual Codex. Focus on one path and one controlled backup, not new
   additional anti-rollback/attestation frameworks.

### Stop / go criteria

- We do **not** add more PID-based recipient attestation, duplicate
  service-SID roles, mirrored SQLite ledgers, synthetic-only pipelines or
  secondary crypto frameworks merely to make the lab look safer.
- We do **not** silently enable any service, broker, hook migration,
  `--ci-one-shot-read`, real-project protected private read or Memory Write.
- Local ordinary read-only can be usable with clear provenance and
  read-only status; no claim that it is cryptographically trusted.
- Protected human-approved real-project Claim release remains **NO-GO**
  until a genuine physical Windows Hello/local acceptance, verified exact
  service-owned authority and deliberately chosen endpoint threat model
  exist. A documented personal-device risk acceptance can simplify the
  endpoint threat model, but it is not a technical defense against
  compromised full-trust Codex.

**No PC mutations from this PR. No additional Windows account or VM.
Issue #338 remains OPEN for the protected write/read authority.**
