# Provider selection (staged rollout)

`design-with-ai` routes and quality profiles retain their existing meaning. Provider selection is an internal, explicit mechanism. Availability never authorizes invocation of an unrelated tool.

| Profile | Initial provider selection | Intended later extension |
| --- | --- | --- |
| quick | Existing DWA native source gate | No mandatory external browser |
| standard | Existing DWA gates and rendered evidence where available | Optional Impeccable source checks and taste browser evidence |
| deep | Existing DWA gates and project/visual review | Optional Impeccable detector and taste-skill lint/inspect/draw |

**Current state:** `native-dwa` is the only registered implementation in this initial foundation PR. The registry does not enable providers by itself. Integration into workflow execution and external provider discovery belong to subsequent PRs. All modifying UI work continues to require existing source/render proof and human-contextual judgments.

`runProviders()` receives explicit lists of `required` and `optional` provider IDs. The caller must inspect every returned status. A missing required capability means `BLOCKED`, not `PASS`. An optional unavailable capability is `UNAVAILABLE` and must be recorded where it would otherwise be expected evidence. A returned `PASS` does not establish successful product UX, correct rendered behavior, or a completed iteration.

Do not auto-enable any Impeccable live mode. Any future live feature requires a separate explicit-user-request and trust-boundary design and must not enter ordinary `standard` or `deep` gates.
