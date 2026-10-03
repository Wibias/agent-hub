# Memory Engine

Portable reference implementation derived from Memory Ratchet 0.1.0 research.

This directory is implementation code. It is intentionally separate from the hub's `memory/` directory, which remains reserved for episodic lessons.

## Runtime

Node.js 24 or newer is required.

The foundation uses Node's built-in `node:sqlite` module so the hub does not need a native npm dependency or a platform-specific SQLite package.

## Current scope

The reference implementation currently owns:

- canonical SQLite storage in WAL mode;
- stable project registration;
- append-only evidence records, including Evidence-only capture before Claim assertion;
- deterministic claim lifecycle for `supersede` and `reject`;
- strict project and branch filtering before lexical ranking;
- current versus historical recall;
- durable provenance fields;
- mandatory secret redaction before canonical storage or indexing;
- Git path/blob freshness checks for repository-grounded evidence;
- explicit claim-conflict edges;
- explicit source-authority classes;
- retrieval separated from use-specific reliance;
- structured, scoped action approval capabilities;
- atomic one-time approval consumption and revocation;
- a rebuildable FTS5 lexical index;
- deterministic redacted embedding documents;
- rebuildable semantic vector rows keyed by exact model ID and revision;
- correctness-filtered semantic candidates that reuse project, branch, lifecycle, and Git-freshness eligibility;
- deterministic Reciprocal Rank Fusion (RRF) with a fixed `k = 60`;
- an asynchronous `HybridMemoryRetriever` with injected embedder ownership;
- lexical fallback when the semantic provider is missing or query embedding fails;
- explicit hybrid recall caps of at most 10 items and 16 KiB serialized payload;
- portable canonical export/import with derived-state rebuild;
- interrupted-write recovery through transactional canonical state and derived-state rebuild.

The concrete local E5 provider is now isolated behind the hybrid embedder contract:

- `@huggingface/transformers@4.3.0`;
- model `intfloat/multilingual-e5-small`;
- revision `6a0d452a575215f80b8f66276dd4ee5d504942c6`;
- ONNX graph `model_qint8_avx512_vnni.onnx`;
- qint8 model weights with 384-dimensional Float32 normalized embedding output;
- CPU execution;
- mean pooling with normalized output;
- local-files-only normal runtime.

Real-model semantic evaluation is available through the explicit `Memory semantic eval` workflow. Normal tests and normal recall do not download the model.

## Canonical versus derived state

Canonical state:

- `project_registry`
- `evidence`
- `claims`
- `lifecycle_events`
- `conflicts`
- `approvals`

Derived state:

- `repository_path_state`
- `claim_fts`
- `claim_embeddings`

Derived state is never the source of truth. Claim lifecycle, observed repository blob identity, and provenance remain valid even if freshness snapshots or search indexes are rebuilt later.

`repository_path_state` is a rebuildable snapshot of the repository revision being queried. It stores the current commit and path object ID used to decide whether path-grounded evidence is still eligible for current recall. Portable export must not treat this snapshot as durable memory truth.

## Portable export and rebuild

`exportCanonical()` emits only canonical memory state. It includes projects, evidence, claims, lifecycle events, conflicts, and approvals.

It deliberately excludes:

- `claim_fts`;
- `repository_path_state`;
- `claim_embeddings`.

Those are derived state and are rebuilt instead of trusted during import. Canonical import rebuilds the lexical FTS index synchronously, but semantic vectors remain empty until an explicit asynchronous `HybridMemoryRetriever.rebuildSemanticIndex(...)` runs with a configured embedder.

`importCanonical(...)` requires an otherwise empty memory store. The import validates authority classes, claim states, JSON fields, approval use counts, and secret boundaries before writing. Canonical rows and the rebuilt FTS index are committed in one transaction.

Claims are restored in two phases so `superseded_by_claim_id` references remain valid even when the target claim appears later in export order.

Repository freshness snapshots remain empty after import. The reference adapter recomputes them against the revision being queried, so portable restore cannot accidentally preserve stale "current" state from another checkout.

A failed import rolls back instead of leaving a partially restored canonical store.

## Git blob freshness

Repository-grounded evidence can record both an immutable commit SHA and the Git object ID for its source path. Current recall is fail-closed for path-grounded evidence:

- no recorded current path state means the evidence is not current truth;
- the same blob ID at a later commit remains fresh;
- a changed blob ID marks the old observation stale for current recall;
- a deleted path is stale because its current blob ID is null;
- historical recall keeps the old evidence and reports `fresh`, `stale`, or `unchecked` freshness metadata.

This intentionally compares the path object ID, not only the commit SHA. Unrelated commits therefore do not invalidate unchanged repository evidence.

The reference Ratchet adapter resolves object IDs with `git ls-tree` at the immutable observation revision and again at the requested current revision. The engine itself stays Git-provider agnostic.

## Reference adapter trust boundary

The Memory Ratchet reference adapter deliberately does **not** consume the fixture's hidden `trust` oracle.

Authority is derived from observable source channel, event semantics, and an explicit repository-policy allowlist:

```text
user_direct
repo_trusted
tool_observation
agent_inference
external_untrusted
unclassified
```

Repository relevance does not grant repository authority. Only declared policy surfaces such as accepted ADRs and configured project-policy files become `repo_trusted`; other repository documents remain `external_untrusted`.

Retrieval and reliance are separate. Retrieved evidence can remain visible while `evaluateReliance` refuses to use it for a stronger purpose:

- planning may inspect all authority classes;
- normal answers may rely on `user_direct`, `repo_trusted`, and `tool_observation`;
- project policy may rely only on `user_direct` and `repo_trusted`;
- external and destructive actions are never authorised by ordinary reliance; they require a matching structured approval capability through `authorizeAction(...)`.

Authority never bypasses Git freshness. Repository-grounded evidence must first pass the revision-bound blob check before it can enter current recall and therefore before reliance can select it.

Project identity is likewise stable and path-independent. Temporary checkout paths are not used as canonical repository identity.

## Action approval boundary

Action approval is a separate capability API. Normal recall cannot authorise an external or destructive action.

An approval records exact structured scope:

```text
project
actor/source
action
target
environment
artifact
constraints
issued_at
expires_at
max_uses
uses
revoked_at
source_evidence_id
```

Only `user_direct` evidence can mint an approval. `agent_inference`, repository text, tool observations, and external documents cannot create action authority.

`authorizeAction(...)` requires an exact action, target, environment, and artifact match. Required structured constraints must also match. Expired, revoked, exhausted, or not-yet-valid approvals fail closed.

A successful `authorizeAction(...)` always consumes one use in the same immediate SQLite transaction that checks the capability. A one-time approval cannot be checked successfully and then reused for another execution.

The evaluation timestamp comes from the engine clock, not from the action request. Callers cannot backdate a request to resurrect an expired approval. Tests may inject a deterministic clock when constructing the engine.

Free-text similarity is never used to decide action authority.

## Evidence and claims

Evidence records what was observed or stated.

Claims represent the current applicability of that evidence.

The engine supports both write shapes:

- `recordEvidence(...)` commits immutable Evidence without making it recallable as a Claim;
- `assertClaim({ evidenceId, claim, lifecycle })` attaches a Claim later while preserving the original Evidence provenance;
- `ingest({ evidence, claim, lifecycle })` remains the atomic combined path for callers that already have both.

Standalone Evidence is included in canonical export/import, but it does not enter FTS, embeddings, or recall until a Claim references it.

Evidence is inserted once and is not rewritten to hide later history. A lifecycle transition updates claim state instead:

```text
active -> superseded
active -> rejected
```

`assertClaim(...)` and legacy `ingest(...)` apply Claim creation, lifecycle changes, conflicts, and FTS updates in one immediate SQLite transaction. A failed lifecycle validation cannot leave a partial Claim or mutate an existing target. Legacy `ingest(...)` also keeps Evidence + Claim atomic, so a failed Claim transaction does not leave orphaned Evidence.

These primitives are trusted engine APIs. A future host protocol must derive source authority outside generic caller input rather than expose `authorityClass` as a self-assigned transport field.

Historical recall can still return lifecycle-retained claims with their state.

## Secret boundary

Secret scanning runs before any evidence content, claim value, source reference, or metadata enters canonical SQLite or FTS.

Detected values are replaced with:

```text
[REDACTED_SECRET]
```

The original value is not stored in the semantic database.

The initial detector covers common API-key, bearer-token, token, secret, and password assignment shapes. It is intentionally a pre-storage boundary, not a recall-time cosmetic filter.

## Minimal API

```js
import {
  MemoryEngine,
  evaluateReliance,
} from './memory-engine/index.mjs';

const memory = new MemoryEngine({ dbPath: './memory.sqlite3' });

memory.registerProject({
  projectId: 'project-a',
  repoIdentity: 'project-a',
});

// Evidence may be captured before a durable Claim is known.
memory.recordEvidence({
  id: 'evidence-observation',
  projectId: 'project-a',
  harness: 'codex',
  sessionId: 'session-1',
  sourceKind: 'tool',
  sourceRef: 'tool:observer',
  capturedAt: '2026-09-29T00:00:00Z',
  branch: 'main',
  commitSha: null,
  path: null,
  blobOid: null,
  content: 'Observed the current database configuration.',
  authorityClass: 'tool_observation',
  metadata: {},
});

// Existing atomic Evidence + Claim ingestion remains supported.
memory.ingest({
  evidence: {
    id: 'evidence-1',
    projectId: 'project-a',
    harness: 'codex',
    sessionId: 'session-1',
    sourceKind: 'user_direct',
    sourceRef: 'session:session-1',
    capturedAt: '2026-09-29T00:00:00Z',
    branch: 'main',
    commitSha: null,
    path: null,
    blobOid: null,
    content: 'Use Postgres.',
    authorityClass: 'user_direct',
    metadata: {},
  },
  claim: {
    id: 'claim-1',
    kind: 'decision',
    subject: 'database',
    predicate: 'uses',
    value: 'Postgres',
    branchScope: 'main',
    createdAt: '2026-09-29T00:00:00Z',
  },
});

const current = memory.recall({
  projectId: 'project-a',
  branch: 'main',
  query: 'database Postgres',
  mode: 'current',
});

const answerEvidence = evaluateReliance({
  items: current.items,
  conflicts: current.conflicts,
  use: 'answer',
});

memory.close();
```

## Cross-harness protocol v1

`memory-engine/protocol.mjs` exposes the transport-neutral integration contract:

```text
memory.protocol.v1
```

The protocol does not define a socket, CLI, MCP server, or host hook. A trusted host adapter owns transport and calls `createMemoryProtocol(...).handle(request)`.

Every request uses:

```json
{
  "protocol": "memory.protocol.v1",
  "operation": "recall",
  "request_id": "request-123",
  "payload": {}
}
```

Every response echoes the protocol and request ID and returns either `ok: true` with `result`, or `ok: false` with a fixed error `code` and safe message.

Frozen V1 operations:

- `capture_evidence`: record standalone Evidence;
- `assert_claim`: attach a Claim to existing Evidence;
- `recall`: bounded current recall;
- `history`: bounded historical recall;
- `authorize`: exact structured action-capability evaluation;
- `export`: canonical portable export;
- `import`: canonical portable restore;
- `status`: content-free canonical counts.

Trust rules:

- wire callers cannot provide `authority_class`;
- `capture_evidence` requires an injected trusted `classifyAuthority(...)` callback;
- `assert_claim` is default-deny and requires an injected trusted `authorizeClaim(...)` callback;
- unknown wire fields fail closed instead of being silently accepted;
- operation failures return fixed messages rather than raw Engine errors or payload values;
- recall/history always enforce at most 10 items and at most 16 KiB serialized output.

Example construction:

```js
import { createMemoryProtocol } from './memory-engine/protocol.mjs';

const protocol = createMemoryProtocol({
  memory,
  classifyAuthority(channel) {
    return classifyTrustedHostChannel(channel);
  },
  authorizeClaim(context) {
    return trustedClaimPolicy(context);
  },
});

const response = await protocol.handle({
  protocol: 'memory.protocol.v1',
  operation: 'recall',
  request_id: 'request-123',
  payload: {
    project_id: 'project-a',
    branch: 'main',
    revision_sha: null,
    query: 'Which database handles concurrent writers?',
    max_items: 10,
    max_serialized_bytes: 16_384,
  },
});
```

The protocol is a local integration boundary, not an untrusted network authorization layer. Host adapters remain responsible for resolving configured project identity and observed source channels outside prompt-controlled text.

## Codex command-hook adapter

The production Codex integration uses separate documented lifecycle surfaces for separate authority classes:

```text
UserPromptSubmit -> memory-engine/adapters/codex-hook-cli.mjs
Stop/SubagentStop -> memory-engine/adapters/codex-agent-decision-hook-cli.mjs
```

`UserPromptSubmit` owns recall, explicit memory management, and conservative direct-user candidate capture. When current memory is available, it performs broad bounded recall, applies the existing `answer` reliance policy, and writes reliance-selected authoritative evidence as Codex-compatible `hookSpecificOutput.additionalContext` JSON.

Promoted agent decisions are the one deliberate exception to the normal exclusion of `agent_inference`: active Claims with `kind=agent_inference`, `subject=agent decision`, and `predicate=states` may be injected only in a separately labelled **advisory prior agent decisions** block. That block explicitly says it is lower authority and may never override `user_direct`, `repo_trusted`, or `tool_observation`. Other `agent_inference`, `external_untrusted`, and `unclassified` evidence remains excluded from answer context. Agent decisions attached to unresolved conflicts are also withheld.

`Stop` and `SubagentStop` own only conservative capture of explicit finalized agent commitments from `last_assistant_message`. They never relabel agent output as user authority, never parse transcript history, and fail open if capture cannot run.

Missing configuration, Git-context failure, unavailable memory, recall failure, or an empty recall/capture result does not block the user turn.

### Configuration

The adapter requires explicit shared memory configuration in the Codex process environment:

```text
AGENT_HUB_MEMORY_DB=/absolute/shared/memory.sqlite3
AGENT_HUB_MEMORY_PROJECT_ID=project-a
```

Optional:

```text
AGENT_HUB_MEMORY_REPO_IDENTITY=github.com/example/project
AGENT_HUB_MEMORY_CAPTURE_PROMPTS=false
```

`AGENT_HUB_MEMORY_REPO_IDENTITY` defaults to the configured project ID.

Direct prompt capture is disabled by default. Setting `AGENT_HUB_MEMORY_CAPTURE_PROMPTS=true` stores the exact direct prompt as standalone `user_direct` Evidence only. It does not assert a Claim and does not make every prompt durable project truth.

Project identity is never derived from prompt text or the checkout path.

### Codex hook registration

For normal Codex host setup and upgrades, prefer the repository-level orchestrator:

```powershell
node .\scripts\setup-codex-host.mjs
node .\scripts\setup-codex-host.mjs --apply
```

Use the dedicated hook installer below when diagnosing or repairing only the hook
surface rather than the complete managed Codex host state.

Use the installer rather than editing `~/.codex/hooks.json` by hand.

Dry-run:

```powershell
node .\scripts\install-codex-memory-hooks.mjs
```

Apply:

```powershell
node .\scripts\install-codex-memory-hooks.mjs --apply
```

The installer derives the Agent Hub checkout from its own location, preserves unrelated
Codex hooks and root fields, removes duplicate or stale Agent Hub memory-hook entries,
and installs exactly one current definition for each managed surface:
`SessionStart`, `UserPromptSubmit`, `Stop`, and `SubagentStop`. Apply mode creates a timestamped backup before
changing an existing hooks file and refuses to modify a symlinked hooks file. A second
apply is idempotent and creates no new backup when the managed definitions are already
current.

The dry-run also includes a content-free `plan` for all four managed events. Each
event is classified as `current`, `install`, or `normalize`, with bounded reasons
such as a missing managed hook, duplicate managed hooks, a mixed entry, or a differing
managed definition. It does not print existing hook commands.

The installer does not bypass Codex hook trust. If it reports
`hookTrustRequired: true`, open `/hooks` in Codex and review/trust the exact changed
definitions before relying on them.

Optional controlled-install overrides are:

```powershell
node .\scripts\install-codex-memory-hooks.mjs `
  --hooks C:\path\.codex\hooks.json `
  --hub-root C:\path\.agents `
  --node C:\path\node.exe `
  --apply
```

For production memory operation, the managed configuration contains four independent lifecycle surfaces:

1. an asynchronous `SessionStart` launcher that makes sure the warm E5 worker exists;
2. the normal `UserPromptSubmit` memory hook with hybrid recall, direct-user candidate capture, and automatic pipeline wake-up;
3. a `Stop` entry with a synchronous capture hook plus an asynchronous agent-pipeline hook;
4. a `SubagentStop` entry with the same split while preserving `agent_id` and `agent_type` provenance.

The synchronous decision hook is capture-only:

```text
codex-agent-decision-hook-cli.mjs --ignore-memory-env
```

The paired async hook runs:

```text
scripts/codex-agent-memory-pipeline-hook.mjs --ignore-memory-env
```

The async hook repeats deterministic capture idempotently before processing so it cannot lose a race with the synchronous capture handler. It then runs the existing candidate worker inline inside Codex's supported async-hook lifetime rather than spawning a detached child from `Stop` / `SubagentStop`. Both authority lanes still share the same project/branch candidate ledger, log, and cross-process lock.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/agent-hub/memory-engine/embedding-worker-launcher.mjs --cache-dir /absolute/path/to/agent-hub/.cache/memory-engine/e5",
            "commandWindows": "powershell.exe -NoProfile -NonInteractive -EncodedCommand <generated-payload>",
            "timeout": 45,
            "async": true,
            "statusMessage": "Starting project memory embeddings"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/agent-hub/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall --candidate-capture --auto-pipeline",
            "commandWindows": "powershell.exe -NoProfile -NonInteractive -EncodedCommand <generated-payload>",
            "timeout": 10,
            "statusMessage": "Recalling project memory",
            "additionalContextLimit": 2500
          }
        ]
      }
    ]
  }
}
```

Replace the example paths with the real checkout path. On Windows, do not hand-build
the encoded payload. Run `node .\\scripts\\setup-codex-host.mjs --apply`; the installer
generates a shell-neutral PowerShell payload containing the exact Node and script paths,
including safe handling for spaces and apostrophes, and propagates the Node exit code.
This avoids quoted-executable parsing failures when Codex Desktop dispatches hooks through
PowerShell instead of `cmd.exe`. The prompt hook inherits the memory environment variables
from the Codex process.

The launcher is idempotent. It first uses the IPC `health` operation, which verifies the pinned model identity without running inference. If no worker is ready, a cross-process lock ensures that only one concurrent Codex session spawns the detached worker. Other sessions wait for the same worker instead of loading another E5 runtime. A stale launcher lock is recoverable.


`SessionStart` is a warm-start optimization, not a correctness dependency. Some Codex
host paths can discover and trust lifecycle hooks without dispatching the command. When
`--hybrid-recall` is enabled, the `UserPromptSubmit` adapter therefore performs the
same idempotent worker check against the prepared local E5 cache before constructing the
hybrid retriever. If the worker is absent, it may start the detached local worker and wait
for readiness for at most 5 seconds. If startup fails, the prompt remains fail-soft and
uses lexical recall.

Prompt-time recovery never prepares or downloads a model. It only runs when the
repository-local prepared cache already exists, and the worker still opens that cache with
remote loading disabled.

The launcher writes no normal stdout because `SessionStart` stdout becomes developer context. Worker stdout/stderr instead append to `embedding-worker.log` beside the model-cache directory.

Codex requires changed non-managed hooks to be reviewed again because hook trust is bound to the exact hook definition. After adding or changing these handlers, open `/hooks` in Codex and trust the current definitions.

The prompt adapter handles only `UserPromptSubmit`. The separate decision adapter handles only `Stop` and `SubagentStop`, and reads only the documented `last_assistant_message` plus event identity/provenance fields. Neither adapter captures `PostToolUse`, summarizes on `SessionEnd`, or parses `transcript_path` / `agent_transcript_path`.

### Deterministic memory-candidate capture

Production Codex can opt into conservative candidate capture with:

```text
--candidate-capture
```

This is **not automatic durable memory**. It is the first stage of the automatic-memory pipeline.

For an ordinary direct-user prompt, the adapter first applies a deterministic `capture-v1` policy. The policy currently recognizes only strong signals in these categories:

```text
decision
preference
constraint
correction
rejected_approach
known_issue
```

Examples that can become pending candidates:

```text
We decided to use Postgres for concurrent writers.
Wir müssen bei GitHub Free bleiben.
I prefer dark editorial UI over generic SaaS cards.
Bei Rollenwechsel keinen Reconnect verwenden.
Korrektur: Die Produktionsdatenbank ist Postgres, nicht SQLite.
Known issue: Host camera crop is still incorrect.
```

The deterministic filter rejects at least:

- short/transient task controls such as `go`, `Fahre fort`, `Run tests`;
- tentative language such as `maybe`, `perhaps`, `vielleicht`, `sollten wir`;
- questions;
- assistant-directed task requests such as `I want you to run the tests`, `Ich will, dass du ...`, `Kannst du ...`;
- explicit memory-management commands;
- prompts containing material matched by the memory secret detector.

When a prompt qualifies:

1. the exact prompt is stored as redacted `user_direct` Evidence;
2. a separate `memory_candidates` row is created with status `pending`;
3. project, branch, and authority are derived from the Evidence, not supplied by the candidate classifier;
4. the proposed value must exactly equal the redacted Evidence text;
5. a stable project+branch fingerprint suppresses duplicate candidate Evidence;
6. **no Claim is asserted**.

Pending candidates therefore never enter lexical recall, semantic recall, answer-reliance selection, lifecycle conflict resolution, or `memory list`.

The ledger intentionally separates operational capture state from canonical memory:

```text
User prompt
   -> redacted Evidence
   -> pending Candidate
   -> future judge/promotion layer
   -> canonical Claim
```

The v1 ledger separates capture from evaluation. The AI importance judge described below may populate the reserved evaluation fields, but relation classification, canonical promotion, supersession, and confirmation handling remain separate later stages.

Pending candidates for the current Git project and branch can be inspected read-only with:

```text
memory candidates
```

Example:

```text
Pending memory candidates for the current project and branch:
- ~8d21f0a74c [constraint] We must stay on GitHub Free.
```

Candidate refs use `~` to remain distinct from durable Claim refs, which use `@`.

Candidate capture is deliberately independent from `AGENT_HUB_MEMORY_CAPTURE_PROMPTS=true`. The legacy environment flag still means full direct-prompt Evidence capture. `--candidate-capture` instead stores only prompts accepted by the deterministic policy.

The memory doctor treats a missing candidate ledger or a managed Codex hook without `--candidate-capture` as **degraded**, not broken. Canonical memory and recall remain usable, but automatic candidate capture is not ready.

### Agent decision capture

Codex can also remember its own durable decisions, but those memories run through a separate lower-authority lane rather than weakening the direct-user pipeline.

The managed `Stop` and `SubagentStop` hooks apply deterministic policy `agent-capture-v1` to `last_assistant_message`. Capture is intentionally narrow: only explicit finalized commitments such as `Decision: ...`, `I decided ...`, or equivalent German forms are eligible. Tentative language, questions, ordinary progress/status narration, and secret-shaped text are rejected. At most three decisions are captured from one assistant message.

A captured decision is stored as:

```text
Evidence authority = agent_inference
Candidate authority = agent_inference
Candidate type      = decision
```

Root and subagent decisions preserve separate provenance. Subagent Evidence records the documented `agent_id` and `agent_type`; candidate fingerprints are namespaced by agent type so unrelated root/reviewer statements do not collide.

Capture still creates **no Claim**:

```text
Stop / SubagentStop
        ↓
agent-capture-v1
        ↓
redacted agent_inference Evidence
        ↓
pending agent_inference Candidate
```

The agent lane then uses its own policies:

```text
agent-importance-v1
        ↓
agent-relation-v1
        ↓
agent-promotion-v1
```

`agent-importance-v1` runs in the same isolated auth-only Codex judge environment as the direct-user judges, but uses a stricter authority prompt. Automatic promotion is allowed only for explicit long-lived technical/project decisions with high future utility, high confidence, exact meaning preservation, and no risk flags. A promoted canonical fact must begin with:

```text
Agent decision:
```

The judge is forbidden to rewrite an agent statement as user intent, user preference, project policy, or any stronger source authority.

`agent-relation-v1` may compare the candidate against both active durable `user_direct` memories and active durable `agent_inference / agent decision` memories from the same project and branch. Existing authority is supplied explicitly to the judge. Classification remains model-only metadata; lifecycle mutation is deterministic later.

`agent-promotion-v1` applies the following fixed authority rules:

```text
unrelated
  -> create active agent_inference / agent decision Claim

same
  -> close candidate as redundant; create no duplicate Claim

clear update -> existing agent decision
  -> create new agent decision and supersede the exact older agent decision

update -> user_direct memory
  -> needs_confirmation; never silently supersede user authority

contradict -> user_direct or agent decision
  -> needs_confirmation; never self-authorize a winner/conflict
```

A lower-confidence or meaning-unsafe relation also becomes `needs_confirmation`.

Promoted agent decisions participate in lexical and semantic retrieval, but the prompt adapter injects them only in the explicitly labelled advisory block described above. They never enter ordinary answer reliance as if they were user, repository, or tool authority.

### AI candidate importance judge

Pending candidates can be evaluated with the isolated Codex importance judge:

```powershell
node .\scripts\judge-memory-candidates.mjs
```

The command is dry-run by default. Persisting evaluation metadata requires an explicit:

```powershell
node .\scripts\judge-memory-candidates.mjs --apply
```

Useful bounded options:

```text
--limit 1..20
--model <codex-model>
--reasoning-effort low|medium|high
--cwd <repository>
--db-path <memory.sqlite3>
```

The judge uses policy `importance-v2` and returns exactly one structured recommendation per candidate.

The v2 boundary between `ignore` and `keep_candidate` is explicit: temporary information is not automatically ignored. A bounded decision, preference, or constraint that should guide multiple future work sessions until a named milestone such as a migration cutover, release cycle, or pilot review belongs in `keep_candidate`. `ignore` is reserved for effectively one-off/current-run state or low-future-utility information. The durable `promote` requirements are unchanged from v1.

```json
{
  "decision": "promote",
  "suggested_type": "decision",
  "durability": "long",
  "future_utility": "high",
  "specificity": "high",
  "confidence": "high",
  "meaning_preserved": true,
  "canonical_fact": "The project uses Postgres for concurrent writers.",
  "reason": "Explicit durable architecture decision likely to affect future work.",
  "risk_flags": []
}
```

Allowed decisions are:

```text
promote
ignore
keep_candidate
needs_confirmation
```

`promote` is only a recommendation in this stage. It does **not** create a Claim and does not enter recall.

A promote recommendation is rejected unless all deterministic postconditions hold:

```text
durability       = long
future_utility   = high
confidence       = high
meaning_preserved = true
canonical_fact   = non-empty
risk_flags       = []
```

Invalid or malformed model output leaves the candidate unevaluated. The runner continues with later candidates instead of converting an evaluator failure into memory state.

Persisted operational mapping is:

```text
ignore              -> status=ignored
needs_confirmation  -> status=needs_confirmation
promote             -> status=pending + evaluated_at/evaluation_json
keep_candidate      -> status=pending + evaluated_at/evaluation_json
```

An evaluated `keep_candidate` is a review backlog item, not an automatic promotion queue. It is excluded from relation evaluation and deterministic promotion. It remains visible through `memory candidates`, is counted as `kept-for-review` / `kept_for_review` in pipeline status, and may become durable only through the explicit user confirmation path described below. Unevaluated `pending` candidates are never confirmable.

The evaluation write rechecks the source Evidence boundary before mutation:

- candidate and Evidence must still be `user_direct`;
- Evidence must not be secret-redacted;
- project and branch must still match;
- candidate value must still equal the exact redacted Evidence text;
- a candidate can be evaluated only once.

The judge itself runs through the locally authenticated `codex exec`, but not inside the user's normal Codex state. For every judge run Agent Hub creates:

- a fresh temporary `CODEX_HOME` containing only copied `auth.json`;
- an empty temporary Git repository;
- an ephemeral Codex session;
- no inherited hooks, config, Agent Hub memory environment, or legacy native memory.

The prompt treats the candidate as untrusted quoted data, forbids tools/outside knowledge, and asks the model to prefer precision over recall. The temporary judge environment is removed after the run.

An evaluated pending recommendation is visible through `memory candidates`, for example:

```text
- ~8d21f0a74c [constraint] We must stay on GitHub Free. | judge=promote durability=long utility=high confidence=high
```

Even then, `memory list` remains unchanged because no canonical Claim exists.

### AI candidate relation and dedupe judge

Candidates that already have a valid `importance-v2` `promote` recommendation can be compared against existing active durable user memory with:

```powershell
node .\scripts\judge-memory-relations.mjs
```

The command is dry-run by default. Persisting relation metadata requires explicit `--apply`:

```powershell
node .\scripts\judge-memory-relations.mjs --apply
```

The relation policy is `relation-v1` and has exactly four outcomes:

```text
same
update
contradict
unrelated
```

Definitions:

- `same`: the candidate and one existing durable memory express the same durable proposition, allowing harmless paraphrase;
- `update`: the candidate clearly presents a newer replacement/change to one existing memory;
- `contradict`: the candidate is incompatible with one existing memory but does not safely establish replacement semantics;
- `unrelated`: no supplied active durable memory is close enough to the same proposition.

Only active durable `user_direct` Claims from the **same project and branch** are supplied to the judge. For `same`, `update`, and `contradict`, the model must return one opaque `@...` ref copied from that supplied set. Unknown refs fail closed.

When no active durable memory exists in scope, Agent Hub resolves the candidate to `unrelated` deterministically without invoking the AI judge.

Like the importance judge, the relation judge runs in a fresh isolated Codex home with auth only, an empty temporary Git repository, no inherited hooks/config/native memory, and no Agent Hub workspace context.

Persisted relation state is operational only:

```text
importance=promote
      ↓
relation-v1
      ↓
memory_candidates.relation / related_claim_id
      +
memory_candidate_relations audit row
```

It does **not** mutate canonical memory. In particular:

- `same` does not delete or merge Claims;
- `update` does not supersede the existing Claim;
- `contradict` does not open or resolve a lifecycle conflict;
- `unrelated` does not create a new Claim.

Those lifecycle actions belong to the later deterministic promotion policy.

Stored relations are visible through `memory candidates`, for example:

```text
~8d21f0a74c [decision] We use Postgres. | judge=promote durability=long utility=high confidence=high | relation=same target=@7fa31c9e42
```

Relation evaluation is exactly-once. The write rechecks that the candidate still has a valid `promote` importance judgment and that any target is still an active durable direct-user memory in the candidate's current project and branch.

### Deterministic candidate promotion policy

Candidates with both a valid `importance-v2` `promote` recommendation and a stored relation can enter the final deterministic stage with:

```powershell
node .\scripts\promote-memory-candidates.mjs
```

The command is dry-run by default. Canonical mutation requires explicit `--apply`:

```powershell
node .\scripts\promote-memory-candidates.mjs --apply
```

Policy `promotion-v1` contains no model call. It maps the already stored importance and relation results to one fixed action:

```text
same        -> candidate status=superseded; no new Claim
unrelated   -> create one active durable Claim
update      -> create one active durable Claim and supersede the exact relation target
contradict  -> create one active durable Claim and open a conflict with the exact relation target
```

Promotion is fail-closed. Before any mutation the engine rechecks:

- the candidate is still pending;
- the importance judgment still validates as `promote`;
- the stored relation audit is present and consistent with candidate metadata;
- the source Evidence is still same-project, same-branch, `user_direct`, non-secret, and exactly matches the captured candidate value;
- any relation target is still an active durable direct-user Claim in the same project and branch;
- the opaque target ref still resolves to that exact Claim;
- relation confidence is `high`;
- relation `meaning_preserved` is `true`.

A relation with lower confidence or unsafe meaning preservation becomes `needs_confirmation` and creates no Claim.

New automatically promoted Claims keep the durable direct-user shape used by explicit memory:

```text
kind=user_direct
subject=user memory
predicate=states
```

Their value is the validated `canonical_fact` from the importance judgment. The original direct-user Evidence remains attached as immutable provenance and is included in search text.

For `update` and `contradict`, Claim creation plus lifecycle/conflict mutation plus candidate status plus promotion audit are committed in one immediate SQLite transaction. A crash cannot leave an automatically promoted Claim without its candidate finalization, or mutate a target without the new Claim.

`contradict` never chooses a winner. Both Claims remain active and the existing recall/reliance conflict gate handles the unresolved conflict fail-closed.

Promotion decisions are recorded in the operational `memory_candidate_promotions` audit table. Like the candidate and relation ledgers, this table is not canonical memory and is excluded from portable canonical export.

### Explicit candidate confirmation

Policy `confirmation-v2` accepts two explicitly reviewable candidate states:

- `needs_confirmation`: the automatic path requires user clarification or approval;
- evaluated `keep_candidate`: the importance judge kept the item as a review backlog candidate, but it is not eligible for automatic relation or promotion.

Both are visible through:

```text
memory candidates
```

The listing includes both `pending` and `needs_confirmation` candidates with stable opaque `~...` refs.

Confirmation is not a generic yes/no action. The user must state the lifecycle meaning explicitly:

```text
memory candidate confirm: ~0123456789 => unrelated
memory candidate confirm: ~0123456789 => same @abcdef0123
memory candidate confirm: ~0123456789 => update @abcdef0123
memory candidate confirm: ~0123456789 => contradict @abcdef0123
```

Semantics:

```text
unrelated   -> create one active durable Claim
same        -> create no Claim; close the candidate as redundant
update      -> create one active durable Claim and supersede the selected active memory
contradict  -> create one active durable Claim and open a conflict with the selected active memory
```

The command accepts only a stable candidate `~...` ref. Every relation except `unrelated` also requires one stable active-memory `@...` ref. Unknown, ambiguous, inactive, cross-project, or cross-branch targets fail closed.

The confirmation command itself is captured as separate direct-user Evidence and recorded in the operational `memory_candidate_confirmations` audit table.

For a direct-user candidate, the existing v2 behavior is unchanged: a created durable Claim remains attached to the candidate's exact original direct-user source Evidence.

For an `agent_inference` candidate, explicit confirmation is an intentional authority upgrade. The engine **does not relabel the original agent Evidence**. Instead it creates new `user_confirmation` Evidence with `authority_class=user_direct`, stores the candidate's exact decision text there, and links metadata back to both the original agent Evidence and the explicit confirmation Evidence. The resulting durable Claim is then `user_direct / user memory / states`.

This also makes `same` against an existing agent decision useful: explicit user confirmation creates one direct-user Claim and supersedes the lower-authority agent decision rather than leaving the authority unchanged.

Before mutation, the engine rechecks:

- the candidate is either `needs_confirmation` or an evaluated `pending` candidate whose stored valid importance decision is exactly `keep_candidate`;
- an unevaluated `pending` candidate is never confirmable;
- candidate source Evidence authority exactly matches the candidate authority (`user_direct` or `agent_inference`), is same-project, same-branch, non-secret, and still exactly matches the candidate value;
- confirmation Evidence is direct-user, same-project, same-branch, non-secret, and marked as a candidate-confirm command;
- direct-user candidates may target only active durable direct-user memories;
- agent candidates may target active durable direct-user memories or active durable agent-decision memories in the same project and branch.

Confirmation finalization is exactly-once. Claim creation, lifecycle/conflict mutation, candidate status, and confirmation audit are one immediate SQLite transaction. Lifecycle and conflict provenance point to the explicit confirmation Evidence, while the durable Claim itself remains attached to the original candidate Evidence.

### Candidate confirmation behavioral evaluation

The explicit confirmation path has a separate deterministic end-to-end behavioral evaluation:

```powershell
node .\scripts\eval-memory-candidate-confirmation.mjs
```

It does not call Codex or any external model. Each case uses a temporary SQLite database, captures an ordinary prompt through the real `UserPromptSubmit` candidate path, drives the existing candidate pipeline deterministically into an explicitly reviewable state (`needs_confirmation` or evaluated `keep_candidate`), lists the candidate through `memory candidates`, and then submits the real explicit confirmation command through the hook adapter.

The seven cases cover:

- `unrelated` confirmation creating one active durable Claim;
- explicit confirmation of an evaluated `keep_candidate` review-backlog item;
- `same` confirmation closing the candidate without a duplicate Claim;
- `update` confirmation superseding exactly the selected active memory;
- `contradict` confirmation preserving both Claims and opening one conflict;
- an unknown stable candidate ref failing closed without lifecycle mutation;
- a target memory that exists only on another branch failing closed without cross-branch mutation.

Successful confirmation cases replay the identical confirmation hook event and require no additional Evidence, Claim, lifecycle, conflict, or confirmation-audit mutation. Every case also reruns the automatic candidate pipeline and requires the importance, relation, and promotion queues to remain empty.

The confirmation command itself is model-free. The behavioral runner executes `memory candidates` separately as the real read-only hook step, then snapshots the deterministic judge-call count immediately before `memory candidate confirm` and requires the confirmation-command delta to remain zero.

### Candidate pipeline runner

When explicit memory management commands are enabled, Codex can inspect the current pipeline without starting a judge or writing memory state:

```text
memory pipeline
```

The command reports:

```text
importance-ready
relation-ready
promotion-ready
agent-importance-ready
agent-relation-ready
agent-promotion-ready
needs-confirmation
kept-for-review
```

The first six values are the bounded next-batch counts using the pipeline maximum of 20. `needs-confirmation` and `kept-for-review` are exact current-scope counts across both authority lanes. Kept candidates are review backlog only and do not enter automatic relation or promotion queues. The response also prints the explicit operator command:

```powershell
node .\scripts\process-memory-candidates.mjs --apply
```

`memory pipeline` is strictly read-only with respect to the memory database. It resolves the current Git branch/repository context, but returns before repository-freshness recording, Evidence capture, protocol recall, AI judge execution, promotion, or lifecycle mutation.

Both automatic candidate lanes can be composed with one explicit operator command:

```powershell
node .\scripts\process-memory-candidates.mjs
```

Without `--apply`, the command is status-only. It reports the bounded next batch for all six user/agent stages plus exact current-scope counts for `needs_confirmation` and evaluated `keep_candidate` review backlog items. It invokes no judge and performs no promotion.

To process one bounded batch through the available stages:

```powershell
node .\scripts\process-memory-candidates.mjs --apply
```

The order is fixed and authority-separated:

```text
user_direct:
  importance-v2
      ↓
  relation-v1
      ↓
  promotion-v1

agent_inference:
  agent-importance-v1
      ↓
  agent-relation-v1
      ↓
  agent-promotion-v1
```

The direct-user queue methods explicitly filter `source_authority=user_direct`; the agent queue methods explicitly filter `source_authority=agent_inference`. A candidate therefore cannot drift from one authority policy into the other.

The runner rechecks eligibility after every completed stage. It starts a stage only when at least one candidate is currently eligible, so empty queues never start unnecessary isolated judges.

Project, branch, repository path, database path, and revision are resolved once when the pipeline starts. The same frozen runtime scope is injected into all six stage runners. A branch change during execution therefore cannot silently redirect a later stage to another candidate scope.

After any stage actually creates one or more new Claims, the detached worker synchronizes semantic derived state once through the already-running local E5 IPC worker. Ignore, `same`, review-only, and confirmation-only outcomes do not trigger an unnecessary reindex. This keeps FTS and E5 coverage aligned after automatic promotion without making embeddings canonical truth.

`--limit N` sets the maximum next batch for each stage and accepts `1..20`. One invocation processes at most one bounded batch per stage. Run the command again to drain additional queued batches.

The optional AI settings are shared by both judge stages:

```powershell
node .\scripts\process-memory-candidates.mjs --apply --model <model> --reasoning-effort high
```

Promotion receives no model options because it contains no model call.

The runner adds no new decision policy. It delegates to the existing importance, relation, and deterministic promotion implementations. Infrastructure failure in a stage aborts later stages. Candidate-local failures that a stage runner already records fail closed for those candidates, while newly eligible successful candidates may continue to the next stage.

Candidates in `needs_confirmation` and evaluated `keep_candidate` backlog items are never auto-confirmed by this runner. They remain visible through `memory candidates` and require the explicit confirmation commands documented above.

Automatic processing uses two launch modes so model work stays off the synchronous hook hot path.

For direct-user candidates, `UserPromptSubmit --auto-pipeline` keeps the existing behavior: after synchronous capture/recall finishes, Agent Hub freezes the repository scope, closes the prompt-time database connection, and launches the candidate worker detached.

For root/subagent decisions, the synchronous `Stop` / `SubagentStop` hook is capture-only. A paired Codex `async: true` hook repeats capture idempotently, freezes the same repository scope, and runs the candidate worker inline inside the async hook process. This avoids depending on a detached descendant surviving the end of a synchronous Stop hook.

The candidate worker in either launch mode:

- holds a cross-process project+branch lock so concurrent Codex sessions cannot run the same candidate scope in parallel;
- writes stdout/stderr to `candidate-pipeline.log` beside the memory database instead of hook stdout;
- runs bounded batches through the existing explicit pipeline implementation;
- rechecks automatic queues between bounded rounds and stops when drained;
- stops rather than repeatedly retrying a stalled queue in the same worker;
- exits fail-closed while a memory restore lock is active;
- never auto-confirms `needs_confirmation` or `keep_candidate`.

The manual command remains available as a diagnostic and recovery fallback:

```powershell
node .\scripts\process-memory-candidates.mjs --apply
```

### Memory observability

Automatic candidate processing records local operational telemetry separately from canonical memory truth. Every worker run receives an opaque run reference such as `@p4f82a1c3d` and records its trigger, current project/branch/revision, start/end time, duration, bounded stage counters, candidate refs, promotion count, completion state, and redacted technical failures.

The operational tables are:

```text
memory_pipeline_runs
memory_pipeline_failures
```

They are intentionally excluded from `exportCanonical()`. Portable memory export remains limited to durable memory truth; pipeline history is host-local observability just like semantic derived state.

Pipeline JSONL output is tagged with the same `run_id`, `run_ref`, and trigger so a single automatic run can be followed across stage output.

Four read-only Codex commands expose the operator surface:

```text
memory inspect: @7fa31c9e42
memory health
memory pipeline failures
memory stale
```

`memory inspect: @ref` resolves exactly one Claim in the current project and branch and shows authority, state, root/user/subagent provenance, Evidence and Candidate identifiers, importance and relation judgments, lifecycle links, conflicts, promotion time, and semantic-index state. Historical superseded/rejected Claims remain inspectable by their stable ref.

`memory health` is the compact everyday status surface. It reports SQLite/WAL health, E5 worker readiness, managed-hook health, pending and review backlog, candidate/run failures, semantic coverage, and the most recent pipeline run. It is intentionally much smaller than the full `doctor-memory.mjs` report.

`memory pipeline failures` is a bounded dead-letter-style view of recorded technical failures. It shows run ref, candidate ref when available, stage, error class/message, and timestamp. The command never retries work and never mutates candidate or Claim state.

Recall observability is also local derived state. `memory_recall_runs` records a SHA-256 query hash rather than raw prompt text, retrieval mode/fallback, counts, and final context size. `memory_recall_items` records per-Claim rank information and distinguishes `retrieved`, `budget_retained`, `answer_selected`, `advisory_included`, and blocked/budget-dropped outcomes. The protocol emits this through an internal side channel, so normal recall responses keep their existing byte budget and shape and no second embedding query is required.

`memory inspect: @ref` includes the Claim's recall/context usage and a provenance chain such as `session -> subagent type/id -> turn -> decision`.

`memory stale` is advisory only. It lists active lower-authority agent decisions older than 90 days that have not entered answer/advisory context during that window. Retrieval alone does not count as actual use. It never expires, rejects, supersedes, or deletes a Claim automatically.

For high-confidence duplicate control, `agent-relation-v1` now short-circuits only exact-normalized or extremely close text variants when critical negation and numeric tokens also match. Wider semantic paraphrases still go through the existing model relation judge; the deterministic guard never upgrades authority.

Automatic processing adds orchestration only. It does not change capture-v1, importance-v2, relation-v1, promotion-v1, or confirmation-v2 decisions.

### Memory judge calibration

The two model-backed candidate judges have a separate manual calibration harness. The first baseline should use the same defaults as the normal judge path:

```powershell
node .\scripts\eval-codex-memory-judges.mjs
```

Optional comparison runs can override the Codex model or reasoning effort explicitly:

```powershell
$env:MEMORY_JUDGE_CALIBRATION_MODEL = "MODEL_ID"
$env:MEMORY_JUDGE_CALIBRATION_REASONING_EFFORT = "medium"
node .\scripts\eval-codex-memory-judges.mjs
```

Authentication defaults to the normal `CODEX_HOME` / `~/.codex`. A different authenticated source can be selected only for this evaluation:

```powershell
$env:MEMORY_JUDGE_CALIBRATION_SOURCE_CODEX_HOME = "C:\path\to\.codex"
```

The fixture contains 32 labeled cases:

- 16 `importance-v2` cases, balanced across `promote`, `ignore`, `keep_candidate`, and `needs_confirmation`;
- 16 `relation-v1` cases, balanced across `same`, `update`, `contradict`, and `unrelated`;
- English and German examples in both stages;
- transient, tentative, scope-unclear, repository-reconstructible, sensitive, and durable importance examples;
- relation scope/domain hard negatives plus at least one distractor memory in every relation case.

This harness deliberately isolates judge quality from the rest of the memory pipeline. Importance cases are sent directly through the existing isolated importance judge and strict response parser. Relation cases build the existing production relation prompt from one promoted synthetic candidate plus already-scoped active direct-user comparison memories, then use the existing isolated relation judge and strict parser. Candidate capture, branch resolution, persistence, promotion, and lifecycle mutation are covered by the separate behavioral evaluations and are not duplicated here.

The summary reports:

- importance exact accuracy and full confusion matrix;
- durable-promotion precision and recall;
- false durable promotions;
- relation exact accuracy and full confusion matrix;
- exact target-ref accuracy for related cases;
- wrong high-confidence relation/target decisions;
- invalid model outputs.

The default quality gate is intentionally asymmetric and safety-focused. It fails on any invalid output, any false durable promotion, or any wrong high-confidence relation/target result. It does **not** invent a minimum recall or exact-accuracy threshold before a real baseline has been measured. Those metrics are evidence for later calibration decisions, not a production-policy change.

A failing safety gate makes the manual runner exit non-zero. Normal PR CI never calls Codex: it exercises the fixture, strict parsers, relation prompt construction, runner orchestration, and scoring with deterministic injected judges.

The calibration runner does not write the production memory database, does not change judge prompts or promotion policy, and does not introduce background processing.

### Memory judge adversarial holdout

A separate holdout probes the judges outside the tuned calibration examples:

```powershell
node .\scripts\eval-codex-memory-judge-holdout.mjs
```

It uses separate bilingual adversarial fixtures for both importance and relation judgment. The importance output also reports whether each case is reachable through the current deterministic `capture-v1` policy. This distinction is intentional:

- `pipeline_reachable=true` means the current production candidate-capture policy could send that statement to `importance-v2`;
- `pipeline_reachable=false` means the case is judge-only distribution-shift evidence and must not be treated as a direct production-pipeline failure.

The holdout quality gate remains deliberately strict for model errors: invalid outputs, false durable promotions, high-confidence wrong importance decisions, and high-confidence wrong relation/target decisions fail the run. The capture-reachability metadata is diagnostic only and does not change those scores.

The holdout is not a target to tune against in place. A failing judge-only case should first be classified as a fixture ambiguity, a policy/lifecycle specification gap, or a genuine judge error. Production prompts or decision rules should change only when the desired product semantics are independently established.

Normal PR CI does not call Codex for this holdout either. Deterministic tests cover fixture composition, scoring, isolation from expected labels, capture-reachability reporting, and resource cleanup.

### Pipeline-reachable memory judge holdout

A second holdout isolates the distribution that the current production candidate pipeline can actually produce:

```powershell
node .\scripts\eval-codex-memory-judge-pipeline-holdout.mjs
```

This suite contains 32 separate bilingual cases:

- 16 importance cases balanced across `promote`, `ignore`, `keep_candidate`, and `needs_confirmation`;
- 16 relation cases balanced across `same`, `update`, `contradict`, and `unrelated`;
- every importance statement must be accepted by the current deterministic `capture-v1` policy with the expected candidate type;
- every relation candidate's original statement must also be accepted by `capture-v1` with the expected candidate type.

The runner executes those deterministic reachability checks before model scoring and reports them separately. Its `pipeline_gate` passes only when both capture reachability and the existing judge safety gate pass.

The real run uses the same production `importance-v2` and `relation-v1` prompts, strict parsers, isolated Codex homes, and default `codex-default` / `medium` settings as the other judge evaluations. Optional comparison overrides use:

```powershell
$env:MEMORY_JUDGE_PIPELINE_HOLDOUT_MODEL = "MODEL_ID"
$env:MEMORY_JUDGE_PIPELINE_HOLDOUT_REASONING_EFFORT = "medium"
node .\scripts\eval-codex-memory-judge-pipeline-holdout.mjs
```

A different authenticated source home can be selected with `MEMORY_JUDGE_PIPELINE_HOLDOUT_SOURCE_CODEX_HOME`.

This is a generalisation holdout, not a prompt-tuning target. After its first real provider-backed run, failures must be classified as fixture ambiguity, product-policy/lifecycle gaps, or genuine judge errors before any production change. If a production policy or prompt is changed using evidence from this suite, a fresh unseen holdout is required for the next generalisation claim.

Normal PR CI never calls Codex for this suite. It verifies fixture balance, bilingual coverage, full `capture-v1` reachability/type agreement, the distribution-drift gate, production parser use, scoring, and runner orchestration with deterministic injected judges.

### Pipeline-reachable memory judge holdout v3

After `importance-v2` clarified the bounded multi-session `keep_candidate` boundary, v3 was used once as a fresh provider-backed validation suite:

```powershell
node .\scripts\eval-codex-memory-judge-pipeline-holdout-v3.mjs
```

That first real run invalidated one fixture rather than exposing a new judge defect: `pipeline-v3-importance-promote-csv-de` expected `promote` even though its statement was explicitly bounded "bis zu seiner Ablösung". Under `importance-v2`, that is `keep_candidate` by policy. The judge returned `keep_candidate` with high confidence, while the other 31 cases matched their expectations. Because the expected label was inconsistent with the production policy, v3 is preserved as observed evidence and is not relabeled or rerun as a fresh generalisation claim.

The v3 suite is independent from the already-observed calibration, adversarial holdout, and pipeline-holdout-v2 fixtures. It contains 16 new bilingual importance cases and 16 new bilingual relation cases. Importance remains balanced 4/4/4/4, relation remains balanced 4/4/4/4, and every candidate statement must be reachable through `capture-v1` with the expected type before model scoring.

The `keep_candidate` boundary cases use new multi-session horizons such as client/data migration completion, rollout windows, and audit completion rather than reusing the v2 cutover/pilot wording. The old v2 suite remains regression evidence only.

The first real v3 run should use the default authenticated `codex-default` model with `medium` reasoning and no override. Optional later comparisons use `MEMORY_JUDGE_PIPELINE_HOLDOUT_V3_MODEL` and `MEMORY_JUDGE_PIPELINE_HOLDOUT_V3_REASONING_EFFORT`.

As with the other holdouts, normal PR CI never calls Codex. It validates balance, bilingual coverage, fresh boundary composition, 32/32 `capture-v1` reachability/type agreement, strict production parser/scorer use, and deterministic runner orchestration.

### Pipeline-reachable memory judge holdout v4

A fresh v4 suite replaces the invalidated v3 fixture set for a clean `importance-v2` generalisation check:

```powershell
node .\scripts\eval-codex-memory-judge-pipeline-holdout-v4.mjs
```

v4 contains 16 new bilingual importance cases and 16 new bilingual relation cases, again balanced 4/4/4/4. It adds an explicit fixture invariant matching `importance-v2`:

- `promote` fixtures are durable and do not contain explicit expiry/milestone language;
- `keep_candidate` fixtures are explicit multi-session statements with a bounded horizon or named milestone;
- `ignore` fixtures are one-off/current-day/single-run state;
- `needs_confirmation` fixtures remain genuinely scope-unclear or missing a referent.

All 32 source statements must be accepted by `capture-v1` with the expected candidate type before model scoring. Relation cases use new targets and distractors. The first provider-backed v4 run must use default `codex-default` / `medium` with no override and should be run exactly once before interpretation.

Normal PR CI never calls Codex for v4. It validates fixture balance, the promote-vs-bounded invariant, bilingual coverage, 32/32 `capture-v1` reachability/type agreement, production parser/scorer use, and deterministic orchestration.

### Candidate pipeline behavioral evaluation

The complete candidate path has a separate manual, provider-backed end-to-end evaluation:

```powershell
$env:MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_MODEL = "gpt-5.6-sol"
$env:MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_REASONING_EFFORT = "medium"

node .\scripts\eval-codex-memory-candidate-pipeline.mjs
```

The model override is optional. The runner uses the normal authenticated Codex home by default. When authentication lives elsewhere, point only the eval at it:

```powershell
$env:MEMORY_CANDIDATE_PIPELINE_SOURCE_CODEX_HOME = "C:\path\to\.codex"
```

Each behavioral case gets its own temporary Git repository and temporary SQLite database. Existing comparison memories are synthetic canonical `user_direct` fixtures; the candidate itself enters through the real `UserPromptSubmit` candidate-capture path. The runner then executes the real explicit pipeline in order:

```text
capture-v1
    ↓
importance-v2
    ↓
relation-v1
    ↓
promotion-v1
```

The importance and relation stages use the existing isolated Codex judge factories. Their subprocesses create fresh temporary `CODEX_HOME` directories, copy authentication only, and do not inherit hooks, config, legacy/native memory state, or the real project workspace.

The five cases cover:

- a new durable decision becoming exactly one active memory;
- a paraphrase of an existing durable memory resolving `same` and creating no duplicate Claim;
- an explicit newer replacement resolving `update`, superseding the exact prior Claim, and leaving one active current memory;
- an incompatible durable constraint without replacement semantics resolving `contradict`, keeping both Claims active, and opening one conflict without choosing a winner;
- the same fact existing only on another branch remaining invisible to relation matching, with no cross-branch lifecycle mutation.

Every case runs the pipeline a second time and requires all automatic queues to remain empty, proving exactly-once finalization at the behavioral boundary. A failed case makes the manual runner exit non-zero.

Normal PR CI does **not** call Codex. It runs the same five lifecycle expectations with deterministic injected importance/relation judges while still exercising the real candidate capture ledger, stage runners, relation evaluator, promotion policy, branch scoping, lifecycle mutations, conflict creation, and second-run idempotency.

This evaluation does not schedule the pipeline, inspect transcripts, add `SessionEnd` work, or put model calls in the normal prompt path.

### Full memory end-to-end smoke

The final lifecycle smoke runs the real hook adapter, candidate ledger, explicit pipeline CLI, confirmation command, durable-memory listing, lexical recall, update lifecycle, and conflict visibility against one temporary SQLite database:

```powershell
node .\scripts\eval-memory-end-to-end-smoke.mjs
```

The provider-backed CLI uses the frozen production policies:

```text
capture-v1
importance-v2
relation-v1
promotion-v1
confirmation-v2
```

By default it uses `codex-default` with `medium` reasoning. Optional comparison overrides are:

```powershell
$env:MEMORY_E2E_SMOKE_MODEL = "MODEL_ID"
$env:MEMORY_E2E_SMOKE_REASONING_EFFORT = "medium"
$env:MEMORY_E2E_SMOKE_SOURCE_CODEX_HOME = "C:\path\to\.codex"
```

The sequential smoke covers:

- a new durable fact being captured, promoted, listed by `memory list`, and returned by current recall;
- a one-off candidate being classified `ignore` without creating a Claim;
- a bounded multi-session candidate becoming `keep_candidate`, appearing in `memory candidates`, and becoming durable only after explicit user confirmation;
- a scope-unclear candidate becoming `needs_confirmation`, remaining visible for review, and creating no Claim;
- a paraphrase resolving `same` without a duplicate Claim;
- a correction resolving `update`, superseding the prior durable Claim, disappearing the old value from current `memory list` and recall, and exposing the replacement;
- a durable baseline plus an incompatible later constraint resolving `contradict`, keeping both Claims active and exposing one open conflict through recall;
- a final idempotency pass requiring all automatic queues to be empty, with only the intentionally unconfirmed candidate remaining in the review count.

Normal PR CI never calls Codex for this smoke. It executes the exact same sequence with deterministic injected importance-v2 and relation-v1 judges while keeping all other adapter, engine, pipeline, confirmation, listing, recall, lifecycle, and conflict code real.

After a clean provider-backed run, this smoke is regression evidence rather than a prompt-tuning target. Further judge-policy changes require fresh holdout evidence before changing the frozen policy versions.

### Explicit durable-memory prompts

Production Codex can opt into durable direct-user memory with the hook CLI flag:

```text
--explicit-memory-requests
```

When enabled, only a prompt whose first non-whitespace text matches the strict,
case-insensitive marker below is persisted:

```text
memory: <exact direct-user statement>
```

Examples:

```text
memory: The production database is Postgres.
memory: Keep Survival camera quality at 720p HIGH.
```

Without `--candidate-capture` or full prompt capture, ordinary prompts are not
persisted, even if they contain natural-language wording such as "please remember".
With `--candidate-capture`, qualifying ordinary prompts may become **pending
candidates only**; they still do not become durable Claims. The explicit-memory boundary
does not use semantic intent classification. Leading whitespace and marker case are
ignored, but `memory:` without a non-whitespace statement is not a durable-memory
request.

For an explicit `memory:` prompt, the `UserPromptSubmit` adapter:

1. stores the exact prompt as `user_direct` Evidence;
2. marks that Evidence as an explicit memory request in trusted adapter metadata;
3. asserts one fixed exact-text Claim on the current Git branch;
4. returns a terminal `UserPromptSubmit` block result so the command itself is not
   forwarded to the model.

The terminal result uses Codex's documented command-hook shape:

```json
{
  "decision": "block",
  "reason": "Memory stored for the current project and branch."
}
```

The Claim uses the same non-reinterpretation contract as the explicit commit CLI:
`kind=user_direct`, `subject=user memory`, `predicate=states`, and the Claim value
is the redacted Evidence content exactly. No lifecycle relation is inferred
automatically.

Capture or Claim failure remains fail-soft for the Codex process, but the explicit
memory command is still consumed and reports that memory was not changed. Ordinary
non-command prompts keep the existing bounded recall path.

#### List active durable memories

The read-only management prompt

```text
memory list
```

returns the active durable `user_direct` memories for the current Git project and
branch in the terminal hook `reason`. The command is consumed with
`decision: "block"`, so Codex does not reinterpret `memory list` as a normal task.
It does not capture Evidence, assert Claims, mutate lifecycle state, or fall back to
semantic intent detection.

Only Claims with the fixed durable-user shape are listed:

```text
kind      = user_direct
subject   = user memory
predicate = states
state     = active
```

The paired Evidence must also be `user_direct`. Superseded/rejected history,
other branches, other projects, and non-user-direct Claims are excluded. The injected
list is bounded by the normal Codex hook context budget.

Each listed memory includes a stable opaque short reference derived from its Claim ID:

```text
- @7fa31c9e42 memory: database is Postgres
```

The reference is a 10-hex-character SHA-256 prefix and does not expose the underlying
session/turn Claim ID. It is stable for the lifetime of that Claim. Reference resolution
is limited to active durable user memories in the current Git project and branch, and
requires exactly one match; zero matches or a collision fail closed.

#### Explain a recall decision

The read-only diagnostic command

```text
memory explain: <query>
```

runs the same current-project/current-branch retrieval path used by normal Codex recall
and consumes the command with `decision: "block"`. It does not capture Evidence or
assert a Claim.

The diagnostic reports, for the bounded top candidates:

- final retrieval rank;
- lexical rank when present;
- semantic rank and similarity when present;
- RRF score when hybrid fusion ran;
- lexical fallback reason when semantic query embedding was unavailable;
- source authority class;
- whether the existing `answer` reliance policy selected or blocked the candidate.

Example shape:

```text
Recall diagnostics for the current project and branch:
Mode: hybrid
Fallback: none
- @7fa31c9e42 | final #1 | lexical #2 | semantic #1 (0.9123) | RRF 0.032522 | answer: selected | authority: user_direct | memory: database is Postgres
```

The diagnostic API lives in the retrieval/Codex adapter layer. It does not add an
operation to frozen `memory.protocol.v1`, and normal recall keeps the same result
shape and bounded context contract.

#### Forget an active durable memory

A current durable memory can be explicitly removed from current recall with:

```text
memory forget: <exact stored memory value>
```

The target can be either the exact durable `memory:` value or the stable reference
shown by `memory list`:

```text
memory forget: memory: database is Postgres
memory forget: @7fa31c9e42
```

The adapter matches by exact value among active Claims in the current Git project and
branch. Forget proceeds only when exactly one target matches. Zero matches or multiple
matches fail closed for lifecycle mutation and return a terminal no-change result.

The forget request is stored as direct-user Evidence. Its lifecycle source Claim is a
non-current control Claim:

```text
kind      = memory_control
subject   = user memory
predicate = forgets
state     = expired
value     = exact forgotten memory value
```

That control Claim rejects the target Claim through the existing lifecycle transaction.
The forgotten Claim becomes `rejected` and disappears from current recall; historical
recall can still recover both the rejected Claim and the Evidence that caused the
transition. No Evidence rows or historical Claims are physically deleted.

#### Explicit supersession

An existing durable memory can be replaced without semantic or embedding-based target
selection:

```text
memory replace: <exact old stored value> => <exact new durable value>
```

The replacement value must be a valid `memory:` value. The old target can be either
its exact stored value or the stable reference shown by `memory list`:

```text
memory replace: memory: database is SQLite => memory: database is Postgres
memory replace: @7fa31c9e42 => memory: database is Postgres
```

Reference targeting is deterministic only; no lexical, embedding, or LLM similarity is
used to choose a lifecycle target.

The adapter matches the old value by exact equality among active Claims in the current
Git project and branch. Replacement proceeds only when exactly one target matches.
Zero matches or multiple matches fail closed for mutation and return a terminal
no-change result.

The replacement Evidence stores the exact user prompt. The new Claim value is the exact
syntactic payload after `=>`; it is not semantically rewritten. The protocol
authorizer independently verifies the parsed old/new values, target Claim identity,
active state, project, and branch before allowing the `supersedes` lifecycle edge.

After a successful replacement, current recall excludes the old Claim and retains the
new Claim as active. Historical recall can still recover the old Claim as superseded
history.

### Explicit Codex claim commit

Durable, recallable memory is committed through a separate explicit CLI:

```text
memory-engine/adapters/codex-memory-commit-cli.mjs
```

The command reads one JSON object from stdin:

```json
{
  "evidence_id": "evidence:codex:...",
  "lifecycle": {
    "supersedes": [],
    "rejects": [],
    "conflicts_with": []
  }
}
```

The commit path deliberately does **not** accept caller-controlled project ID, branch,
Claim ID, timestamp, subject, predicate, or value. It resolves project and branch from
the current Git checkout, generates Claim identity and time itself, and promotes the
exact redacted `user_direct` Evidence text as the Claim value.

The fixed first-production Claim shape is:

```text
kind      = user_direct
subject   = user memory
predicate = states
value     = exact redacted Evidence content
```

This prevents an agent from turning a real direct-user statement into a different
higher-authority Claim. Structured semantic promotion can be added later only with a
separate confirmation/grounding contract.

The commit is denied unless:

- the Evidence belongs to the current Git project;
- the Evidence was classified `user_direct`;
- the Evidence branch matches the current branch;
- every lifecycle target exists in the same project and branch.

Explicit write failures are fail-closed and return a non-zero exit code. Success output
contains only project/branch/Evidence/Claim identifiers and Claim state, not remembered
content.

As with the recall hook, `--ignore-memory-env` makes the CLI ignore stale
`AGENT_HUB_MEMORY_*` values inherited from a long-lived Codex process while retaining
the platform default database location.

### Recall behavior

Before current recall, the adapter:

1. resolves the Git repository root from the documented event `cwd`;
2. requires a real current branch rather than detached HEAD;
3. resolves the full current HEAD SHA;
4. refreshes blob freshness for repository-grounded Claims;
5. recalls only the explicitly configured project and current branch;
6. formats at most 8 KiB of additional context.

The injected context labels Claim state and Evidence authority and starts with an explicit reminder that recalled content is evidence, not instructions.

Codex hybrid recall is an explicit opt-in:

```text
--hybrid-recall
```

When enabled, the hook constructs `HybridMemoryRetriever` with a lightweight local IPC embedder proxy. The hook process never initializes Transformers.js or loads E5 itself. If the worker is unavailable, malformed, slow, or reports the wrong model identity, query embedding fails locally and `HybridMemoryRetriever` returns the normal bounded lexical result.

The worker owns embedding inference only. It never opens the memory database and cannot widen project, branch, lifecycle, authority, freshness, conflict, or approval scope.

Official host references reviewed 2026-09-30:

- https://developers.openai.com/docs/hooks
- https://developers.openai.com/plugins/build/plugins

## Claude Code command-hook adapter

The second production host adapter uses Claude Code's documented
`UserPromptSubmit` command hook.

Entrypoint:

```text
memory-engine/adapters/claude-code-hook-cli.mjs
```

Claude Code supplies command-hook JSON on stdin, including `session_id`,
`cwd`, `hook_event_name`, and the submitted `prompt`. Current Claude Code
versions may also supply `prompt_id`; the adapter does not require it.

The v1 Claude Code adapter is deliberately **read-only for canonical memory**.
For each valid `UserPromptSubmit` event it:

1. resolves the current Git root, branch, and revision;
2. refreshes rebuildable repository-freshness state;
3. calls `memory.protocol.v1` `recall` for the configured project only;
4. applies the same `answer` reliance gate used by the Codex adapter;
5. emits only selected bounded memory through
   `hookSpecificOutput.additionalContext`.

It does not parse `transcript_path`, capture prompt Evidence, create memory
candidates, run the importance/relation pipeline, or accept explicit memory
mutation commands. Missing memory, an unknown project, Git failure, a restore
lock, recall failure, or an empty reliance-selected result returns no output
and does not block the prompt.

The adapter uses the same shared database environment as Codex:

```text
AGENT_HUB_MEMORY_DB=/absolute/shared/memory.sqlite3
AGENT_HUB_MEMORY_PROJECT_ID=project-a
AGENT_HUB_MEMORY_REPO_IDENTITY=github.com/example/project
```

All three variables are optional. Without `AGENT_HUB_MEMORY_DB`, the adapter
uses the same platform default as Codex. Without an explicit project or
repository identity, it derives the canonical project identity from the
checkout's Git `origin`. The `--ignore-memory-env` flag ignores stale
`AGENT_HUB_MEMORY_*` overrides and uses that default database plus Git-derived
scope.

The adapter never creates a missing database or project. This keeps its first
host integration read-only and ensures Claude Code cannot silently establish a
new canonical scope.

### Claude Code hook registration

Claude Code supports command hooks in user, project, managed, and plugin hook
configuration. A minimal project-level `.claude/settings.json` registration is:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/agent-hub/memory-engine/adapters/claude-code-hook-cli.mjs --ignore-memory-env",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

On Windows, use the corresponding escaped absolute path, for example:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:\\absolute\\path\\to\\agent-hub\\memory-engine\\adapters\\claude-code-hook-cli.mjs --ignore-memory-env",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Claude Code documents `UserPromptSubmit` as a synchronous per-prompt hook:
plain stdout or `hookSpecificOutput.additionalContext` is injected into the
model context. This adapter uses the structured JSON form only.

The first Claude Code adapter intentionally uses protocol-backed lexical recall
only. Hybrid E5 recall, candidate capture, and explicit memory-management
commands remain follow-up work after this read-only boundary is proven in a
real Claude Code session.

## Pinned E5 provider

### Warm local embedding worker

Codex command hooks are short-lived processes, so production hybrid recall keeps the pinned E5 runtime in a separate local worker rather than loading the model for every prompt.

Install the scoped provider dependency:


```bash
npm ci --prefix memory-engine
```

Populate the exact pinned model cache explicitly:

```bash
node scripts/prepare-memory-embedding-model.mjs \
  --cache-dir .cache/memory-engine/e5
```

That preparation command is the only repository path that enables remote model loading. It resolves the cache directory, downloads the exact model/revision through the provider, and succeeds only after a 384-dimensional readiness embedding is produced.

The worker can be started manually from the same prepared cache:

```bash
node memory-engine/embedding-worker-cli.mjs \
  --cache-dir .cache/memory-engine/e5
```

For normal Codex use, prefer the idempotent launcher through the asynchronous `SessionStart` hook shown above:

```bash
node memory-engine/embedding-worker-launcher.mjs \
  --cache-dir .cache/memory-engine/e5
```

The launcher detaches the worker, waits for readiness in the background, and uses a start lock to prevent duplicate E5 cold starts across concurrent sessions. It is safe to invoke repeatedly.

The worker opens the pinned provider with remote loading disabled, performs a readiness embedding before it reports `ready`, and listens only on a local IPC endpoint:

- Windows: `\\\\.\\pipe\\agent-hub-memory-embedding-v1`
- Unix: a user-scoped socket below `XDG_RUNTIME_DIR` or the OS temporary directory

Then add `--hybrid-recall` to the Codex hook command. A production command that also uses the explicit memory controls can therefore be:

```text
node .../memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall --candidate-capture --auto-pipeline
```

If the worker is not running, Codex continues with lexical recall. There is no implicit model startup or download from the prompt hook.

Successful active Claim assertion triggers best-effort semantic indexing after the canonical transaction commits. Embedding failure never rolls back the Claim. To repair missing or stale semantic rows after worker downtime, run the explicit reindex command while the worker is available:

```bash
node scripts/reindex-memory-semantic.mjs \
  --db-path /absolute/path/to/memory.sqlite3 \
  --project-id github.com/example/project \
  --branch main
```

The repair command probes the worker once, then reindexes canonical Claim documents one at a time. Semantic vectors remain derived state.

Normal runtime reuses the same cache with remote loading disabled:

```js
import { createE5Embedder } from './memory-engine/e5-embedder.mjs';

const embedder = await createE5Embedder({
  cacheDir: '.cache/memory-engine/e5',
});
```

Normal provider creation passes `local_files_only: true`. A missing or incomplete cache therefore fails provider initialization instead of silently downloading model files. The surrounding `HybridMemoryRetriever` can still operate in lexical fallback mode when no semantic provider is available.

Model files live below the repository's ignored `.cache/` tree and are not committed.

### Real semantic evaluation

The manual `Memory semantic eval` workflow installs the scoped provider dependency, restores or prepares the exact pinned model cache, then runs `tests/memory-engine/e5-semantic-eval.test.mjs` with normal provider creation (`local_files_only: true`).

Measured against the pinned `intfloat/multilingual-e5-small` revision `6a0d452a575215f80b8f66276dd4ee5d504942c6`:

| Query | Target | Lexical rank | Semantic rank | Fused rank |
| --- | --- | ---: | ---: | ---: |
| Which database was selected because concurrent writers are required? | Postgres | 1 | 1 | 1 |
| Which storage engine did we choose to handle multiple processes writing at once? | Postgres | — | 1 | 1 |
| Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt? | Postgres | — | 1 | 1 |
| For how long do we preserve security event records? | 30-day audit retention | — | 1 | 1 |

Every evaluated hybrid result remains within the core limits of at most 10 items and 16 KiB serialized output.

The manual evaluation also emits a machine-readable recall-quality summary over
positive and negative queries, including domain-near hard negatives with lexical overlap.
The summary measures lexical, semantic, and fused:

- hit rate at 1, 5, and 10;
- false-negative rate at 1, 5, and 10;
- mean reciprocal rank;
- negative-query non-empty rate;
- relevant semantic similarity distribution;
- negative-query top-1 semantic similarity distribution.

It also reports a finer semantic threshold sweep at top 5 around the observed decision
boundary, plus per-case top-1/top-2 similarity margin and the target's margin over the
best irrelevant candidate. The sweep includes query-level precision, recall, F1,
positive hit rate, and negative suppression rate. These numbers are measurement evidence
only. Production recall does not apply a semantic cutoff until a separate change chooses
and justifies one from measured data.

The provider uses the measured qint8 ONNX graph on CPU while preserving 384-dimensional Float32 normalized embedding output. ANN/vector database, GPU requirements, and learned reranking remain outside this delivery.

### Codex memory behavioral evaluation

The production reliance contract is covered by a separate manual end-to-end runner:

```powershell
$env:MEMORY_E5_MODEL_CACHE = (Resolve-Path .\.cache\memory-engine\e5).Path
$env:MEMORY_BEHAVIORAL_MODEL = "gpt-5.6-sol"

node .\scripts\eval-codex-memory-behavior.mjs
```

The runner creates an ephemeral SQLite memory store containing only this synthetic direct-user memory:

```text
memory: widget telemetry for compliance audits is retained for 37 days
```

It then rebuilds the real pinned E5 semantic index, routes every case through the real Codex memory hook adapter, and sends the exact resulting `additionalContext` to `codex exec --ephemeral`.

The four behavioral cases are:

- exact compliance-audit question -> supported, `37 days`;
- paraphrased compliance question -> supported, `37 days`;
- performance-debugging retention -> unsupported, null answer;
- product-analytics retention -> unsupported, null answer.

The Codex subprocess is deliberately isolated from existing local Codex state. The runner creates a fresh temporary `CODEX_HOME`, copies only `auth.json` from the authenticated source Codex home, and does not inherit `config.toml`, hooks, Codex memory databases, rollout/session state, or `AGENT_HUB_MEMORY_*` overrides. The temporary workspace contains no project policy or memory fixture beyond the injected Agent Hub context.

If the authenticated Codex home is not the normal `CODEX_HOME` / `~/.codex`, point the runner at it with `MEMORY_BEHAVIORAL_SOURCE_CODEX_HOME`. The runner refuses to fall back to the full existing Codex home when `auth.json` is unavailable because doing so would make the result vulnerable to legacy-memory contamination.

The runner emits one `codex_memory_behavioral_case` JSON record per case and a final `codex_memory_behavioral_summary`. A failing case exits non-zero. This remains a manual/provider-backed evaluation so normal PR CI does not spend Codex usage or download E5 model files. Ordinary CI tests the fixture, scoring, parser, isolation rules, and orchestration with deterministic fakes.

### Codex state isolation audit

Before changing normal Codex startup or deleting legacy state, inspect the active Codex home with:

```powershell
node .\scripts\audit-codex-state.mjs
```

The command uses `CODEX_HOME` when it is set and otherwise inspects the normal user `.codex` directory. A different location can be supplied explicitly:

```powershell
node .\scripts\audit-codex-state.mjs --codex-home C:\path\to\.codex
```

The audit is intentionally metadata-only. It lists top-level file and directory names, classifies known state surfaces, and reads only the structure of `hooks.json` to determine whether the Agent Hub `UserPromptSubmit` adapter and its required flags are configured. It does not open Codex memory, state, thread-history, or session databases and does not emit raw hook commands.

The report distinguishes:

- `direct_memory`: known memory database/directory naming patterns;
- `conversation_state`: thread/session/history/rollout surfaces;
- `persistent_runtime_state`: other known persistent Codex runtime databases;
- `instruction_surface`: global instruction, skill, rule, or prompt locations;
- `runtime_config`, `hooks`, and `auth`;
- unknown top-level surfaces.

Conversation/session state is reported separately and is **not** automatically labeled direct-memory contamination. The audit only treats explicitly memory-named surfaces as direct legacy memory risk. Its purpose is to decide whether a follow-up normal-runtime isolation change is justified, not to delete or migrate anything.

### Native Codex memory isolation

When a real state audit confirms that Agent Hub is active while native Codex durable memory is also present, isolate only the native memory feature rather than replacing the full `CODEX_HOME`.

Preview the exact change first:

```powershell
node .\scripts\isolate-native-codex-memory.mjs
```

The default mode is dry-run. It reads `config.toml`, reports the current and planned memory settings, and does not write anything.

After reviewing the dry-run, apply with:

```powershell
node .\scripts\isolate-native-codex-memory.mjs --apply
```

The command manages only:

```toml
[features]
memories = false

[memories]
use_memories = false
generate_memories = false
```

On apply it:

- creates a timestamped backup of the existing `config.toml`;
- atomically replaces only the config file;
- preserves unrelated config lines and comments;
- refuses ambiguous duplicate target sections/keys and non-boolean target values;
- verifies that the known native memory surfaces present before the change remain present afterward;
- never deletes or edits `memories/`, `memories_1.sqlite`, sessions/history, auth, hooks, skills, rules, or other Codex runtime databases.

The operation is idempotent. Once all three managed settings are `false`, later runs report no change and create no additional backup.

Restart Codex after an applied change before validating effective behavior. The retained native-memory files are historical state only; the isolation change intentionally does not erase them.

### Native Codex memory drift guard

The existing GitHub Delivery maintenance path now checks the isolation read-only whenever the Agent Hub Codex recall hook is active.

The guard requires all three managed settings to be explicitly `false`. A `true`, missing, duplicate, dotted alias, or invalid managed value is treated as drift rather than silently accepting Codex defaults.

Run the normal doctor command to inspect the state:

```powershell
node .\skills\github-delivery\scripts\github-delivery-cli.mjs doctor --json
```

The machine report includes `nativeCodexMemory`. Human-readable doctor output also shows a dedicated `Native Codex memory` section.

Expected healthy state:

```text
status: isolated
features.memories = false
memories.use_memories = false
memories.generate_memories = false
```

When drift is detected, bootstrap setup no longer reports `ready`. It returns `native_memory_drift` with guidance to run the existing isolation command, review the dry-run, apply it explicitly, and restart Codex.

The guard is read-only. It does not start a background process, change `config.toml`, delete native memory state, or add model-backed CI work. If Agent Hub recall is not installed, the check reports `not_applicable`.

### Agent Hub memory doctor

Use the operational doctor when you want one read-only answer for the complete memory path:

```powershell
node .\scripts\doctor-memory.mjs
```

The command emits one machine-readable JSON object and exits with:

- `0`: `healthy`
- `1`: `degraded`
- `2`: `broken`

The doctor checks:

- current Git project/branch/revision resolution;
- the canonical memory SQLite file using `DatabaseSync(..., { readOnly: true })`;
- `PRAGMA quick_check`, foreign keys, required schema, and WAL mode;
- project registration plus lexical FTS coverage;
- current pinned E5 embedding coverage and vector shape;
- E5 cache presence without allowing remote downloads;
- the already-running embedding worker with a health probe and a real query-vector canary;
- the Agent Hub Codex hook, required recall flags, and SessionStart launcher;
- native Codex memory isolation;
- active, stale, or malformed restore-maintenance state.

Status semantics are deliberately asymmetric:

- canonical DB corruption/missing schema, broken Git scope, missing critical Agent Hub hook controls, unsafe native-memory isolation, or a stale/malformed restore transaction -> `broken`;
- missing E5 cache, unavailable worker, missing SessionStart launcher, incomplete derived lexical/semantic state, or an active restore transaction -> `degraded`;
- healthy required state with all resilience checks passing -> `healthy`.

The doctor is strictly diagnostic. It does **not**:

- checkpoint SQLite;
- create or migrate schema;
- rebuild FTS or semantic indexes;
- launch the embedding worker;
- download an E5 model;
- modify Codex config/hooks;
- write, replace, or forget any durable memory.

Optional path overrides are available for controlled diagnostics:

```powershell
node .\scripts\doctor-memory.mjs --cwd C:\repo --db-path C:\state\memory.sqlite3 --cache-dir C:\repo\.cache\memory-engine\e5 --codex-home C:\path\.codex
```

### Durable memory backup and restore

Create a consistent backup of the live WAL-mode database with SQLite's online backup API:

```powershell
node .\scripts\backup-memory.mjs
```

By default backups are written below the canonical memory state directory in `backups/`. A backup directory contains:

```text
memory.sqlite3
manifest.json
```

The backup database is a standalone SQLite file normalized to DELETE journal mode for portability. The manifest contains only operational metadata: backup format version, timestamp, SHA-256, byte size, page count, integrity result, and row counts. It does not copy absolute source paths into the manifest.

The backup path can be overridden:

```powershell
node .\scripts\backup-memory.mjs --output-dir C:\safe\agent-hub-backups
```

Restore is validation-only by default:

```powershell
node .\scripts\restore-memory.mjs C:\safe\agent-hub-backups\agent-hub-memory-...
```

Only an explicit apply mutates the target:

```powershell
node .\scripts\restore-memory.mjs C:\safe\agent-hub-backups\agent-hub-memory-... --apply
```

Before apply, the restore validates the manifest, SHA-256, byte size, SQLite `quick_check`, foreign keys, schema, and row counts. During apply it:

- creates a restore-maintenance lock beside the canonical database;
- makes Agent Hub Codex hooks fail soft while the lock is present;
- creates a full `pre_restore` backup of the current target database;
- uses an exclusive SQLite transaction as a quiescence barrier for an in-flight writer;
- builds and validates a temporary restore candidate;
- stages the current main database and known `-wal`, `-shm`, and `-journal` sidecars;
- swaps the candidate into place;
- restores WAL mode and validates the installed database;
- rolls staged files back if the swap or post-restore validation fails.

A restore lock is acquired with exclusive file creation. If another restore is active, apply fails closed instead of running concurrently. The lock is removed in the normal success and failure paths.

For the smallest operational risk, close interactive Codex sessions before a production `--apply`. The maintenance lock prevents new Agent Hub hook entries during the restore, but it is not intended as a general process manager for unrelated software that may access the SQLite file directly.

#### Interrupted restore recovery

Every applied restore also maintains a durable journal beside the target database:

```text
memory.sqlite3.restore.lock
memory.sqlite3.restore-journal.json
```

The journal records the operation id, current phase, restore candidate, pre-restore backup, deterministic staged-file mappings, and expected row counts.

Restore phases are:

```text
preparing
candidate_ready
snapshot_ready
staging
installing
installed
verified
```

A normal success or successfully rolled-back ordinary exception removes the journal and lock. A hard process exit can leave them behind intentionally so the next operator can diagnose what happened.

The memory doctor is read-only and reports this state through `restoreRecovery`:

- no interrupted transaction -> `ok`;
- currently active restore owner -> `degraded` with `restore_in_progress`;
- stale transaction -> `broken` with `stale_restore_transaction`;
- malformed recovery metadata -> `broken` and fail-closed.

Recovery is always explicit:

```powershell
node .\scripts\restore-memory.mjs --recover
```

Recovery refuses to run while the recorded restore owner process is still alive.

For a stale transaction it chooses the conservative action from the durable phase:

- `preparing`, `candidate_ready`, `snapshot_ready`: remove the unused candidate and clear stale metadata because the target was not staged yet;
- `staging`, `installing`: restore any staged original files and remove candidate/new artifacts;
- `installed`, `verified`: validate the installed database against the journaled expected restore state; finish cleanup only when it is valid, otherwise restore the staged previous target;
- stale lock with no journal: clear it only when the current target is healthy and no unjournaled restore artifacts exist;
- ambiguous or malformed state: refuse automatic recovery.

The doctor never invokes recovery itself.

Custom target and pre-restore-backup locations are supported:

```powershell
node .\scripts\restore-memory.mjs C:\safe\backup --db-path C:\state\memory.sqlite3 --backup-root C:\safe\pre-restore --apply
```

## Hybrid retrieval core

`HybridMemoryRetriever` is an asynchronous relevance layer above `MemoryEngine`. It accepts an injected embedder with the contract:

```js
{
  modelId,
  modelRevision,
  dimensions,
  embedQuery(text),
  embedPassages(texts),
}
```

The core does not import an ML package. Tests use a deterministic fake provider; the concrete pinned E5 provider is delivered separately.

Semantic indexing uses deterministic passage text built only from already-redacted canonical memory. Vectors are stored in `claim_embeddings` as derived state together with exact model ID, model revision, text hash, dimensions, and index time.

Hybrid recall proceeds as:

```text
correctness-scoped lexical top 32
        +
correctness-scoped semantic top 32
        |
        v
deterministic RRF (k = 60)
        |
        v
correctness-safe ID materialization
        |
        v
<= 10 items and <= 16 KiB
```

Semantic similarity is relevance only. Project and branch isolation, lifecycle state, repository freshness, conflicts, reliance, and action approvals are never inferred from vectors.

If no embedder is configured or query embedding fails, hybrid recall returns the bounded lexical result instead of making canonical memory unavailable.

Semantic rebuild is explicit:

```js
import { HybridMemoryRetriever } from './memory-engine/hybrid-retrieval.mjs';

const hybrid = new HybridMemoryRetriever({
  memory,
  embedder,
});

await hybrid.rebuildSemanticIndex({
  projectId: 'project-a',
  branch: 'main',
});

const recalled = await hybrid.recall({
  projectId: 'project-a',
  branch: 'main',
  query: 'Which storage engine handles multiple processes writing at once?',
  maxItems: 10,
  maxSerializedBytes: 16_384,
});
```

## Failure recovery

Canonical writes rely on SQLite transactions in WAL mode. A partially executed ingest is not canonical memory until its transaction commits.

The M15 regression exercises two recovery paths:

- derived-state loss: `claim_fts` and repository freshness snapshots are removed, then rebuilt from canonical rows;
- hard interruption: a separate Node process begins a real SQLite write transaction, inserts the first partial Evidence row, signals the write barrier, and is terminated with `SIGKILL` before commit.

After recovery:

- previously committed current memory remains available;
- superseded history remains available;
- source provenance remains intact;
- the interrupted Evidence row is absent from canonical export;
- no interrupted Claim is present;
- interrupted content cannot surface as trusted recall.

Recovery does not promote WAL fragments or partial writes. It checkpoints surviving committed SQLite state and regenerates derived indexes from canonical truth.

## Bounded recall

The Memory Ratchet M14 regression ingests 2,000 unrelated distractor memories plus the database decision history and requests at most 10 recalled items.

The existing FTS5 retrieval still satisfies the frozen ratchet:

- the target Postgres decision appears in the top five under 2,000 distractors;
- no more than 10 current items are returned;
- the serialized raw recall payload stays within 16 KiB.

A separate deterministic fake-embedder regression now verifies the hybrid layer without changing the frozen Ratchet fixture. It covers lexical-light English and German paraphrases, requires the Postgres decision in the top five, and enforces the same <=10 item / <=16 KiB output limits.

RRF does not replace FTS5. Lexical retrieval remains the deterministic exact-term path, while semantic ranking contributes relevance candidates when an embedder is available.

## Verification

Foundation tests run under Node 24:

```text
node --test tests/memory-engine/*.test.mjs
```

The suite includes direct engine invariants plus Memory Ratchet fixture coverage for:

- M01 cross-harness current truth;
- M02 long-gap cross-session continuity after 27 unrelated sessions;
- M03 project isolation;
- M04 branch isolation;
- M05 Git blob freshness;
- M06 explicit supersession/history;
- M07 contradiction handling;
- M08 provenance;
- M09 rejection/history;
- M10 source-authority / poisoning resistance;
- M11 pre-storage secret redaction;
- M12 structured action trust boundary;
- M13 portable export and rebuild;
- M14 bounded recall under 2,000 distractors;
- M15 interrupted-write and derived-state recovery;
- deterministic hybrid fusion, semantic scope isolation, lexical fallback, and bounded paraphrase recall with an injected fake embedder.

The reference engine now has explicit regression coverage for every Memory Ratchet case M01-M15 plus the hybrid retrieval core. The separate manual `Memory semantic eval` workflow provides real pinned-model coverage for the E5 provider while ordinary CI keeps the model download-free.
