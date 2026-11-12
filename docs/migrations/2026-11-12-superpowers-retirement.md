# Superpowers retirement: capability and cutover audit (2026-11-12)

**Intent:** Replace dependency on the locally installed Superpowers Codex
plugin with existing or narrowly enhanced AgentHub workflows, then uninstall
the plugin using Codex's supported plugin manager. This is a migration plan,
not proof that a local Codex uninstall has happened.

## Source snapshots

- Original: https://github.com/obra/superpowers
  commit `22f0b463e7a5e579904dd6211a520321035526f7`, v7.0.2.
- Optimized: https://github.com/REPOZY/superpowers-optimized
  commit `f6a54f676c65dab03a037fc3f60fefd0469fae49`, v6.11.1.
- AgentHub: https://github.com/Wibias/agent-hub
  baseline `232dd7c6c690137dedf9da112410d0fa2363c2bf`.
- Observed local Codex original installation: 7.0.1
  (`~/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/`).
  Local installation of the optimized fork was **not** established.

This mapping is based on checked-in skills and documentation. It does not
claim behavioral parity until routing and live Codex acceptance are tested.

## Original Superpowers: 15 skills

| Skill | Hub route / decision |
|---|---|
| brainstorming | `grilling` (ideation, decision), `intent` |
| diagnosing-superpowers | `retrospective` / session evidence; vendor-specific diagnosis intentionally retires |
| dispatching-parallel-agents | `codex-dynamic-workflows` and AGENTS.md delegation |
| executing-plans | AGENTS.md implementation discipline, `codex-dynamic-workflows` for explicit orchestration |
| finishing-a-development-branch | `github-delivery` |
| receiving-code-review | `github-delivery` feedback and review paths |
| requesting-code-review | `github-delivery` |
| subagent-driven-development | `codex-dynamic-workflows` plus conditional per-packet spec/quality review |
| systematic-debugging | `diagnose` for resistant defects; AGENTS.md for ordinary bugs |
| test-driven-development | NEW `tdd` owner for genuine red-green-refactor |
| using-git-worktrees | AGENTS.md worktree rules and host-native isolation |
| using-superpowers | AgentHub skill catalog and `skill-ratchet`; no vendor bootstrap |
| verification-before-completion | AGENTS.md completion/verification; project verify-* and `verification-harness` |
| writing-plans | `github-delivery` PRD/issue plans, AGENTS.md, optional dynamic-workflow plan |
| writing-skills | `skill-ratchet` |

## Optimized fork: additional capabilities beyond the common core

The fork lists 24 skills in total; shared skills above have their own
fork-specific implementation. Distinct additions and extensions:

| Capability | Hub route / decision |
|---|---|
| claude-md-creator | AGENTS.md project-local instruction ownership; no forced CLAUDE.md clone |
| context-management / session memory | `handoff`, `work-recall`, memory-engine; no parallel memory database |
| deliberation / premise-check | `grilling` decisions and AGENTS.md outcome/scope check |
| dependency-management | Extend `deprecation-and-migration` with incremental upgrade reference |
| error-recovery / known issues | `diagnose`, `extract-approach` and Hub memory; avoid duplicate `known-issues.md` |
| frontend-design | `design-with-ai` |
| performance-investigation | `performance` |
| refactoring | `code-simplification`, `improve-codebase-architecture`, `github-delivery` |
| self-consistency-reasoner | `codex-dynamic-workflows` bounded fresh-context doubt gate, not fake independence |
| token-efficiency | AGENTS.md context discipline; do not force global output compression |
| red-team agent / security hooks | `ai-agent-security`, `fortify`, `github-delivery`; do **not** import hooks blindly |
| autoimprove/session-stat tooling | no mandatory replacement: optional system with no demonstrated end-user contract |

### Intentional exclusions and residual risks

- Do not import all 11 optimized hooks. Its own documentation reports partial
  Codex parity, and current AgentHub Memory hooks already manage several
  events. Hook precedence and Windows runtime behavior must be measured before
  introducing overlapping handlers.
- Do not enable automatic model voting as if multiple paths in one model context
  were independent. Require external evidence or a genuinely fresh reviewer for
  consequential uncertainty.
- Do not make brainstorming, red-green testing, two reviews, or worktree
  creation mandatory for trivial edits. The Hacker News discussion
  https://news.ycombinator.com/item?id=48739459 reports both benefits and
  high token/latency costs; anecdotes do not establish a benchmark.
- Keep historical `docs/superpowers/` plans for provenance, but they are not
  executable runtime dependencies. On resumption, reinterpret any
  `superpowers:...` step through the current Hub owner.

## Retirement gates (strict order)

1. Merge approved Hub changes after relevant CI, skill-ratchet structural
   validation, and the two independent model reviews required for edited
   Skill Ratchet targets. Record blockers honestly; no waiver by wishful parity.
2. Refresh/install the Hub's current skills to the same Codex environment.
   In a **fresh session**, test explicit TDD, meaningful red->green evidence,
   normal bug repair, a multi-packet coding workflow with spec+quality
   acceptance, safe dependency upgrade planning, and regular PR delivery.
   Confirm the executed SKILL.md paths belong to AgentHub, not Superpowers.
3. Audit installed plugins with `codex plugin list --json` and note the exact
   `superpowers@marketplace` identifier. Inspect any separate legacy
   symlink/clone or bootstrap instructions. Do not delete a plugin cache by hand.
4. Use `codex plugin remove 'superpowers@<actual-marketplace>'`, or uninstall
   in Codex's plugin browser. Restart Codex. Confirm the installed plugin list
   no longer includes Superpowers and a fresh normal coding task uses the
   Hub-native skill. If a legacy independent skill link exists, remove it only
   after verifying its target and confirming it is not Hub-owned.
5. Retain a rollback path: reinstall the original plugin by its exact
   marketplace ID if a validated workflow regresses. Do not label the
   migration complete while any active legacy bootstrap still loads it.

## Scope and status

- This change does not touch live Windows Codex configuration or plugin cache.
- Does not activate AgentHub services, alter production, or remove historical plans.
- Cutover state: **prepared**, pending Hub qualification, merge, and local
  fresh-session verification/uninstall.
