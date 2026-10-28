# Penpot Design-with-AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `design-with-ai` with a safe Penpot MCP adapter while keeping one canonical product-design owner.

**Architecture:** Penpot is a progressive source/editing adapter under `design-with-ai`, not a new discovery surface. The adapter resolves a Penpot session, inspects read-only first, preserves project design authority, applies bounded reversible writes, and verifies the result. Authentication/configuration remains host-local and transport-agnostic.

**Tech Stack:** Agent Skills Markdown, JSONL routing/eval cases, Penpot MCP concepts, Node.js catalog/routing validators, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-28-penpot-design-with-ai.md`

## Global Constraints

- No top-level `penpot` skill.
- No Penpot credentials, credential-bearing URLs, session IDs, or host MCP configuration in the shared repo.
- Project-native design authority remains canonical.
- Penpot writes start only after target/session resolution and read-only inspection.
- Exact authentication mechanism is deployment/client-dependent; current OAuth and legacy token support are capability facts, not universal client configuration.
- Penpot server deployment/auth/proxy work is not owned by `design-with-ai`.

## Review Focus

- Penpot design tasks route to `design-with-ai` without making generic Penpot infrastructure requests route there.
- Multiple connected sessions cannot cause the agent to guess the file/session to edit.
- Design-system cleanup cannot create a parallel token/design truth.
- Write operations are bounded and followed by read-back verification.
- Secrets and credential-bearing URLs never become repository documentation or examples.

---

### Task 1: Lock routing boundaries with focused tests

**Files:**
- Create: `tests/skill-catalog/penpot-design-routing.jsonl`
- Create: `tests/skill-catalog/penpot-design-routing.test.mjs`

**Interfaces:**
- Consumes: existing live skill catalog routing scorer.
- Produces: deterministic positive Penpot-design and negative Penpot-infrastructure ownership boundaries.

- [ ] Add positive cases for Penpot design-system audit, screen creation, and approved visual token/style sync.
- [ ] Add negative cases for Penpot MCP server/OAuth deployment and generic protocol implementation work.
- [ ] Run via PR CI and verify RED if current discovery metadata cannot own the Penpot design cases cleanly.
- [ ] Commit test-only change.

### Task 2: Add the Penpot integration reference and routing hook

**Files:**
- Create: `skills/design-with-ai/references/penpot-integration.md`
- Modify: `skills/design-with-ai/SKILL.md`
- Modify: `skills/design-with-ai/UPSTREAM.md`

**Interfaces:**
- Consumes: resolved Penpot target/session, current project design authority, Penpot MCP capability.
- Produces: bounded read/write design workflow that remains under `design-with-ai`.

- [ ] Add Penpot conditional-intelligence/loading rule without widening generic design discovery unnecessarily.
- [ ] Add target/session resolution, read-only-first, intended-delta-before-write, small reversible writes, and read-back verification.
- [ ] Add remote/local capability and auth-agnostic guidance.
- [ ] Add upstream provenance pin and non-vendoring decision.
- [ ] Run focused routing and design skill structural checks; verify GREEN.
- [ ] Commit.

### Task 3: Extend Skill Ratchet acceptance coverage

**Files:**
- Modify: `skills/design-with-ai/tests/evals/cases.jsonl`
- Modify only if a real regression is found/fixed: `skills/design-with-ai/tests/evals/regression-cases.jsonl`, `regression-lock.json`

**Interfaces:**
- Consumes: Task 2 contract.
- Produces: inspectable acceptance criteria for Penpot ownership, authority, session ambiguity, denied writes, and instruction injection.

- [ ] Add Penpot positive/negative and adversarial cases without duplicating existing canonical A1-A6 meanings.
- [ ] Retain a regression only if branch development exposes and fixes a real failure.
- [ ] Run Skill Ratchet structural validation.
- [ ] Commit.

### Task 4: Regenerate repository metadata and verify

**Files:**
- Regenerate: `knowledge/INDEX.md`
- Regenerate: `knowledge/index.json`
- Modify README only if the current `design-with-ai` row needs a concise Penpot capability note.

**Interfaces:**
- Consumes: final design-with-ai frontmatter/reference tree.
- Produces: current generated discovery metadata and release evidence.

- [ ] Regenerate knowledge index.
- [ ] Run/observe full Release Governance.
- [ ] Review final diff for secret/config leakage and accidental top-level Penpot ownership.
- [ ] Run Skill Ratchet qualification as far as available review surfaces permit. Never fabricate the required independent Strong + Weaker receipts.
- [ ] Leave PR draft and unmerged until qualification is genuinely complete.
