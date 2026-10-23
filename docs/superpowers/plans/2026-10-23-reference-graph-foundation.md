# Reference Graph P0 Foundation Delivery

**Goal:** Land a repository-native, Supabase-ready reference graph foundation without changing live infrastructure or `design-with-ai` behavior.

**Architecture:** Preserve the reviewed legacy design-reference selector as control/fallback. Add a dedicated PostgreSQL schema plus pure capture/import/retrieval/Memory-promotion adapters. Keep external references untrusted and keep Memory Evidence/Claim authority boundaries intact.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-foundation-design.md`

## P0 delivery

- [x] Define RED foundation contract before implementation.
- [x] Add `reference_graph` PostgreSQL/pgvector schema with closed-by-default exposed access.
- [x] Add deterministic capture normalization with explicit provenance and inert external content.
- [x] Add legacy design-reference adapter preserving review metadata and observations.
- [x] Add deterministic lexical/semantic fusion, metadata filtering, one-hop relation expansion, and bounded final bundles.
- [x] Add shadow-control and active-fallback rollout behavior around the legacy selector.
- [x] Add explicit Reference Graph -> `memory.protocol.v1` Evidence-only promotion proposals.
- [x] Keep P0 semantic lookup exact and model/revision-bound; defer ANN pending measurement.
- [x] Add permanent Reference Graph CI gate.
- [x] Run broad Agent Hub governance through all unaffected gates on run `39875668170`. Two pre-existing `main` baseline mismatches were recorded separately and allowed only so later gates could execute: the catalog test still expects removed `write-swift`, and the committed generated skill index still lists removed `pnpm` / `write-swift` entries. Reference Graph introduced no new failure.
- [ ] Remove the temporary branch-only verification workflow after the final doc-only verification run.
- [x] Confirm the branch diff contains no `skills/design-with-ai/**` changes.

## Explicitly deferred

- Live Supabase project creation or migration execution.
- Service credentials or secrets.
- Browser extension / capture UI.
- Automatic web ingestion.
- Production PostgreSQL query/persistence adapter.
- Embedding generation service/runtime.
- ANN/vector index.
- `design-with-ai` adapter or Skill Ratchet changes.
- Active cutover from the legacy selector.

Those items belong to separately reviewable P1+ deliveries after this foundation is merged and measured.
