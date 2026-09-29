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
- append-only evidence records;
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
- a rebuildable FTS5 lexical index.

Not implemented yet:

- local embeddings or RRF;
- export/rebuild and interrupted-write recovery.

Those belong in follow-up changes so each correctness layer remains independently auditable.

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

Derived state is never the source of truth. Claim lifecycle, observed repository blob identity, and provenance remain valid even if freshness snapshots or search indexes are rebuilt later.

`repository_path_state` is a rebuildable snapshot of the repository revision being queried. It stores the current commit and path object ID used to decide whether path-grounded evidence is still eligible for current recall. Portable export must not treat this snapshot as durable memory truth.

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

Evidence is inserted once and is not rewritten to hide later history. A lifecycle transition updates claim state instead:

```text
active -> superseded
active -> rejected
```

Historical recall can still return those claims with their state.

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

## Verification

Foundation tests run under Node 24:

```text
node --test tests/memory-engine/*.test.mjs
```

The suite includes direct engine invariants plus Memory Ratchet fixture coverage for:

- M01 cross-harness current truth;
- M03 project isolation;
- M04 branch isolation;
- M05 Git blob freshness;
- M06 explicit supersession/history;
- M07 contradiction handling;
- M08 provenance;
- M09 rejection/history;
- M10 source-authority / poisoning resistance;
- M11 pre-storage secret redaction;
- M12 structured action trust boundary.

M13-M15 recovery/bounded-recall work remains deliberately deferred until the corresponding architecture exists rather than being approximated inside the adapter.
