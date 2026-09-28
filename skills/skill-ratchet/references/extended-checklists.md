# Extended Checklists and Design Philosophies

Reference for skill authoring. Load it only for publication or security review.

---

## Two Design Philosophies

Skills tend to fall into one of two patterns. Both are valid; they solve different problems.

### Pattern A -- Capability Primitives (tool wrappers)

The skill is a thin wrapper over a deterministic CLI or script. Logic lives in code. SKILL.md teaches the agent how to invoke it.

- **Adds:** new capabilities (search, email, browser, API access)
- **Reliability via:** shell tools, not prompts
- **Typical length:** 30-80 lines, mostly command examples
- **Use when:** the bottleneck is "the agent can't do X"

### Pattern B -- Process Primitives (cognitive disciplines)

The skill encodes a methodology the agent should follow. Pure prompt engineering -- no scripts needed.

- **Adds:** structured workflows (TDD, code review, design alignment, debugging loops)
- **Reliability via:** explicit procedure, checklists, validation loops
- **Use when:** the bottleneck is "the agent's output quality or process is bad"

A mature setup uses both. Pattern A gives the agent better tools. Pattern B gives it better methods for using them.

---

## Security Checklist

Before installing any third-party skill:

- Read every file in the folder
- Audit `scripts/` for outbound network calls, file access outside expected scope, command execution
- Check references for prompt injection ("ignore previous instructions...")
- Verify the skill name isn't typosquatting a popular one
- Run in a sandboxed environment first
- Pin to a specific version/commit, not `latest`

---

## Ship Checklist

Before publishing a skill:

- [ ] Frontmatter `name` matches folder name
- [ ] Description includes what + when + differentiator
- [ ] Description includes likely user trigger phrases
- [ ] No human-facing docs inside the skill folder
- [ ] No time-sensitive information
- [ ] Relative paths only
- [ ] State-check before action where applicable
- [ ] Validation loop documented
- [ ] Output format documented if relevant
- [ ] Tested with weak and strong models
- [ ] Tested for both correct triggering and correct execution
- [ ] Skill does one thing
- [ ] Composes cleanly with related skills
- [ ] Version controlled

---
## Provenance

The design-philosophy comparison and checklists above are adapted from David
Ondrej's MIT-licensed `effective-agent-skills`:
https://github.com/davidondrej/skills/tree/main/skills/skill-authoring/effective-agent-skills

Copyright (c) 2026 David Ondrej. The complete retained license notice is in the
repository's `THIRD_PARTY_NOTICES.md` and
`licenses/davidondrej-skills-MIT.txt`. Skill Ratchet's executable preflight,
evaluation contract, model parity, adversarial schema, regression locking, and
validators are original additions and are not represented as part of this
adapted checklist.
