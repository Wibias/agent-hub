# Superseded qualification case R7 (2026-09-21)

This fixture was superseded by the single-owner DWA/Impeccable integration in
AgentHub issue #404. The original case is preserved verbatim below with its
original SHA-256. Its expectation to load a standalone Impeccable SKILL.md
is deliberately retired because that skill is no longer discoverable.

Original SHA-256: `7147d18ff5a0b23caba78eb33f57806c6c1f2226061cf9dfaa136d3a6e03c590`

```json
{"id":"R7","category":"regression","invocation":"implicit","prompt":"make this settings screen look better, and use impeccable if useful","expected_skill":"design-with-ai","expected_resources":["SKILL.md","references/hard-invariants.md","references/design-methods.md",".agents/skills/impeccable/SKILL.md"],"unnecessary_resources":[],"assertion_ids":["both-plausible-skills-opened","classification-recorded","design-with-ai-owns-general-visual-work","impeccable-remains-bounded-specialist"],"scenario":"Retained A5 qualification failure: a user-named optional specialist was plausibly competing, but the routing contract did not explicitly require opening both skill contracts and recording the ownership classification before proceeding. The workflow must classify the named specialist without treating optional mention as specialist invocation.","added":"2026-09-21"}
```

The active R7 retains the same user prompt and DWA owner but tests that an
optional Impeccable mention never starts an engine or loads a second skill.
Active replacement SHA-256: `719b508b975f14d409867199ac5655b458c87d48768f06947114010a4eb55f17`
