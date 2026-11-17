# #338: existing Codex memory_recall stdio MCP as CI-only one-shot recipient

## What now actually runs

The previously tested #388 Windows-only protected recipient pipe is connected to the **existing Codex-compatible `memory_recall` MCP server** via one deliberate, isolated command-line switch:

`node scripts/run-codex-memory-mcp.mjs --ci-one-shot-read --pin ABS_ADMIN_OWNED_CI_PUBLIC_PIN`

This mode is NEVER selected automatically by `--global`, `--cwd`, the installed Codex CLI/Desktop configuration, hooks or memory capture. The normal read-only canonical SQLite reader remains byte-for-byte the same, and the new mode does **not** read local SQLite.

When Codex-compatible MCP calls `memory_recall` with the only admissible synthetic `exact-proposal:E~…` query, the server starts a **new, already connected native Windows recipient pipe**. The recipient first supplies a fresh canonical 32-byte random nonce. The service binds that nonce and its own random value to the kernel-observed recipient session, signs the recipient nonce in the final Claim envelope, and the MCP process rejects any signed payload with a different nonce (including a replay of a previously valid payload). The LocalService returns a non-secret readiness ACK. Until a distinct signed operator-purpose read UV challenge is completed, the MCP request remains pending and no protected Claim value is returned.

Only after the existing administrator-only operator channel verifies the exact protected Claim, kernel-connected process PID and SID, project/branch/revision/query/result digest, recipient fingerprint and fresh one-use read-purpose UV does the service transmit **one ES256 service-signed Claim** to that same pipe. The MCP reader verifies the public signer key, the fixed project/branch/reference, actual own process PID, original Claim SHA-256, consent-scoped release format and explicit `production_authorized=false` before returning the Claim as a normal MCP `tools/call` result. It advertises `status=found_ci_one_shot_not_production`, `ci_mcp_delivered=true`, `physical_human_approval_verified=false`, `trusted_for_production_recall=false`. The next call cannot reuse the consumed ticket or released connection.

The native disposable Windows SCM CI test exercises the actual serialized JSON-RPC `initialize`, `tools/list` and `tools/call` methods over the Node process's stdin/stdout, using the **same `memory_recall` tool name** that original Codex CLI/Desktop uses. It verifies that no tool result is emitted before synthetic UV, then confirms the exact signed synthetic private Claim after approval. Another real recipient process previously demonstrates wrong-purpose denial and replay denial.

## Non-negotiable limits

- The CI process uses the **MCP protocol compatible with Codex**, but a physical original Codex CLI or Desktop session is **not yet verified**. Its executable/signer/session is not attested by the kernel PID alone.
- No real Windows Hello verification is performed in the CI runner, which uses a synthetic software ES256 credential.
- `--ci-one-shot-read` is guarded by Windows GitHub Actions environment and a **separately protected exact synthetic fixture marker and native administrator-only pipe**. The only eligible project is `github.com/example/operator-evidence`, branch `main`; wrong queries or model-supplied scope arguments are rejected. Treat markers and CI environment flags as *test-fixture controls*, **not** production attestation.
- A full-trust Windows process sharing the user's SID can inject into or control a nominated process or inherit/steal handles if OS security allows it. A held kernel-PID-checked pipe proves continuity of a connection, **not** that its endpoint is an uncompromised Codex session. This CI demo cannot be promoted to production based on that PID check.
- The separate WinForms protected review UI still supports preview and intent only. The new recipient release path is **not enabled there**, not installed on the operator PC, and has no real-project read grant. The fixture explicitly returns `production_authorized=false`.

**Next actual release gate:** trustworthy operator-visible selection of the **original Codex CLI/Desktop process and project**, genuine on-device Windows Hello, protected release authority with durable one-shot consumption/audit and revocation, hostile same-SID code-injection/handle-hijack and rollback tests, a real Codex desktop/CLI physical acceptance run and independent review. Without a distinct OS protection boundary or deliberately accepted, documented per-read human transfer tradeoff, the same-user process threat remains unresolved.

**#338 OPEN. Production private Recall and Memory Write remain NO-GO. No extra Windows account or VM, no operator-PC modifications.**
