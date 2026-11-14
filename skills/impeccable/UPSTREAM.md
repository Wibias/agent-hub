# Impeccable upstream

AgentHub selectively vendors the explicit Impeccable specialist from
[pbakaus/impeccable](https://github.com/pbakaus/impeccable). Runtime binaries
are **not** included in this repository. The local `SKILL.md` is an intentional
AgentsHub overlay, not a source-byte-identical upstream copy.

## Release candidate (2026-11-14)

- Pinned `skill-v4.9.1` and `cli-v4.9.1`: commit `acb4cfe14470b1fdf51e855431af618d936b7db8` (same release commit).
- Source skill version: `4.9.1`; source `scripts/VERSION`: `0.1.24`.
- Engine release `engine-v0.1.24`: commit `6418f185eeceddda2cdb6ea93c5c58c7f319416e`.
- The `scripts/engine-checksums.txt` asset digests match the official
  `engine-v0.1.24` release metadata. Windows x64 binary SHA-256:
  `c4e71217677f53beaabec1cd4823a9bb2587355615f1170cf5508e69be4587bc`.
- Shared files that differ from the prior vendor snapshot are copied **verbatim**
  from the pinned skill release. `reference/foundations.md` was added; the
  Windows and POSIX launchers, runtime-browser helper, release manifest, and
  changed craft reference files are synchronized. Unchanged shared files
  retain their existing Git blobs.
- The local `SKILL.md` advances metadata to `4.9.1` and preserves
  **explicit-only** routing, `design-with-ai` ownership of generic UI work,
  repository instruction-injection handling, correct launcher failure evidence,
  conditional craft-floor loading, and Skill Ratchet qualification.
- New engine capabilities include opt-in `world`, `walkthrough`, and
  `foundations`. They do **not** authorize starting remote/binary processes
  without the selected host's permissions.

**Status: update-pending until test evidence.** Source integrity, a pinned
manifest and structurally valid text are not proof that the Windows binary
launches, that a downloaded artifact is trusted, or that the changed live
browser path behaves correctly. The Windows workflow tests a positive
engine-probe and a tampered-manifest rejection. Skill Ratchet model reviews
and any user-specific native/browser E2E still need their own receipts.

## Verification state and source-file parity

Skill version: `4.9.1`. Engine version: `0.1.24`. Exact runtime verification
is required before declaring the Windows launcher ready. The prior
`cssAuthoring.styleClose` and `ignore_runtime_output` behavior contracts
remain part of the imported engine history and require executable evidence.

Files shared with upstream are copied verbatim from the tagged release, except
for the intentional local `SKILL.md` overlay. AgentHub-only integration files
have no upstream counterpart and remain under their existing local owners.

## Boundaries and prior history

- Prior candidate: `engine-v0.1.22`, commit
  `90b3072f0f7c9a7a85f64d6dd3db9cd94d364eff`, skill `4.8.2`.
- Earlier complete source pin: `9fadc41729c38fd47d7ae622b501558653f9d2e9`.
- Earlier independent browser patch: `5af4319c4e7a7ee3e2b9fe899bcfb21c6190cb`.
- `skills/design-with-ai/scripts/providers/scan.mjs` still invokes AgentHub's
  independently vendored JS detector, **not** this Rust release binary.
  Do not claim detector parity between these paths.
- `skills/impeccable/scripts/` also contains independent AgentHub integration
  and test helpers, retained unchanged by this release sync.
- Upstream `main` after the pinned release is outside this update. Avoid
  mixing unreviewed post-release commits with the selected source set.
- Regenerate `knowledge/index.json` and `knowledge/INDEX.md` after a
  `SKILL.md` change. Do not declare installation or runtime parity solely
  from a passing source-byte test.
