# Provider selection (staged rollout)

`design-with-ai` routes and quality profiles retain their existing meaning. Provider selection is an internal, explicit mechanism. Availability never authorizes invocation of an unrelated tool.

| Profile | Initial provider selection | Intended later extension |
| --- | --- | --- |
| quick | Existing DWA native source gate | No mandatory external browser |
| standard | Existing DWA gates and rendered evidence where available | Optional Impeccable source checks and taste browser evidence |
| deep | Existing DWA gates and project/visual review | Optional Impeccable detector and Taste Skill 2.5 consistency browser checks |

**Current state:** `native-dwa` and `impeccable` provide explicit static checks. `taste-skill` provides an explicit rendered-audit pilot when its compatible Node 22+ skill and Chrome are already installed. `scripts/providers/scan.mjs` selects a provider; it does not auto-install any runtime. Ordinary DWA workflow selection and completion gates remain unchanged. All modifying UI work continues to require existing source/render proof and human-contextual judgments.

`runProviders()` receives explicit lists of `required` and `optional` provider IDs. The caller must inspect every returned status. A missing required capability means `BLOCKED`, not `PASS`. An optional unavailable capability is `UNAVAILABLE` and must be recorded where it would otherwise be expected evidence. A returned `PASS` does not establish successful product UX, correct rendered behavior, or a completed iteration.

Do not auto-enable any Impeccable live mode. Any future live feature requires a separate explicit-user-request and trust-boundary design and must not enter ordinary `standard` or `deep` gates.

## Phase 5 profile execution

The normal DWA non-motion Gate now has an explicit profile-aware CLI: `scripts/providers/quality-audit.mjs`. Quick runs native only. Standard/deep run native plus the optional vendored static Impeccable detector unless `--no-impeccable` is set. The Taste Skill browser is **never started implicitly**; require explicit `--with-taste` and the compatible installed runtime, or `--require-taste` to make missing browser evidence a blocker. The original source/render receipts and iteration gate are unchanged. See `references/provider-quality-rollout.md` for the tested command, report paths and rollback. This supersedes the earlier “planned only” selection state below; the sidecar remains explicitly opt-in.

## Phase 4 evidence fusion

Manual, explicit provider reports can now be correlated with `scripts/providers/fuse.mjs` and retained in an append-only schema-v2 sidecar. This does **not** change ordinary provider selection or the existing source/render `taste-evidence-fusion.mjs` gate. Missing selected optional results remain explicitly `INCOMPLETE`, and no fusion result grants product completion. See `references/provider-fusion-journal.md`.

**Review correction:** Source findings are currently **not** deduplicated across DWA and Impeccable. Similar palette, type and motion signals remain separate review leads. The old experimental G05/nested-cards mapping was removed because DWA's G05 is not emitted by the source scanner. Local output scope for the optional Taste browser is now an isolated build subtree, never the full source repository.
