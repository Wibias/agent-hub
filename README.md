# Agent Hub

Portable, cross-harness guidance and reusable skills for coding agents.

The Hub keeps shared behavior in one place while separating:

- always-on agent policy;
- reusable skills and domain workflows;
- host-specific runtime capabilities;
- stable knowledge;
- local episodic memory;
- project-local rules and skills.

The public repository is designed to work without maintainer-specific paths,
private transcripts, local memory history, or a required operating system.

## Layout

| Path | Purpose |
|---|---|
| `AGENTS.md` | Always-applicable policy, authority boundaries, and cross-task defaults |
| `SOUL.md` | Voice and working style |
| `CONTEXT.md` | Shared vocabulary |
| `skills/` | Portable reusable workflows and domain skills |
| `agent-runtime/` | Host-neutral runtime preferences and evidence-backed host capabilities |
| `knowledge/` | Stable reference material and the generated skill index |
| `memory/` | Public memory workflow/templates; personal state stays local and ignored |
| `scripts/` | Deterministic validation and maintenance tools |

Project-specific behavior belongs in the project itself, for example
`<project>/.agents/skills/`, instead of being hardcoded into the global Hub.

## How to use Agent Hub skills

You usually do **not** need to memorize skill names. Describe the job in normal
language and the agent can route to the matching skill. Name a skill or one of
its public routes when you want to force a particular workflow.

Examples:

```text
Diagnose why this write reports success but nothing is persisted.
fortify worst-case src/components/MemberList.tsx
motion-build the settings drawer transition
Use github-delivery to watch PR #123 until CI is green.
Review this Swift concurrency code.
```

The terms used in this README mean:

- **Skill** — the canonical owner for a type of work, backed by a top-level
  `SKILL.md`.
- **Route / sub-workflow** — a focused mode inside a larger skill. Routes share
  the parent skill's ownership and are not competing standalone skills.
- **Alias** — a compatibility name that redirects to a canonical owner. Aliases
  are listed separately below.
- **Reference** — implementation guidance loaded conditionally by a skill. A
  reference is not normally something you invoke directly.

The examples below are intent examples, not a requirement that every host expose
slash commands. When a skill defines a literal command, the command is shown in
backticks.

## Skill guide

### Design & UX

| Skill | Use it for | Example |
|---|---|---|
| <!-- skill-doc:design-with-ai -->[**design-with-ai**](skills/design-with-ai/SKILL.md) | Canonical visible-UI design owner: audit, improve, restyle, redesign, build product surfaces, and design motion without generic AI-SaaS styling. | `motion-build the settings drawer` or “redesign this dashboard without changing behavior” |
| <!-- skill-doc:intent -->[**intent**](skills/intent/SKILL.md) | UX strategy and experience architecture: journeys, service design, information architecture, interaction patterns, content strategy, accessibility, ethics, and measurement. | “Map the onboarding journey and identify the highest-friction moments.” |
| <!-- skill-doc:prototype -->[**prototype**](skills/prototype/SKILL.md) | Build throwaway logic or UI prototypes to compare a design/behavior direction before committing to production architecture. | “Prototype three structurally different settings flows.” |
| <!-- skill-doc:fortify -->[**fortify**](skills/fortify/SKILL.md) | Harden visible UI outside the happy path: state/recovery design plus executable realistic-data stress testing. | `fortify worst-case src/routes/team.tsx` |
| <!-- skill-doc:impeccable -->[**impeccable**](skills/impeccable/SKILL.md) | Explicit-only specialist frontend-design workflow when you specifically want Impeccable's design process. | “Use impeccable on this landing page.” |
| <!-- skill-doc:conversion-pages -->[**conversion-pages**](skills/conversion-pages/SKILL.md) | Design and write SaaS landing/pricing pages around conversion goals, hierarchy, offers, and proof. | “Design a pricing page for these three plans.” |
| <!-- skill-doc:seo-audit -->[**seo-audit**](skills/seo-audit/SKILL.md) | Audit technical SEO, on-page optimization, discoverability, and Core Web Vitals. | “Audit this site for technical SEO issues.” |

### Architecture & code

| Skill | Use it for | Example |
|---|---|---|
| <!-- skill-doc:codebase-design -->[**codebase-design**](skills/codebase-design/SKILL.md) | Design module boundaries and deeper codebase structure; includes design-it-twice reasoning before committing to an architecture. | “Design this feature two ways before we choose module boundaries.” |
| <!-- skill-doc:domain-modeling -->[**domain-modeling**](skills/domain-modeling/SKILL.md) | Sharpen domain terminology, entities, value objects, invariants, ownership, and bounded concepts. | “Model orders, fulfillment, refunds, and their invariants.” |
| <!-- skill-doc:context-engineering -->[**context-engineering**](skills/context-engineering/SKILL.md) | Author or repair agent rules/context files such as `AGENTS.md`, `CLAUDE.md`, and task-local context packs. | “Rewrite this AGENTS.md so agents stop crossing the service boundary.” |
| <!-- skill-doc:deprecation-and-migration -->[**deprecation-and-migration**](skills/deprecation-and-migration/SKILL.md) | Plan and execute safe retirement/migration of APIs, features, subsystems, dependencies, or data models. | “Migrate callers off v1 and remove it safely.” |
| <!-- skill-doc:improve-codebase-architecture -->[**improve-codebase-architecture**](skills/improve-codebase-architecture/SKILL.md) | Survey a repository for architecture-deepening opportunities and produce a prioritized improvement report. | “Find the highest-value architecture improvements in this repo.” |
| <!-- skill-doc:improve-react -->[**improve-react**](skills/improve-react/SKILL.md) | Survey a React codebase as a senior React engineer using React Doctor evidence and targeted follow-up. | “Review this React app for structural and runtime problems.” |
| <!-- skill-doc:simplify -->[**simplify**](skills/simplify/SKILL.md) | Canonical owner for ordinary code cleanup and simplification while preserving behavior. | “Simplify the changes on this branch.” |
| <!-- skill-doc:code-simplification -->[**code-simplification**](skills/code-simplification/SKILL.md) | Specialist behavior-preserving readability refactor for already-working code. | “Refactor this working module for readability only.” |
| <!-- skill-doc:ponytail-review -->[**ponytail-review**](skills/ponytail-review/SKILL.md) | Explicit-only cut-list review for over-engineering: identify what can be deleted or flattened without changing behavior. | “Run ponytail-review on this abstraction layer.” |
| <!-- skill-doc:quality-constraints -->[**quality-constraints**](skills/quality-constraints/SKILL.md) | Define and maintain a project's persistent blocking/warning quality bar in `CONSTRAINTS.md`. | “Define the quality constraints for this service.” |
| <!-- skill-doc:test-quality -->[**test-quality**](skills/test-quality/SKILL.md) | Evaluate whether tests actually protect behavior and improve low-value, brittle, or misleading test suites. | “Review these tests for signal, not just coverage.” |
| <!-- skill-doc:write-swift -->[**write-swift**](skills/write-swift/SKILL.md) | Canonical Swift engineering owner for modeling, concurrency, testing, performance, refactoring, and migrations. | “Review this actor isolation design.” |

### Debugging, performance & quality

| Skill | Use it for | Example |
|---|---|---|
| <!-- skill-doc:diagnose -->[**diagnose**](skills/diagnose/SKILL.md) | Reproduce, localize, and find the root cause of hard bugs, false-success writes, and performance regressions. Diagnosis ends at diagnosis. | “Diagnose why this succeeds in logs but no row is created.” |
| <!-- skill-doc:performance -->[**performance**](skills/performance/SKILL.md) | Measure and improve performance across browser/network, backend/runtime, APIs, databases, and end-to-end latency. | “Find what makes this endpoint p95 slow.” |
| <!-- skill-doc:observability -->[**observability**](skills/observability/SKILL.md) | Design vendor-neutral logs, metrics, traces, dashboards, alerts, and verification for a service or feature. | “Add an observability plan for checkout.” |
| <!-- skill-doc:retrospective -->[**retrospective**](skills/retrospective/SKILL.md) | Turn completed work/incidents into durable prevention, hardening, and enforcement improvements for future agent runs. | “Do a retrospective on why this bug escaped review.” |
| <!-- skill-doc:verification-harness -->[**verification-harness**](skills/verification-harness/SKILL.md) | Create or repair a portable project-local verification skill that agents can use to prove work. | “Build a verification harness for this repository.” |

### GitHub & delivery

| Skill | Use it for | Example |
|---|---|---|
| <!-- skill-doc:github-delivery -->[**github-delivery**](skills/github-delivery/SKILL.md) | Canonical Git/GitHub delivery owner: issues, branches, PR creation, reviews, CI, status, merge, conflicts, stacked/multi-base delivery, and release prep. | “Take this issue through implementation PR and green CI.” |

### Research, context & knowledge

| Skill | Use it for | Example |
|---|---|---|
| <!-- skill-doc:vault-research -->[**vault-research**](skills/vault-research/SKILL.md) | Canonical external-research workflow for investigation, comparison, source gathering, and evidence-backed recommendations. | “Research current approaches to durable agent memory.” |
| <!-- skill-doc:read-github -->[**read-github**](skills/read-github/SKILL.md) | Read/search GitHub source and documentation without cloning or mutating the repository. | “Find where this repo implements auth refresh.” |
| <!-- skill-doc:source-driven-development -->[**source-driven-development**](skills/source-driven-development/SKILL.md) | Ground implementation in current official/upstream source material when APIs, libraries, or standards can drift. | “Implement this against the current official Swift docs.” |
| <!-- skill-doc:research-prompt -->[**research-prompt**](skills/research-prompt/SKILL.md) | Produce a compact deep-research brief for a human researcher or research model. | “Turn this question into a rigorous research prompt.” |
| <!-- skill-doc:teach -->[**teach**](skills/teach/SKILL.md) | Explain a codebase, subsystem, change, or decision so the reader understands both mechanics and rationale. | “Teach me how the memory candidate pipeline works.” |
| <!-- skill-doc:understand -->[**understand**](skills/understand/SKILL.md) | Analyze a codebase into a persistent knowledge graph for the Understand Anything dashboard/workflow. | “Build the knowledge graph for this repository.” |
| <!-- skill-doc:writing-ticks -->[**writing-ticks**](skills/writing-ticks/SKILL.md) | Audit prose for AI-writing tells and revise docs/blog/README copy toward more natural human writing. | “Check this README for AI writing ticks.” |
| <!-- skill-doc:youtube-transcript -->[**youtube-transcript**](skills/youtube-transcript/SKILL.md) | Fetch, extract, or download captions/transcripts from a YouTube video. | “Get the transcript for this YouTube URL.” |

### Security

| Skill | Use it for | Example |
|---|---|---|
| <!-- skill-doc:security-review -->[**security-review**](skills/security-review-redirect/SKILL.md) | Practical application/API/SaaS/CI security review: authn/authz, secrets, input handling, dependencies, supply chain, and common vulnerability classes. | “Security-review this PR before merge.” |
| <!-- skill-doc:ai-agent-security -->[**ai-agent-security**](skills/ai-agent-security/SKILL.md) | Threat-model, harden, or red-team LLM/agent/RAG/MCP systems against prompt injection, tool poisoning, model/data poisoning, and guardrail bypass. | “Threat-model this MCP-enabled support agent.” |

### Tooling & frameworks

| Skill | Use it for | Example |
|---|---|---|
| <!-- skill-doc:playwright -->[**playwright**](skills/playwright/SKILL.md) | Drive a real browser with Playwright for navigation, interaction, screenshots, multi-tab flows, and UI verification. | “Use Playwright to reproduce this checkout bug.” |
| <!-- skill-doc:firecrawl -->[**firecrawl**](skills/firecrawl/SKILL.md) | Search, scrape, and interact with web content through Firecrawl tooling. | “Scrape these docs with Firecrawl.” |
| <!-- skill-doc:shadcn -->[**shadcn**](skills/shadcn/SKILL.md) | Search, add, compose, fix, style, and update shadcn/ui components and registries. | “Add the correct shadcn command-menu primitive.” |
| <!-- skill-doc:pnpm -->[**pnpm**](skills/pnpm/SKILL.md) | Handle pnpm-specific package management, workspace, dependency-resolution, and command behavior. | “Fix this pnpm workspace dependency issue.” |
| <!-- skill-doc:vite -->[**vite**](skills/vite/SKILL.md) | Own Vite-specific configuration, plugins, dev-server, and build behavior. | “Why does this Vite plugin only fail in production build?” |
| <!-- skill-doc:vitest -->[**vitest**](skills/vitest/SKILL.md) | Own Vitest-specific configuration, test behavior, and failing Vitest suites. | “Fix this Vitest environment/config failure.” |

### Memory & agent workflow

| Skill | Use it for | Example |
|---|---|---|
| <!-- skill-doc:codex-dynamic-workflows -->[**codex-dynamic-workflows**](skills/codex-dynamic-workflows/SKILL.md) | Plan and run explicit multi-agent orchestration with bounded work packets, doubt gates, and integration verification. | “Use subagents to inspect these four independent modules.” |
| <!-- skill-doc:grilling -->[**grilling**](skills/grilling/SKILL.md) | Interview the user to eliminate material ambiguity before acting. | “Grill me on this product idea before we build anything.” |
| <!-- skill-doc:handoff -->[**handoff**](skills/handoff/SKILL.md) | Compact the current conversation/work state into a structured handoff for a fresh agent/session. | “Create a handoff so I can continue this in a fresh session.” |
| <!-- skill-doc:work-recall -->[**work-recall**](skills/work-recall/SKILL.md) | Reconstruct current working state for a project, feature, bug, or recent workstream from available history/context. | “Recall where we left off on Agent Hub memory.” |
| <!-- skill-doc:extract-approach -->[**extract-approach**](skills/extract-approach/SKILL.md) | Capture a verified reusable decision rule into durable local memory after a solve proves it useful. | “Extract the rule we learned from this incident.” |
| <!-- skill-doc:skill-ratchet -->[**skill-ratchet**](skills/skill-ratchet/SKILL.md) | Quality-gate adding, changing, evaluating, qualifying, and releasing Agent Skills with canonical/adversarial cases and digest-bound evidence. | `node scripts/skill-ratchet.mjs preflight --skill-root skills/foo` |

## Routes inside complex skills

The parent skill remains the canonical owner. These routes make its focused modes
visible without multiplying top-level skills.

<details>
<summary><strong><code>design-with-ai</code> — visible UI and motion routes</strong></summary>

| Route | Use it for |
|---|---|
| <!-- route-doc:design-with-ai:audit-surface -->`audit-surface <path-or-surface>` | Read-only critique of an existing surface and its visual hierarchy. |
| <!-- route-doc:design-with-ai:improve-existing -->`improve-existing <path-or-surface>` | Improve an existing surface while preserving its established direction. |
| <!-- route-doc:design-with-ai:restyle-existing -->`restyle-existing <path-or-surface>` | Change styling/visual treatment while preserving the product structure. |
| <!-- route-doc:design-with-ai:redesign-existing -->`redesign-existing <path-or-surface>` | Rework structure and visual direction of an existing product surface. |
| <!-- route-doc:design-with-ai:build-product-surface -->`build-product-surface <route-or-description>` | Create a new production UI surface in the product's actual design language. |
| <!-- route-doc:design-with-ai:design-spec -->`design-spec <surface-or-flow>` | Produce an implementation-ready visual/interaction specification. |
| <!-- route-doc:design-with-ai:motion-build -->`motion-build <target-or-description>` | Construct purposeful motion with the cheapest suitable mechanism and proper interruption/reduced-motion behavior. |
| <!-- route-doc:design-with-ai:motion-opportunities -->`motion-opportunities <path-or-surface>` | Find places where motion would improve causality, continuity, feedback, or orientation. |
| <!-- route-doc:design-with-ai:motion-audit -->`motion-audit <path-or-surface>` | Audit existing motion for purpose, consistency, timing, accessibility, and system fit. |
| <!-- route-doc:design-with-ai:motion-review -->`motion-review <path-or-surface>` | Review a completed motion implementation and return an approve/block-style verdict. |
| <!-- route-doc:design-with-ai:motion-optimize -->`motion-optimize <path-or-surface>` | Improve runtime/perceptual motion quality after behavior is already understood. |
| <!-- route-doc:design-with-ai:motion-name -->`motion-name <interaction-description>` | Identify/name the motion or interaction pattern being described. |

Conditional platform references cover web, mobile web/PWA, native mobile,
React Native/Expo motion, desktop, direct manipulation, and visual-tool
platforms. They are loaded from evidence about the target; they are not separate
skills to invoke.

</details>

<details>
<summary><strong><code>fortify</code> — resilience and worst-case routes</strong></summary>

| Route | Use it for |
|---|---|
| <!-- route-doc:fortify:state-resilience -->**State resilience** | Inventory loading, empty, error, partial, offline, timeout, recovery, first-run, and i18n states. Example: “Harden this checkout for failure/recovery states.” |
| <!-- route-doc:fortify:worst-case -->`worst-case <surface>` | Execute realistic/schema-backed adversarial data and environment stress against the actual rendered UI, then report Broken/Ugly/Fragile findings. |

</details>

<details>
<summary><strong><code>prototype</code> — prototype branches</strong></summary>

| Route | Use it for |
|---|---|
| <!-- route-doc:prototype:logic -->**Logic prototype** | Probe behavior, state transitions, or product logic without spending effort on visual fidelity. |
| <!-- route-doc:prototype:ui -->**UI prototype** | Compare visible product directions with realistic content, working core interactions, and instant switching. |
| <!-- route-doc:prototype:technical-fork -->**Technical fork** | Choose a minimal host-page/SPA setup for small probes or the richer full-stack prototype reference for routed app-shell prototypes. |

</details>

<details>
<summary><strong><code>intent</code> — UX strategy modes and specialist routes</strong></summary>

| Route | Use it for |
|---|---|
| <!-- route-doc:intent:context -->**Context Mode** | Establish product, user, business, and evidence context before making UX decisions. |
| <!-- route-doc:intent:practice -->**Practice Mode** | Apply UX methods to a concrete product problem and produce a usable decision/artifact. |
| <!-- route-doc:intent:extract -->**Extract Mode** | Capture reusable UX principles/patterns from observed work or evidence. |
| <!-- route-doc:intent:research -->**Research Mode** | Plan/interpret UX research and connect findings to product decisions. |
| <!-- route-doc:intent:service-design -->**Service design** | Blueprint cross-channel/frontstage/backstage service behavior and dependencies. |
| <!-- route-doc:intent:interaction-patterns -->**Interaction patterns** | Choose or evaluate interaction mechanics and behavioral patterns. |
| <!-- route-doc:intent:information-architecture -->**Information architecture** | Structure navigation, labeling, hierarchy, grouping, and findability. |
| <!-- route-doc:intent:content-strategy -->**Content strategy** | Plan product content systems, hierarchy, terminology, and governance. |
| <!-- route-doc:intent:ethical-design -->**Ethical design** | Evaluate coercion, manipulation, consent, user agency, and harmful incentives. |
| <!-- route-doc:intent:accessibility -->**Accessibility** | Apply UX-level inclusive/accessibility reasoning and requirements. |
| <!-- route-doc:intent:measurement -->**Measurement** | Define UX outcomes, signals, metrics, and evidence plans. |

</details>

<details>
<summary><strong><code>skill-ratchet</code> — skill lifecycle routes</strong></summary>

| Route | Use it for |
|---|---|
| <!-- route-doc:skill-ratchet:preflight -->**Preflight** | Decide whether a new/changed skill is justified, correctly owned, and ready for the Ratchet. |
| <!-- route-doc:skill-ratchet:author -->**Author / modify** | Add or materially change a skill with canonical, negative, regression, and adversarial acceptance cases. |
| <!-- route-doc:skill-ratchet:evaluate -->**Evaluate** | Compare candidate behavior against a baseline/evidence contract. |
| <!-- route-doc:skill-ratchet:validate -->**Validate** | Run structural validation and, when receipts exist, complete digest-bound Strong + Weaker qualification. |

</details>

<details>
<summary><strong><code>performance</code> — measurement routes</strong></summary>

| Route | Use it for |
|---|---|
| <!-- route-doc:performance:investigation -->**Performance investigation** | Measure the actual symptom, explain where the time/resources go, optimize in impact order, and verify the result. |
| <!-- route-doc:performance:databases-and-runtime -->**Databases & runtime** | Load deeper guidance when the bottleneck involves queries, indexing, memory, concurrency, runtimes, pools, or backend execution. |

</details>

<details>
<summary><strong><code>codex-dynamic-workflows</code> — multi-agent orchestration building blocks</strong></summary>

| Route | Use it for |
|---|---|
| <!-- route-doc:codex-dynamic-workflows:workflow-artifact -->**Workflow artifact / Read Set** | Define the shared objective, authoritative context, boundaries, and artifacts subagents may rely on. |
| <!-- route-doc:codex-dynamic-workflows:work-packets -->**Work packets** | Give each agent one bounded task with explicit inputs, outputs, allowed scope, and completion evidence. |
| <!-- route-doc:codex-dynamic-workflows:doubt-gate -->**Doubt Gate** | Stop integration when unresolved uncertainty remains instead of letting agents silently guess. |
| <!-- route-doc:codex-dynamic-workflows:verification -->**Verification / integration** | Independently reconcile agent outputs and prove the combined result before declaring completion. |

</details>

<details>
<summary><strong><code>write-swift</code> — Swift engineering routes</strong></summary>

| Route | Use it for |
|---|---|
| <!-- route-doc:write-swift:core-language -->**Core language** | Data modeling, API design, value/reference semantics, protocols/generics, Codable, and durable Swift language choices. |
| <!-- route-doc:write-swift:concurrency -->**Concurrency** | `async/await`, actors, isolation, `Sendable`, structured tasks, cancellation, and concurrency correctness. |
| <!-- route-doc:write-swift:testing-and-performance -->**Testing & performance** | Swift Testing/XCTest strategy, benchmarks, profiling, and measured optimization. |
| <!-- route-doc:write-swift:broad-review -->**Broad review** | Review mixed Swift code and load only the language/concurrency/testing references that the code actually needs. |

Version-sensitive Swift/Xcode/compiler/SDK/API facts compose with
`source-driven-development` and current official Swift sources rather than being
frozen into the skill.

</details>

<details>
<summary><strong><code>github-delivery</code> — Git/GitHub delivery routes</strong></summary>

These routes are normally selected from natural-language intent; they are not a
set of mandatory CLI commands.

#### Planning and intake

| Route | Use it for |
|---|---|
| <!-- route-doc:github-delivery:prd -->**PRD** | Turn a product/engineering goal into a scoped delivery-oriented requirements document. |
| <!-- route-doc:github-delivery:issue-breakdown -->**Issue breakdown** | Decompose a larger initiative/PRD into implementation-sized issues. |
| <!-- route-doc:github-delivery:create-issues -->**Create issues** | Create the agreed GitHub issues with preserved scope and dependencies. |
| <!-- route-doc:github-delivery:triage -->**Triage** | Classify incoming issues/work and decide ownership, urgency, and next action. |
| <!-- route-doc:github-delivery:qa-intake -->**QA intake** | Convert QA findings/repro evidence into actionable engineering work. |
| <!-- route-doc:github-delivery:refactor-plan -->**Refactor plan** | Structure a behavior-preserving refactor into reviewable delivery steps. |
| <!-- route-doc:github-delivery:agent-brief -->**Agent brief** | Produce a bounded implementation brief another coding agent can execute safely. |
| <!-- route-doc:github-delivery:out-of-scope -->**Out of scope** | Record follow-up work discovered during delivery without silently expanding the current PR. |

#### Building and publishing work

| Route | Use it for |
|---|---|
| <!-- route-doc:github-delivery:git-workflow -->**Git workflow** | Branching, commits, synchronization, worktrees, and safe repository-state operations. |
| <!-- route-doc:github-delivery:research-issue -->**Research issue** | Investigate an issue/bug before deciding whether implementation is warranted. |
| <!-- route-doc:github-delivery:create-pr-from-local-work -->**Create PR from local work** | Publish already-existing local commits/changes as a correctly based pull request. |
| <!-- route-doc:github-delivery:create-pr-for-issue -->**Create PR for issue** | Take an issue-scoped implementation through branch/commit/PR creation. |
| <!-- route-doc:github-delivery:work-item-delivery -->**Work-item delivery** | Carry a bounded issue/task through implementation evidence and PR delivery. |
| <!-- route-doc:github-delivery:multi-base-delivery -->**Multi-base delivery** | Deliver related work that intentionally targets different base branches. |
| <!-- route-doc:github-delivery:stacked-prs -->**Stacked PRs** | Create/manage dependent PRs with explicit base relationships and merge order. |
| <!-- route-doc:github-delivery:consolidate-prs -->**Consolidate PRs** | Combine overlapping/fragmented pull requests into a coherent delivery when justified. |
| <!-- route-doc:github-delivery:release-prep -->**Release prep** | Prepare branch/PR/release state for an intended release cut. |

#### Reviews, bots, CI, and status

| Route | Use it for |
|---|---|
| <!-- route-doc:github-delivery:fix-pr-bots -->**Fix PR bots** | Resolve actionable automated-review/bot findings without blindly accepting them. |
| <!-- route-doc:github-delivery:watch-pr -->**Watch PR** | Follow a PR/CI/review loop, react to meaningful changes, and report only useful state transitions. |
| <!-- route-doc:github-delivery:re-review-pr -->**Re-review PR** | Re-check a PR after fixes/new commits against prior findings and current code. |
| <!-- route-doc:github-delivery:open-work-status -->**Open-work status** | Summarize the state of open delivery work without mutating anything. |
| <!-- route-doc:github-delivery:full-review-pr -->**Full PR review** | Read-only comprehensive review across correctness, architecture, tests, security, and maintainability. |
| <!-- route-doc:github-delivery:spec-standards-review -->**Spec/standards review** | Check a PR against an explicit spec, contract, standards document, or acceptance criteria. |
| <!-- route-doc:github-delivery:simplify-pr -->**Simplify PR** | Apply the canonical simplification owner to the PR's current implementation and delivery context. |
| <!-- route-doc:github-delivery:no-comments -->**No-comments review** | Review the code while treating explanatory comments as unavailable evidence. |
| <!-- route-doc:github-delivery:security-review -->**Security review** | Route PR/branch security assessment through the canonical security-review capability. |
| <!-- route-doc:github-delivery:status -->**Status** | Read-only current PR/branch/CI/review state. |

#### Merge and branch lifecycle

| Route | Use it for |
|---|---|
| <!-- route-doc:github-delivery:merge-pr -->**Merge PR** | Merge only after explicit authorization and fresh merge/head/CI verification. |
| <!-- route-doc:github-delivery:supersede-pr -->**Supersede PR** | Replace an obsolete PR with a better/newer delivery while preserving rationale and links. |
| <!-- route-doc:github-delivery:overtake-pr -->**Overtake PR** | Continue/replace work from another PR or branch when its implementation must be taken over. |
| <!-- route-doc:github-delivery:resolve-conflicts -->**Resolve conflicts** | Resolve branch/PR conflicts without losing intended behavior or hiding semantic conflicts. |

</details>

## Aliases

Aliases exist for compatibility and route to canonical owners; prefer the
canonical skill names in new documentation and automation.

| Alias | Canonical owner | What it means |
|---|---|---|
| <!-- skill-alias:babysit -->[**babysit**](skills/babysit-redirect/SKILL.md) | `github-delivery` | Watch/monitor a GitHub PR or CI loop. |
| <!-- skill-alias:babysit-pr -->[**babysit-pr**](skills/babysit-pr-redirect/SKILL.md) | `github-delivery` | Compatibility spelling for babysitting a pull request. |
| <!-- skill-alias:create-pr-from-local-work -->[**create-pr-from-local-work**](skills/create-pr-from-local-work-redirect/SKILL.md) | `github-delivery` | Publish already-existing local work as a PR. |
| <!-- skill-alias:review-security -->[**review-security**](skills/review-security-redirect/SKILL.md) | `security-review` / `github-delivery` | Compatibility name for a security review request. |

## Install

The conventional user-level location is `~/.agents`, but the Hub does not
require one concrete home-directory layout.

Clone **this published repository** into that location. Do not clone the
historical private operator checkout.

### macOS / Linux

```sh
git clone https://github.com/Wibias/agent-hub.git "$HOME/.agents"
cd "$HOME/.agents"
```

### Windows PowerShell

```powershell
git clone https://github.com/Wibias/agent-hub.git "$HOME\.agents"
Set-Location "$HOME\.agents"
```

Use the active host's normal instruction-discovery mechanism. Host-specific
configuration belongs outside shared `SKILL.md` files unless the surface is
explicitly portable.

### Codex host setup / upgrade

After cloning or pulling a newer Agent Hub revision, inspect the complete managed Codex
host state with one dry-run-first command:

```powershell
node .\scripts\setup-codex-host.mjs
```

The command checks generated runtime drift before host mutation, plans the Agent Hub
memory hooks, native Codex-memory isolation, and retirement of legacy mutable Agent Hub
runtime profiles, then runs the existing read-only memory doctor.

If the plan is expected, apply only the managed changes:

```powershell
node .\scripts\setup-codex-host.mjs --apply
```

The orchestrator reuses the existing safe installers and backup behavior. It does not
trust changed hooks on the user's behalf. When hook definitions change, restart Codex
and review/trust them through `/hooks`.

Individual scripts remain available for diagnostics, recovery, and narrow maintenance.

## Verify an installation

Requires Node.js for the repository maintenance scripts.

```text
node scripts/verify-public-release.mjs
node scripts/verify-portable-skills.mjs
node scripts/render-agent-runtime.mjs --check
node scripts/verify-skill-routing.mjs
node knowledge/build-index.mjs
```

After rebuilding the index, a clean canonical checkout should have no generated
drift:

```text
git diff --exit-code -- knowledge/INDEX.md knowledge/index.json
```

The release-governance workflow runs the wider deterministic suite in CI.

## Skill discovery

Use the **Skill guide** above when a human wants to choose a capability. The
generated indexes remain the canonical inventory for automation and discovery:

- `knowledge/index.json` for machines;
- `knowledge/INDEX.md` for agents and complete generated inventory.

The canonical build indexes the Hub itself plus declared external catalogs.
Machine-local host caches and a specific project are opt-in inputs and are not
part of the checked-in public index.

## Local memory

The public repository ships memory **structure**, not a maintainer's history.

Tracked templates:

- `memory/MEMORY.example.md`
- `memory/pending-rules.example.md`
- `memory/README.md`

Local state is ignored:

- `memory/MEMORY.md`
- `memory/pending-rules.md`
- `memory/notes/*.md`

Initialize missing local state with:

```text
node skills/extract-approach/scripts/ensure-memory-state.mjs
```

For the local durable-memory engine, a loopback-only console is available:

```powershell
node .\scripts\memory-ui.mjs
```

Open `http://127.0.0.1:4317` to browse projects, branches, Memories, Review,
Pipeline, Health, Quality, and Stale views. Browsing keeps a read-only SQLite
connection. Explicit Replace/Forget and candidate Confirm/Reject actions use
token-protected same-origin POSTs and the existing Memory hook contracts.

## Portability contract

Shared skills should:

- use semantic locations such as `~/.agents`, `<project>`, or an explicitly
  supplied path instead of a maintainer path;
- select shell syntax for the active operating system;
- avoid requiring one host connector, model identifier, or local cache layout;
- treat project-local assumptions as project-local guidance;
- keep secrets, transcripts, session state, and personal memory out of Git.

Runtime preferences and host capability claims live in `agent-runtime/`.

## Changing skills

Before creating, merging, forking, or materially expanding a skill, run the
`skill-ratchet` preflight and follow its qualification contract.

Shared-skill frontmatter or runtime-policy changes should also run:

```text
node scripts/verify-portable-skills.mjs
```

The README skill map is intentionally curated rather than generated. The catalog
coverage test requires every top-level skill to be documented exactly once and
keeps the public routes of complex skills from silently disappearing from the
human guide.

Keep tests focused on observable behavior and stable contracts.

## Third-party material

Some skills are adapted from or integrate with upstream open-source projects.
Keep their source attribution, notices, and component-specific license terms
intact. This README does not replace those notices or declare a new
repository-wide license.
