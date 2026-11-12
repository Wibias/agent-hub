# Impeccable upstream

Agent Hub vendors the Impeccable skill from `pbakaus/impeccable`.

## Release sync candidate (2026-11-12)

- Canonical source: `engine-v0.1.22`, commit `90b3072f0f7c9a7a85f64d6dd3db9cd94d364eff`.
- Metadata in the source: Skill version: `4.8.2`; Engine version: `0.1.22`.
- `skill-v4.8.2` is commit `035c8f319edd019936525a062fe99e83ca8d12c6`, 19 commits before the engine tag. The copied shared reference/runtime files come from the engine tag, **not** a mix of ad hoc HEAD files.
- Exception: the engine tag's `scripts/engine-checksums.txt` still contained 0.1.21 digests. The 0.1.22 binary digest manifest was published later upstream and is taken byte-for-byte from the recorded upstream `main` blob `956695b88090649ee8d6a3d27470066b38b62c8` **only after verifying its actual blob SHA**. The 0.1.22 checksum manifest is essential for the launchers; never ship a 0.1.22 VERSION with 0.1.21 checksums.
- Engine 0.1.22 source contains the previously deferred `cssAuthoring.styleClose` and `ignore_runtime_output` contracts; binary behavior still needs verification.\n- Shared files changed since the last complete adoption were synchronized from the above release pin. The Agent Hub `SKILL.md` remains an intentional local overlay with only its metadata version updated.
- This is a candidate until the versioned checksum/launcher tests, release-governance suite, source-byte checks and Windows launcher smoke have actually passed. Do not assert engine parity or executable readiness from source alone.

## Scope and boundaries

The previous complete vendor pin was `9fadc41729c38fd47d7ae622b501558653f9d2e9` (skill 4.8.0 / engine 0.1.18). A separate reviewed partial browser update came from `5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb`. This candidate supersedes that patch without dropping later upstream fixes.

Files shared with upstream under `.agents/skills/impeccable/` are byte-identical under `skills/impeccable/` when updated, except the intentional local `SKILL.md` and the explicit post-tag checksum manifest correction above. Agent Hub-only runtime integrations, tests and evaluation assets remain local.

The local `SKILL.md` preserves explicit-only invocation, design-with-ai routing ownership, repository instruction-injection handling, launcher failure evidence and Skill Ratchet qualification. Never replace it wholesale with upstream's broader auto-activation description.

After changing the overlay, regenerate the knowledge catalog using `node knowledge/build-index.mjs`, commit `knowledge/index.json` and `knowledge/INDEX.md` only if content differs, and run the catalog validator.

## Outstanding review

The source registry remains `update-pending` until the sync passes executable verification. Upstream `main` has advanced beyond the selected engine tag and is deliberately not included in this candidate. Inspect later changes separately; do not label them already adopted.
