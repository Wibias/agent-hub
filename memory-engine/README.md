# Memory Engine

Portable reference implementation derived from Memory Ratchet 0.1.0 research.

This directory is implementation code. It is intentionally separate from the hub's `memory/` directory, which remains reserved for episodic lessons.

## Runtime

Node.js 24 or newer is required.

The foundation uses Node's built-in `node:sqlite` module so the hub does not need a native npm dependency or a platform-specific SQLite package.

## Foundation scope

This first implementation owns:

- canonical SQLite storage in WAL mode;
- stable project registration;
- append-only evidence records;
- deterministic claim lifecycle for `supersede` and `reject`;
- strict project and branch filtering before lexical ranking;
- current versus historical recall;
- durable provenance fields;
- mandatory secret redaction before canonical storage or indexing;
- Git path/blob freshness checks for repository-grounded evidence;
- a rebuildable FTS5 lexical index.

Not implemented in this foundation:

- conflict/authority resolution;
- reliance policy for answers versus actions;
- structured approval capabilities;
- local embeddings or RRF;
- export/rebuild and interrupted-write recovery.

Those belong in follow-up changes so the foundation remains independently auditable.

## Canonical versus derived state

Canonical state:

- `project_registry`
- `evidence`
- `claims`
- `lifecycle_events`

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

At this foundation stage it derives only observable source kinds such as `repository`, `session`, `tool`, or `agent`, and stores:

```text
authority_class = unclassified
```

Authority classification and reliance policy are deferred to the dedicated follow-up layer. This prevents benchmark-only labels from silently making the reference implementation smarter than a real harness integration.

Project identity is likewise stable and path-independent. Temporary checkout paths are not used as canonical repository identity.

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
import { MemoryEngine } from './memory-engine/index.mjs';

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

memory.close();
```

## Verification

Foundation tests run under Node 24:

```text
node --test tests/memory-engine/*.test.mjs
```

The suite includes direct engine invariants plus unchanged Memory Ratchet fixture coverage for:

- M01 cross-harness current truth;
- M03 project isolation;
- M04 branch isolation;
- M06 explicit supersession/history;
- M08 provenance;
- M09 rejection/history;
- M11 pre-storage secret redaction.

The suite also covers M05 Git blob freshness. The remaining hard gates are deliberately deferred until the corresponding architecture exists rather than being approximated inside the adapter.
