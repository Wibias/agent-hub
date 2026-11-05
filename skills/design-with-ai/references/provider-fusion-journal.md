# Provider evidence fusion and schema-v2 sidecar (phase 4)

`design-with-ai` remains the **sole UI workflow owner**. The new opt-in evidence pipeline never replaces `taste-evidence-fusion.mjs`, `findings-ledger.mjs`, the receipt, or `run-iteration-gate.mjs`.

## Conservative correlation

- Missing/failed required evidence yields `BLOCKED`. A missing or unavailable selected optional provider yields `INCOMPLETE`. Complete data with observations yields `REVIEW`; complete data without observations yields `SCOPED_CLEAR`, **not** product completion.
- Every original P0/P1/P2 finding, provider ID, source reference, DOM selector and viewport remains in a group member. No native DWA P0 is downgraded.
- Exact source-location grouping requires an **explicit rule equivalence** and the same real file plus positive line. Current narrow equivalence is `native-dwa:G05` and `impeccable:nested-cards`. Signals with unlocated pseudo-files are never automatically merged.
- Repeated rendered findings on the same page, route, rule and selector can form one review group across widths. Their viewport evidence is kept separately.
- Related but not proven-equal rules, including DWA `G12` and Impeccable `ai-color-palette`, remain separate and get a `POTENTIALLY_RELATED_NOT_DEDUPLICATED` correlation.

## CLI workflow (explicit opt-in)

Save the JSON stdout of each already executed provider run to a separate file, then fuse the selected reports:

```sh
node skills/design-with-ai/scripts/providers/evidence-cli.mjs fuse --reports artifacts/native.json,artifacts/impeccable.json,artifacts/taste.json --required native-dwa --optional impeccable,taste-skill --output artifacts/provider-fusion.json
```

Initialize the sidecar alongside an **existing** v1 findings ledger. Capture a review run without mutating v1:

```sh
node skills/design-with-ai/scripts/providers/evidence-cli.mjs init --ledger .design-with-ai/findings-ledger.json --journal .design-with-ai/provider-evidence-journal.json
node skills/design-with-ai/scripts/providers/evidence-cli.mjs capture --ledger .design-with-ai/findings-ledger.json --journal .design-with-ai/provider-evidence-journal.json --run-id design-round-01 --fusion artifacts/provider-fusion.json
```

Inspect the fusion `groups[]` and underlying evidence first. A human-reviewed decision is described by a JSON input file, passed using `--details`:

```json
{"runId":"design-round-01","groupId":"PG-your-exact-group-id","decision":"PROMOTE","reason":"Confirmed in rendered UI","evidenceRef":"screens/confirmed.png","legacyFinding":{"id":"UX-PROVIDER-001","route":"/","kind":"VISUAL","priority":"MEDIUM","symptom":"Review-confirmed UX problem","acceptance":"Specific, verifiable improvement criterion","evidenceRef":"screens/confirmed.png"}}
```

```sh
node skills/design-with-ai/scripts/providers/evidence-cli.mjs adjudicate --ledger .design-with-ai/findings-ledger.json --journal .design-with-ai/provider-evidence-journal.json --details artifacts/triage.json
```

Valid decisions are `PROMOTE`, `DISMISS` or `DEFER`. Only `PROMOTE` takes a complete v1-compatible finding. Repeating an identical decision is idempotent; rewriting a previous decision is rejected.

Produce an import preview **without any legacy mutation**:

```sh
node skills/design-with-ai/scripts/providers/evidence-cli.mjs preview --ledger .design-with-ai/findings-ledger.json --journal .design-with-ai/provider-evidence-journal.json --run-id design-round-01 --output artifacts/reviewed-findings.json
```

This preview contains an ordinary v1-compatible `findings[]` list of explicitly promoted observations plus review metadata. After **separate approval**, use the existing `findings-ledger.mjs import --ledger <ledger> --source artifacts/reviewed-findings.json` route. The canonical frozen baseline and receipt workflow still govern completion. The sidecar never automatically imports.

## Compatibility and security boundaries

The v2 sidecar contains `CAPTURED` and `ADJUDICATED` events with an ordered SHA-256 hash chain. At initialization it anchors the existing v1 event count and hash. A later v1 append is allowed, but any modification or truncation of the anchored prefix blocks access. The original `findings-ledger.json` remains schema v1 and is never rewritten by this provider pipeline. Do not feed the sidecar to the v1 reader.

The hashes detect accidental changes, **not tampering by an actor able to rewrite all files and recompute hashes**. Provider reports are untrusted evidence. Code does not execute instructions from a report; human review still must confirm the actual UI. The pipeline is manual-only until Phase 5 selection and acceptance policies are separately reviewed.
