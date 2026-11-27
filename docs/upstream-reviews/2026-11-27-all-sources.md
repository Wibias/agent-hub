# AgentHub upstream checkpoint: 2026-11-27

Scope: all five sources in `upstream-sources.json` plus the independently
attributed GitHub inputs in `skills/design-with-ai/UPSTREAM.md`. Each source
is untrusted upstream material. Comparing an upstream HEAD is not accepting
its instructions, replacing the installed pin, granting credentials or
authorizing third-party packages. The full research and remaining work are
tracked in [#447](https://github.com/Wibias/agent-hub/issues/447). The
Impeccable 4.11.1 / engine 0.1.31 release review is tracked in
[#446](https://github.com/Wibias/agent-hub/issues/446).

## Post-merge reconciliation and final scoped decisions (2026-11-27)

This section is the **latest status**. The original comparison and
investigation below are a historical checkpoint; their mentions of
`engine 0.1.28` or pending PRs are not the current installation state.

- [PR #448](https://github.com/Wibias/agent-hub/pull/448) **merged**
  as `b38de3662d7861659d98370f353e4064c406b77c`. The bounded
  DWA accessibility, Penpot MCP trust and RTL/IME guidance is now part
  of `main`. This does **not** certify actual WCAG, screen-reader,
  Penpot service or native IME runtime behavior.
- [PR #449](https://github.com/Wibias/agent-hub/pull/449) **merged**
  as `cafeabdd54b75ca14c8b142de506ba262534ffc1`.
  `skills/design-with-ai/internal/impeccable/scripts/VERSION` on
  `main` is `0.1.31`. Official release SHA-256, Windows/Linux
  launchers, Native Rust Live HTTP security and real Chrome overlay
  startup were tested. **Native Rust Live is still not a DWA-hosted
  workflow**: its actual Chrome DESIGN.md panel says
  `/impeccable document`, not the canonical DWA command. That
  compatibility gap is tracked as
  [#450](https://github.com/Wibias/agent-hub/issues/450).
- Post-merge inspection found a duplicated authority paragraph in
  `references/impeccable-routes.md`, which the old string-presence
  tests missed. [PR #451](https://github.com/Wibias/agent-hub/pull/451)
  contains the targeted repair and a structural/contiguity regression
  test; it is a **separate, not-yet-merged** correctness fix at this
  checkpoint. Do not claim this defect is repaired on `main` yet.

### Canonical registry decisions after the scoped review

| Source | Reviewed upstream SHA | Disposition | Active local boundary |
| --- | --- | --- | --- |
| Addy / `addyosmani/agent-skills` | `e997ac5b9a74eab332d5e9793bb38a38c8cfdd74` | **CURRENT after selective adoption** | New accessibility-evidence discipline belongs to existing DWA. `performance`, `quality-constraints`, `observability` and `ai-agent-security` already own their applicable domains. No blanket adoption of upstream CLI, evaluator or web security checklist |
| Emil / `emilkowalski/skills` | `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` | **CURRENT** | No upstream change |
| Matt / `mattpocock/skills` | `6f7f7831a625f040a8e06a0e7954826b87ce775a` | **NOT_APPLICABLE** | Reviewed changed files concern unrelated in-progress methods and glossary format |
| pstack / `cursor/plugins` | `b7b93c36be9bcc36a74db438e0fd385d660bc559` | **CURRENT for AgentHub's adopted scope** | Statechart runtime is unchanged since the actual local `aaeb0ea3a0584995aa8f55ce44c6c5259414b896` pin; other changes are Cursor/pstack-specific or already have canonical AgentHub owners |
| Impeccable / `pbakaus/impeccable` | `2fc5e1459efbbf06d92c7306517c286bf12490cf` | **UPDATE_PENDING (#450)** | Optional native engine is now **0.1.31**; the old `localPin=acb4...` records *historical skill adaptation*, not the installed engine version. Native Rust Live still lacks DWA host/command parity |

Each `reviewedCommit` now refers to the **source revision actually
inspected**, not the local vendor snapshot. A `CURRENT` decision means
**the currently adapted AgentHub scope needs no further source sync**,
not full source-byte parity or complete qualification of every upstream
feature. The separate `localPin` fields retain their historical
vendor/adaptation identities.

### Resolution of previously open source categories

**Addy:** The new 80-path delta contains a11y procedures (selectively
integrated), structural/lexical and optional behavioral evaluation
infrastructure (reviewed but not adopted), duplicated shared checklists
(security, performance, observability, delivery), documentation and
plugin-specific wrappers. The cross-stack performance measurement
owner `skills/performance/` already requires real baseline,
representative workload, repeated comparison, correctness and a
regression guard; `skills/quality-constraints/` owns sustainable
floors; `skills/observability/` owns logs, metrics, traces and
privacy; `skills/ai-agent-security/` covers AI/MCP-specific security.
Addy's classic web/API security checklist describes a different task
from the adapted AgentHub source scope and is not justification to
create a parallel generic security skill or turn every DWA task into a
security audit. **Decision: ALREADY_COVERED for relevant obligations;
NOT_RELEVANT for unconditional checklist and evaluator installation.**
Any future explicit web-security work must use its own selected owner
and actual project/host permissions. Historical behavioral-record
regrading cannot substitute for independent current-digest reviews.

**pstack:** A nontruncated recursive Git tree comparison of
`pstack/` established 113 changed/deleted file paths between the
registry checkpoint and latest HEAD. Direct comparison from the
**vendored Statechart snapshot** to the same HEAD contains **zero**
`pstack/skills/statechart/` file differences. The other changed
subtrees fall into distinct non-vendored areas:

- `poteto-mode`, `setup-pstack`, `poteto-help`, `swarm`,
  `arena`, `no-comments`, `automate-me`: Cursor-specific
  model-pool, Task-subagent, plugin and personal mode workflows.
  **NOT_RELEVANT for automatic AgentHub adoption**. Importing them
  would introduce competing owners or tool assumptions.
- `architect`, `benchmark-checklist`, `blast-radius`,
  `principle-*`, `technical-writing`, `unslop`, `reflect`,
  `figure-it-out`, `reframe`, `how`, `why`, `teach`,
  `show-me-your-work`, `recall` and related process methods:
  covered by the existing `codebase-design`, `performance`,
  `test-quality`, `skill-ratchet`, `diagnose`, `intent`,
  `retrospective`, `writing-ticks` and evidence/decision
  policies **where applicable**. The new `reframe` terminology
  workflow is a distinct **OPTIONAL** user-requested experience, not
  a mandate to create a skill during routine code changes.
- The remaining `pstack/docs`, agents, automation, plugin metadata
  and training/playbook changes concern its own Cursor distribution
  and workflows. They are not imported into AgentHub or treated as
  tested product runtime behavior.

This is a scoped **adoption classification**, not a proof of identical
behavior across all 113 external files. It justifies marking the
**adopted Statechart and related AgentHub contracts current**, while
retaining the original local Statechart commit and source history.

**Impeccable:** Unlike the other sources, the new native Engine 0.1.31
is installed but the canonical Rust Live host integration remains
unqualified by the real UI command check. Keep `update-pending` in the
five-source registry even though its `reviewedCommit` matches the
latest upstream HEAD. Weekly checks must still signal a pending
adoption, not a false five-for-five release completion.

The nine supplemental DWA GitHub references below are method
citations or optional provider inspirations, **not additional live
vendor branches**. Their scoped dispositions are retained; real
deployment parity (Penpot session compatibility, full IME/WCAG
interaction, 3D demos) must be proved if those features are actually
requested. The report does **not** claim byte-for-byte upgrades or
full semantic parity with all nine independent repositories.

---

## Historical registry checkpoint and comparison

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
- **REVIEWED / NO MANDATORY IMPORT:** Addy's `run-evals.js` has three
  distinct tiers: structural linting, lexical TF-IDF skill-routing
  approximations (`--min-rank1`), and optional headless-`claude`
  behavioral execution in a temporary workspace. Its
  `scripts/lib/behavioral-record.js` persists a hash-bound transcript,
  staged-file SHA-256 inventory and replayable rubric-grade attempts.
  That historical regrade is explicitly **not** a fresh execution.
  AgentHub's `skills/skill-ratchet/references/evaluation-contract.md`
  instead binds current non-config acceptance judgments to the exact
  DWA source digest and two independent user-started models. A lexical
  similarity score or a regrade of prior traces **cannot** replace
  that release gate. The recorded-runner method may be revisited as
  an optional research harness, but `acceptEdits`, external model
  execution, and replayed results must not be silently added to
  ordinary CI or treated as fresh independent reviews.
- **PENDING:** assess Addy's shared general performance/security
  checklists against AgentHub's canonical quality/security owners
  only when a concrete gap is identified. No upstream eval or
  checklist script has been vendored.

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
guides, and new `reframe` guidance. The GitHub Compare API's broad 300-file cap has now been
resolved for this source using recursive, untruncated `pstack/` subtree
Git trees at the **registry SHA** and current upstream HEAD.
The tree comparison covers every tracked path (including deletions):
`skills/` went from 650 to 627 tree entries, with 70 changed/new and
24 deleted file blobs; alongside 10 docs, four automations, two agents,
one plugin manifest and two root files, this yields **113 changed/deleted
pstack files**. Neither recursive tree response was truncated.
Fifteen `statechart/` paths changed since the **older registry SHA**,
but all of their runtime changes precede the local pinned snapshot:
the **local pin -> current HEAD** delta remains zero in `statechart/`.
Most other changes reorganize poteto/architect/reflect/why guidance,
and the new `reframe` skill introduces a separate optional prompting
method. They still need bounded semantic relevance review before
updating the broad registry checkpoint; no competing workflow router.
The complete **path inventory is VERIFIED**, but full functional/adoption
qualification is **NOT_VERIFIED**.

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
  The **broad Compare API** was capped at 300 files, but direct
  nontruncated recursive trees establish the DWA-relevant scoped deltas:
  `agent-skills/3d/` 122 -> 332 entries (143 changed/new file blobs),
  `web-design/` 969 -> 1151 (141 changed/new),
  `ui/` 19 -> 52 (21 changed/new), and `game-development/`
  116 -> 161 (36 changed/new). New entries emphasize Three.js water,
  3D composition, camera/scroll effects, scenic UI, and demo assets.
  **NOT_RELEVANT by default** to ordinary DWA application UI;
  **BLOCKED_PENDING** until the actual product requests a supported
  3D/experience treatment and assets/licensing/performance are reviewed.
  No blanket copying of media/demo scripts or extra 3D skill owner.
  The rest of the repository, including media and a new video-editing
  directory, is not a claimed complete semantic review.
- `nextlevelbuilder/ui-ux-pro-max-skill`: from
  `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03` to
  `72e5fc76a4f3eb37747dc472cb3091bd46e7752a`, +43 commits,
  245 changed paths. Includes RTL/IME, form error states, map/product
  cases, PySide6 and Windows UTF-8 refinements. **INTEGRATE, scoped:**
  the concrete IME composition/Enter and RTL/bidirectional UI interaction
  cases were missing from DWA's existing state/interaction owner and are
  now recorded there, with source-contract regressions. No imported Python
  runner or catalog. **PENDING:** verify actual browser/OS runtime input
  composition. The newer `preview.py` produces a standalone inline-CSS
  design-token specimen, not a rendered product or evidence of working
  interactions. Its standalone HTML, optional Google Fonts links,
  contrast badges and form examples can be useful for concept exploration,
  but **do not** substitute it for DWA's real product/browser-state
  evidence or import the generator as a second design-system owner.
  The PySide6/QSS guidance is specifically scoped to Qt/qfluentwidgets,
  not a universal Windows UI rule; review it when that stack is
  actually selected. Other catalog/data changes remain conditional.
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
