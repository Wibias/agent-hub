# Impeccable upstream

Agent Hub vendors the Impeccable skill from `pbakaus/impeccable`.

## Last fully adopted pin

- Upstream commit: `9fadc41729c38fd47d7ae622b501558653f9d2e9`
- Skill version: `4.8.0`
- Engine version: `0.1.18`
- Refreshed: `2026-11-04`

## Reviewed November 5, 2026: partial safe patch, update pending

- Reviewed upstream HEAD: `5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb`
- Adopted: `scripts/live-browser.js` from that HEAD, Git blob
  `cc049774b8247c478748fc487901fd38ef66514e`; its small
  nearest-pickable-ancestor hover fix is self-contained JavaScript.
- Deferred: `reference/init.md` and `reference/live.md` until a
  compatible published engine is available. They remain at the previous
  fully adopted pin. The newer `live.md` refers to
  `cssAuthoring.styleClose`, absent from the published Engine 0.1.18
  implementation (`engine-v0.1.18`, `crates/live/src/wrap_common.rs`).
  The newer `init.md` says the runtime mocks/review directories ignore
  themselves, but `ignore_runtime_output` was also added *after* the
  released engine tag (`crates/common/src/git.rs`).
- The newer Rust live-wrap, Vue preview/accept, and runtime clean-up fixes
  are also **not included in the published engine binary**. Engine
  `0.1.18` and its checksums have **not** been changed. Source HEAD alone
  is not a signed engine release.

The source registry therefore records `update-pending`, not `current`.
Before completing the vendor update, verify a published engine and the
`cssAuthoring.styleClose` / runtime-ignore contracts, then synchronize
the remaining references and complete all byte/behavior tests.

## Sync contract

Files shared with upstream under `.agents/skills/impeccable/` should
normally remain byte-identical under `skills/impeccable/`, except `SKILL.md`.
During this explicitly recorded partial update, `scripts/live-browser.js`
is the only deliberately cherry-picked upstream Shared File; all other
shared files stay at the last fully adopted pin.

`SKILL.md` is an intentional Agent Hub overlay. It preserves upstream
Impeccable workflow semantics while adding the local explicit-only discovery
boundary, repository-content instruction-injection handling, stricter
launcher failure evidence, competing-skill classification, and Skill Ratchet
qualification references.

Do not replace that overlay wholesale during an upstream refresh. Merge new
upstream `SKILL.md` semantics into it, then verify that local routing and
security boundaries remain intact.

After changing the overlay, regenerate the repository knowledge catalog with
`node knowledge/build-index.mjs` and commit the generated
`knowledge/index.json` and `knowledge/INDEX.md` outputs.

Target-only evaluation or integration files are local Agent Hub assets and
are not evidence of vendor drift. Agent Hub runtime-integration files that
were never present in the pinned upstream distribution are local overlays too;
an upstream refresh must preserve them unless a separate migration deliberately
retires them.
