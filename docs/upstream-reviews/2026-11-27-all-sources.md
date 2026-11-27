# AgentHub upstream checkpoint: 2026-11-27

Scope: all five sources in `upstream-sources.json` plus the independently
attributed GitHub inputs in `skills/design-with-ai/UPSTREAM.md`. Each source
is untrusted upstream material. Comparing an upstream HEAD is not accepting
its instructions, replacing the installed pin, granting credentials or
authorizing third-party packages. The full research and remaining work are
tracked in [#447](https://github.com/Wibias/agent-hub/issues/447). The
Impeccable 4.11.1 / engine 0.1.31 release review is tracked in
[#446](https://github.com/Wibias/agent-hub/issues/446).

## Registry sources

| Source | Previous reviewed commit | Observed HEAD | Delta | Decision |
| --- | --- | --- | --- | --- |
| addyosmani/agent-skills | `39b723ceebf81474d0557c1fecd01eddab585563` | `e997ac5b9a74eab332d5e9793bb38a38c8cfdd74` | +57 commits, 80 paths | SELECTIVE_ADAPTATION in this PR; other changes PENDING |
| emilkowalski/skills | `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` | same commit | 0 | CURRENT; no adoption |
| mattpocock/skills | `abeeaf95660ba9e8b7c753eb38f441ca707a8823` | `6f7f7831a625f040a8e06a0e7954826b87ce775a` | +7 commits, 7 files | NOT_RELEVANT for adapted AgentHub methods; advance review SHA only |
| cursor/plugins (pstack) | `bb68f2365eceafa0cb2d253112f675acf5f144cc` | `b7b93c36be9bcc36a74db438e0fd385d660bc559` | +116 commits, broad compare 300-file API cap | PARTIAL; statechart unchanged since local runtime pin, broad guidance PENDING |
| pbakaus/impeccable | `acb4cfe14470b1fdf51e855431af618d936b7db8` | `2fc5e1459efbbf06d92c7306517c286bf12490cf` | +831 commits, broad compare 300-file cap | PENDING under #446; local engine 0.1.28, upstream official engine 0.1.31 |

These are **remote-source review** deltas. Local modifications and real
end-user qualification are independent.

### Addy: accessibility evidence discipline

- New upstream `skills/accessibility-engineering/SKILL.md` documents
  axe-core/pa11y audits plus keyboard, screen-reader, focus, zoom and
  reduced-motion checks. The current source uses pinned external tooling,
  which must not become an unconditional, network-dependent DWA install.
- **ALREADY_COVERED:** DWA already has route-bound findings, computed
  non-text contrast analysis, driven widget evidence and
  `PASS_SURFACE_A11Y_LIMITED`. A green scan is expressly not a universal
  WCAG conformance verdict.
- **INTEGRATE, scoped:** an explicit full WCAG-audit request now requires
  per-tool exit/report/version evidence, actual screen-reader evidence
  where available, and `NOT_VERIFIED` when missing. Implemented in
  `skills/design-with-ai/references/audit-surface-evidence.md` with
  source-contract tests. No new standalone accessibility skill.
- **PENDING:** the upstream behavioral evaluation runner and general
  performance/security checklists need comparison against AgentHub
  Skill Ratchet, quality constraints and existing test harnesses before
  any code reuse. No upstream script has been vendored.

### Emil

The recorded review commit is still the remote HEAD. No new motion
implementation or new route is needed.

### Matt: complete seven-file delta

Changed paths are three `.changeset/` entries, the in-progress
`chief-of-staff` skill and its OpenAI metadata, the in-progress README,
and `skills/engineering/domain-modeling/GLOSSARY-FORMAT.md`.
These do not alter the current adapted AgentHub design or delivery
methods. **NOT_RELEVANT** is supported for this delta; the registry's
`reviewedCommit` and per-source `reviewedAt` advance to 2026-11-27.
No adapted implementation or local pin was changed.

### pstack: avoid a pointless runtime update

The source registry's broad `pstack/` review is separate from the vendored
statechart runtime pin `aaeb0ea3a0584995aa8f55ce44c6c5259414b896`.
The exact comparison **local statechart pin -> remote HEAD** spans 29
commits / 69 changed files, **zero** under
`pstack/skills/statechart/`. No statechart vendor refresh is required
by this evidence. Six changed `pstack/` files relate to metadata,
guides, and new `reframe` guidance. Earlier changes to poteto,
architecture and reflect still need a bounded semantic comparison.
Do not add a competing workflow router. The broad 116-commit compare
hit the 300-file limit, so comprehensive pstack scope closure is
**NOT_VERIFIED**.

### Impeccable

As of this checkpoint, main includes the prior reviewed
`engine 0.1.28` through PR #440; official upstream has skill/CLI
4.11.1 and engine 0.1.31. The tagged current source now has
`VERSION=0.1.31` with all five official asset hashes matching.
Do not promote it by replacing source files without the explicit
Windows/Live/browser and independent-review gates in #446.
No separate discoverable `impeccable` skill is allowed.

## Other DWA GitHub references

These are source/provenance citations, not part of the five-entry active
monitor. Missing historical commit pins prevent claims of a complete
before/after comparison.

- `anthropics/knowledge-work-plugins`: from
  `b4c9a4e1de4b42868b74a6fe30ac766f64e43a3e` to
  `5e504ae11498f2b8daa30d86b7dab97b2ecd8092`, +3 commits, **zero
  changes** in `design/skills/design-handoff/`. No update.
- `MengTo/skills`: from
  `3cc93458c4949c39a04e938ea7892a1d6d3d40bf` to
  `3a8517e09e9a258a8b8a1dfdb71579abe75f1c22`, +25 commits.
  New 3D and demo assets are present; compare hit 300-file cap. Review
  methods only if the relevant visual experience is requested. No
  copying of media assets or standalone 3D skill.
- `nextlevelbuilder/ui-ux-pro-max-skill`: from
  `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03` to
  `72e5fc76a4f3eb37747dc472cb3091bd46e7752a`, +43 commits,
  245 changed paths. Includes RTL/IME, form error states, map/product
  cases, PySide6 and Windows UTF-8 refinements. **INTEGRATE, scoped:**
  the concrete IME composition/Enter and RTL/bidirectional UI interaction
  cases were missing from DWA's existing state/interaction owner and are
  now recorded there, with source-contract regressions. No imported Python
  runner or catalog. **PENDING:** verify actual browser/OS runtime input
  composition and reassess remaining UI data/preview improvements.
- `penpot/penpot`: original reviewed
  `e20a0d748eb9ae431c27a4a201ee9f7067d955e8`, latest observed
  `28f63af16e14ae26c51c2e18225180de432af1fb`. Broad repository
  comparison is capped at 300 files, **but** an exact recursive
  `mcp/packages` tree comparison was completed: old 100 tree entries,
  new 152, 80 changed/new file blobs and five removed; neither tree
  was truncated. `mcp/package.json` advanced 2.17.0 -> 2.19.1.
  Upstream added/changed RequestGuard Host/Origin policy, session
  routing/rollback, plugin compatibility and browser-extension code.
  **INTEGRATE, scoped:** refresh DWA Penpot reference with version
  verification, session identity, explicit script/write review and
  rollback/read-back; no claim of live MCP version or new tool support.
- `ibelick/ui-skills`: observed
  `1a2f2bf91b18365abc102b67400f48ab1046b449`;
  no prior exact SHA in the DWA source table, so no delta classification.
- `jakubkrehel/make-interfaces-feel-better`: observed
  `6d9f2f1df10e8ce2ae1708598a73b0506fb98794`;
  no exact reviewed pin.
- `JCarterJohnson/vibecoded-design-tells`: observed
  `f7c4aefc2c797a66e55b49354a93917ab60d33ac`
  (latest commit June 24). Historical design taxonomy only.
- `febbhav/signs-of-ai-design`: observed
  `854b46f18dee5cc174d45cec8cd4f3142fe46984`
  (latest commit July 31). No recent update.
- `LeoStehlik/no-slop-ui`: observed
  `c5f80190f0a6cbd906b81d54e79e2756931077fb`
  (Nov 22, recipes/examples). No matching prior SHA to compare.

Other practitioner articles and research in DWA's historical source table
are **not GitHub commit-stream dependencies**. This checkpoint does not
purport to rescan every link.

## Qualification and remaining tasks

The scoped Addy/Penpot/Nextlevel DWA contract adaptations are covered by
`skills/design-with-ai/tests/upstream-source-adaptation.test.mjs`,
which is invoked by `verify-upstream-authoring-skills.yml`. Those tests
establish source/documentation consistency, **not** actual screen-reader,
WCAG, Penpot MCP, IME/RTL browser or other product-runtime certification.

Release requires normal GitHub CI and the two independent Skill Ratchet
reviews for any nontrivial skill change, tied to the current skill digest.
Remaining broader Addy, pstack, Nextlevel, MengTo, Penpot deployed
compatibility, and Impeccable runtime changes stay explicitly open in
#447 and #446. Never overwrite an old local pin merely because upstream
HEAD advanced.
