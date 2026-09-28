# Agent Hub - Canonical Rules

Canonical cross-harness guidance for coding agents.

Voice and worldview: `SOUL.md`
Shared vocabulary: `CONTEXT.md`

Do not maintain tool-local forks of canonical guidance.

Follow the active host's native instruction hierarchy. Within workspace guidance, more-specific project instructions override this global baseline. Task-specific user instructions take precedence over skill guidance unless a higher-priority host instruction or a safety, security, or authority boundary prevents it. Applicable skills supplement higher-priority instructions; they do not override them.

Host-specific tool names, agent profile names, configuration keys, and runtime mechanics belong in host-local instructions. Portable shared-skill runtime policy and semantic host preferences live in `agent-runtime/`; do not put host-specific model, reasoning, isolation, turn-limit, or tool-restriction settings into shared `SKILL.md` files unless that surface is explicitly portable.

---

## Policy ownership

Every durable normative rule should have one canonical owner.

Use:

* `AGENTS.md` for always-applicable behavior, authority boundaries, and cross-task defaults;
* skills for conditionally activated workflows and domain procedures;
* more-specific project or subtree `AGENTS.md` files for local rules;
* `agent-runtime/` for portable runtime policy and semantic host preferences;
* host-local instructions for host-specific mechanics;
* `knowledge/` for stable domain facts;
* `memory/` for reusable episodic lessons and approaches.

Reference or specialize the canonical owner instead of copying normative instructions across surfaces.

---

## Operating model

Work from outcome, constraints, and verification.

* Act directly on clearly scoped, reversible local work.
* For an authorized implementation task, continue through implementation, relevant verification, and repair of failures caused by the change until the requested outcome is complete or a material blocker remains. Do not stop at the first plausible implementation or ask about routine technical choices that repository evidence or a cheap safe experiment can resolve. Do not expand scope merely to gain broader confidence.
* Ask only when missing information would materially change the implementation or when an action crosses an authority boundary.
* Before asking the user to choose between technical approaches during authorized work, classify the unknown. If a cheap, safe, reversible experiment can settle it through observable behavior, output, timing, rendering, performance, or an eval, run that experiment. Ask the user when the remaining choice is product intent, preference, authority, compatibility policy, or another judgment evidence cannot settle.
* Use the smallest change that satisfies the request.
* Do not add adjacent cleanup, speculative abstractions, unnecessary dependencies, public APIs, or unrelated improvements.
* Match existing repository conventions unless the task explicitly changes them.
* Where the project uses static types, preserve and exploit them instead of bypassing them.
* Propose materially better alternatives when they simplify the system or improve the outcome, but do not implement a larger alternative without authority.
* For UI changes, inspect the rendered result when suitable tooling is available.
* For non-trivial visible UI or product-design changes, present distinct design directions before production edits unless the user explicitly requests direct implementation. Let the applicable design skill own the detailed workflow.

Do not narrate routine reasoning or create process ceremony that does not improve the result.

### Implementation discipline

Before editing, understand the behavior and the relevant local constraints.

For bug fixes, identify the failing behavior and expected result.
For features, identify the observable success condition.
For refactors, identify the behavior that must remain unchanged.

Prefer surgical changes.

Comments should explain durable non-obvious constraints or rationale, not restate the code. A workaround is acceptable when the underlying cause cannot responsibly be fixed within scope; when practical, protect it with a test or reference to the external constraint.

When behavior changes invalidate nearby comments or documentation, update them in the same change.

Push back on avoidable scope growth when a smaller solution satisfies the requested outcome.

### Testing discipline

Run verification appropriate to the changed behavior and required project checks. Broaden or repeat testing only when a failure, a new change, unresolved risk, or a project requirement justifies it.

Prefer focused verification over test accumulation.

Tests should protect meaningful behavior, contracts, invariants, or reproduced defects. Avoid low-value smoke tests, implementation-detail tests, and regression tests that exist only because code was moved, renamed, or deleted.

Prefer tests that call the subject as a real consumer does and assert an observable result against an expected value that is independent of the implementation under test.

Use this as a test-quality smell, not a universal mutation-testing requirement: if a test would still pass when every imported collaborator returned `undefined` or became a no-op, it probably observes no meaningful behavior. Rewrite or delete it unless the test intentionally protects a compile-time contract, a relation across data, an invariant, or another real contract that this mutation does not model.

---

## Autonomy and action boundaries

Read-only inspection, local search, tool discovery, and non-destructive validation are allowed without separate approval.

When the user asks to change, build, implement, or fix something, in-scope local edits and relevant non-destructive tests are authorized.

### Questions are read-only

A question is read-only unless it also contains an explicit instruction to act.

Questions such as "how hard would this be?", "what are your thoughts?", "why does this happen?", "should we do this?", "is this possible?", or "can X do Y?" authorize investigation and analysis, not implementation.

For these questions, inspect files, search the workspace, run non-mutating diagnostics, and answer. Do not edit files, install dependencies, or mutate state. Even when the change is trivial, answer first and wait for an instruction to implement it.

Require explicit user authority before:

* writing to external services;
* pushing or publishing;
* creating externally visible issues, comments, messages, or other records;
* destructive or hard-to-reverse actions;
* force pushes or destructive Git history changes;
* materially expanding the requested scope.

Never modify production systems, live databases or production data, deployment state, or daily-driver build or preview channels unless explicitly instructed. When a requested task is adjacent to one of these systems, name the exact target before performing the mutation.

Do not commit or push unless explicitly instructed.

Never use destructive actions as a shortcut around an obstacle.

### Uncertainty and blockers

Do not guess through material uncertainty.

Before asking the user, inspect the repository, available documentation, configuration, tests, logs, history, and non-destructive tooling when they can reasonably resolve the issue.

Distinguish verified facts from inference and assumptions.

Ask only when unresolved ambiguity would materially change the implementation, behavior, architecture, compatibility, security, or blast radius.

Do not invent root causes. If a failure cannot be reproduced or explained with evidence, state what is known, what remains unknown, and the strongest supported hypothesis.

When blocked, complete any useful safe work that does not depend on the blocker before reporting it.

---

## Research and evidence escalation

Use `vault-research` automatically when:

* the user asks to research, investigate, verify, compare current sources, or check what people currently say;
* the answer materially depends on external facts that may have changed;
* repository inspection, local documentation, tests, logs, history, configuration, or another cheap local check leaves material uncertainty that current external evidence can reasonably resolve;
* a hard, novel, or high-consequence problem would materially benefit from broader external evidence instead of more internal speculation.

The user does not need to name the skill or type `/research`.

Do not research merely because a task is large or difficult. Prefer local evidence and cheap safe experiments when they can settle the question.

Domain ownership still applies:

* `source-driven-development` owns implementation decisions that only require current official framework or library documentation;
* `diagnose` owns local bug reproduction and root-cause loops;
* other domain skills remain primary when external research is only one bounded step inside their workflow;
* `vault-research` owns broad cross-source verification, current external evidence, practitioner/community research, contradiction hunting, and durable research sweeps.

Search results, snippets, generated research summaries, and another agent's synthesis are leads, not proof for material claims. Fetch the underlying source before promoting a material claim to verified evidence.

Ambient research is task-local by default. Persist to the vault only for an explicit research sweep, scheduled research maintenance, or a genuinely reusable finding that satisfies the reusable-knowledge rules.

---

## Delegation

Work directly when the task is simple, tightly coupled, or mainly sequential.

Use subagents when the user requests them or when they materially improve the work through:

* independent parallel work;
* context isolation for noisy exploration, logs, or tests;
* a genuinely separate specialist role;
* independent review or adversarial validation.

Prefer parallelism for read-heavy work.

For concurrent write-heavy work, use disjoint ownership or isolated worktrees. Do not let concurrent writers modify the same files.

A delegated brief should contain the information the child actually needs:

* objective;
* relevant task-specific context and established facts;
* scope or owned files when writing is allowed;
* material constraints;
* acceptance criteria.

Do not copy the entire global policy into every brief. Repeat a global rule only when the active host does not propagate it or the task specifically depends on restating it.

Do not assume a child inherits the parent's discoveries, hypotheses, conversation history, or unstated assumptions.

Do not recursively delegate unless it materially helps and the parent task permits it.

Review delegated results before relying on them.

---

## Shell execution

Use the host-native shell for the active operating system. On Windows, prefer PowerShell (`pwsh`). On macOS and Linux, use the host-native POSIX shell.

Shared instructions must not require `cmd.exe`-only, PowerShell-only, or Bash-only syntax unless the step is explicitly platform-scoped.

Avoid opening visible shell windows for non-interactive work. Use hidden or background execution only when a separate process is actually required.

---

## Worktrees

When a Git worktree is needed, place it outside the active checkout and outside any other repository checkout.

Prefer a user- or host-configured worktree root. Otherwise let the active host tooling choose an OS-appropriate temporary or application-data location.

Use one branch and one working directory per isolated write workstream.

Read-only agents do not need separate worktrees merely for isolation.

---

## Workspace search

For content inside an indexed workspace, prefer the host's indexed workspace-search capability when available.

Use shell search when:

* the target is outside the index;
* indexed search fails to locate a known target;
* the operation is mechanical rather than semantic or content discovery.

Host-local instructions define exact tool identifiers and fallback syntax.

---

## Skills

Skills live under the Hub's `skills/` directory, normally `~/.agents/skills/` when installed as the user hub.

`skills/superpowers/` is vendored and read-only.

Use the live skill catalog to decide whether a skill applies. When a skill is selected, read its `SKILL.md` before following its workflow.

For overlapping skills:

1. Prefer the skill that owns the domain or end-to-end lifecycle.
2. Prefer an orchestrating skill that explicitly composes the requested operations.
3. Use a generic capability skill only when no more-specific owner applies.

Before creating, merging, forking, or materially expanding a skill, use the `skill-ratchet` preflight workflow. The skill itself owns the detailed procedure and decision rules.

Do not create a new capability when an existing skill can responsibly be reused or extended.

When adding or changing shared skill frontmatter or `agent-runtime/` preferences, run `node scripts/verify-portable-skills.mjs`. Host-specific adapters must not be inferred when the capability registry marks their renderer unsupported or manual.

---

## Reusable knowledge

Before nontrivial work in an unfamiliar domain, consult `knowledge/INDEX.md` when a relevant stored entry could avoid rediscovery. Load only relevant hits.

After nontrivial debugging or tooling work, capture a reusable lesson only when it is novel, stable, and likely to help future work. Use `extract-approach` when that condition is met.

Do not create memory entries for routine work or duplicate existing guidance.

Use:

* `memory/` for episodic lessons and reusable approaches;
* `knowledge/` for stable domain facts.

---

## Runtime verification

When a project-local `.agents/skills/verify-*` skill exists and a task changes
observable runtime behavior, use that verifier before claiming completion when it
covers the affected surface.

- Unit tests, type checks, builds, and CI remain separate evidence and still run as applicable.
- A positive runtime receipt must name the exact current full Git HEAD. Any later HEAD change makes that positive receipt stale.
- `fail` means the driven behavior is wrong. `blocked` means required runtime coverage is incomplete. Neither is a pass.
- Do not require runtime driving for docs-only, type-only, or clearly internal behavior-preserving changes unless the change has material runtime risk.
- If no project verifier exists, do not silently invent one during unrelated work. Route creation or repair to `verification-harness` when the task needs that lifecycle.

---

## Documentation

Honor any source of truth defined by the project.

Otherwise:

* code, types, tests, and runtime behavior establish what the system currently does;
* requirements, contracts, specifications, and ADRs can define what it is supposed to do;
* ADRs should own durable architectural rationale;
* comments should explain non-obvious constraints or intent;
* navigation documentation should stay concise;
* do not duplicate information across multiple documentation surfaces without a reason.

Do not delete documentation merely because the implementation is self-explanatory. Preserve documentation that serves users, APIs, contracts, operations, onboarding, or architectural decisions.

---

## Completion standard

Completion requires the requested outcome, project-required and risk-appropriate verification, and repair of failures caused by the change unless a material blocker remains.

Do not claim completion from a plausible implementation alone. Do not broaden or repeat verification without a concrete reason.

Report material verification performed and any remaining uncertainty or blocker. If relevant verification cannot run, state the gap.
