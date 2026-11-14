# AgentHub Memory: minimal integration plan (2026-11-14)

**Goal:** Original Codex CLI/Desktop remembers useful project facts, shows uncertain
proposals for human review, and cannot silently turn an agent proposal into a
human-approved Claim.

**Operating constraints:** Windows x64, existing user account, no VM, no new
Windows account. No production service/hook/DB changes from merging code.
Work against synthetic or explicitly disposable test data until a user-driven
local acceptance run is documented.

## What already works

| Component | Existing implementation | Current boundary |
|---|---|---|
| Read | Global project-scoped `memory_recall` stdio MCP | Reads user-writable canonical SQLite; scope is not signed session identity |
| Capture | Existing Codex hooks and candidate/evidence pipeline | Agent proposals are not human approval |
| Review | Memory Console `/api/scope` includes the evidence-bound `E~` queue | Review is read-only; an intent is explicitly unapproved |
| Same-user write *preview* | Interactive `prepare-codex-approved-memory-write` and one-use MCP | Can commit **a separate user-direct fact**; same-user agent can bypass its consent convention |
| Protected lab | #335-#340 Windows challenge core, LocalService SID, protected pending SQLite | No IPC, enrolled credential, authorized Claim transaction or real-world install |

The same-user write preview is **not** the finalizer for `E~` proposals.
An integration test must prove these remain distinct. Never count a preview
write as a successful protected human approval.

## Four delivery gates (one working vertical slice, not research PRs)

### M1: Lock an honest baseline (this PR)
- Run one synthetic vertical test on Windows and Linux: project-scoped read
  sees no pending proposal; Console shows that proposal; unsupported
  confirmation route is rejected; a **separate** operator preview saves one
  direct fact and recall finds it; the pending proposal stays unapproved.
- Reuse existing workflows and modules. No new Windows service, storage
  format, frontend or cryptographic framework.
- The existing Windows-native service/token tests continue to protect the
  service-owned store.

### M2: Single trusted review/commit path (next implementation)
- Use the **existing** protected LocalService ledger and Windows WebAuthn
  challenge core. Implement the minimum bridge necessary to send a selected
  `E~` proposal and its decision to the protected owner.
- The service must independently resolve the exact project/branch/revision,
  proposal, fact, source evidence, relation target and current snapshot from
  a trusted source. A caller-supplied `user_direct` flag or mutable
  `%LOCALAPPDATA%\agent-hub\memory.sqlite3` row is not authorization.
- A real human confirmation must be bound to the exact displayed fact and
  confirm/reject action and consumed once. Prefer the existing Windows
  credential/challenge pieces; **do not** create a second parallel
  authorization mechanism.
- Atomically record the final decision and protected Claim authority or
  fail closed. No silent promotion, no arbitrary SQL or file-path endpoint.
- Rejection does not create a Claim. Stale, repeated, cross-project,
  conflicting, foreign and wrong-target actions must be rejected.
- Ship a versioned read-only status response for Codex/Console. A plain
  local cache can be a display cache but must never become approval authority.

### M3: Native end-to-end acceptance
- Windows x64 disposable runner: real service startup, a human-initiated
  Windows Hello/FIDO2 confirmation in an appropriate interactive test
  environment, exact decision and Claim readback, denial/replay/cross-scope
  tests, restart and cleanup.
- Original Codex CLI **and** Desktop: inspect actual MCP calls and stable
  Claim IDs. Do not infer success from assistant narratives.
- Keep same-user direct DB writes clearly labeled **untrusted preview**
  until protected authority is used for final decisions.

### M4: Opt-in local activation
- Before any existing user's DB is used as a writable authority, take an
  independently verified backup, define a read-only fallback, and verify
  rollback after an interrupted commit. Never silently migrate the canonical
  user DB or rewrite hooks.
- Explicit user signoff is required to install a service or change Codex
  integration on the operator PC. Otherwise default OFF.
- Enable only after protected authority is the source of truth for approved
  Claims; no fake approval from plain local DB contents.

## Threat boundary and deliberate non-goals

**Must stop:** a normal, non-admin agent running with the user's Windows
account from directly changing protected approval state or replaying a
previous approval, including via the publicly exposed client protocol.

**Not an MVP goal:** protection against local Administrators/SYSTEM,
kernel compromise, a deliberately compromised trusted service binary, or
an unlimited security-research matrix. Exact directory ownership, DACL
and obvious link/path checks at the trusted open boundary remain basic
correctness, not a separate research program.

Do not use a plain same-user PowerShell typed phrase as proof against a
malicious shell-capable agent. If the product explicitly downgrades to a
convenience-only preview, show that risk prominently and keep its Claims
untrusted for protected decisions.

**Done means:** A person can inspect, confirm/reject and recall one real
project-scoped `E~` proposal end-to-end, with a protected one-time decision,
and failed/foreign/repeated attempts cannot change an authoritative Claim.
Until then **production Memory Write = NO-GO**.
