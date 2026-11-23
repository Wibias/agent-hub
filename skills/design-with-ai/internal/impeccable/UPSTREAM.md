> **AgentHub integration overlay (2026-11-23):** This internal provider is
> owned exclusively by `skills/design-with-ai/`, not a separately discoverable
> Impeccable skill. Historical skill 4.9.1 and engine 0.1.24 provenance remain
> below. The optional engine pin is now **0.1.28** with release-asset SHA-256
> checksums, but generic DWA routes never start it automatically. Updating the
> binary pin alone does **not** prove complete hook, Live/browser or command
> compatibility or qualify the complete upstream skill 4.10.0.
>
# Impeccable upstream

AgentHub selectively vendors the explicit Impeccable specialist from
[pbakaus/impeccable](https://github.com/pbakaus/impeccable). Runtime binaries
are **not** included in this repository. The local `SKILL.md` is an intentional
AgentsHub overlay, not a source-byte-identical upstream copy.

## Engine 0.1.28 upgrade candidate (2026-11-23)

Active engine version: `0.1.28`. The previous engine `0.1.24` pin remains
documented below as historical provenance. The original selectively vendored
skill contract remains `4.9.1` plus reviewed, explicitly adapted 4.10 methods;
this is an **engine release sync**, not an upstream 4.10.0 skill replacement.

- Official upstream tag `engine-v0.1.28`: annotated tag
  `020bfd2fff5ae3be247a506b1e528e522149046d` points to source commit
  `80f576894c6157cd895f749565e8755f8406bce2`. Asset publication:
  2026-11-19. <https://github.com/pbakaus/impeccable/releases/tag/engine-v0.1.28>
- At that source commit `scripts/VERSION` says 0.1.28, but the **stale upstream
  source manifest** `scripts/engine-checksums.txt` still lists 0.1.27 hashes.
  The tagged `skill-v4.10.0` snapshot also embedded 0.1.27. Therefore
  blindly copying that source manifest would reject the 0.1.28 release.
- AgentHub's 0.1.28 checksum manifest is reconstructed from the five **official
  GitHub Release asset SHA-256 digest fields**, one per supported asset, then
  locked by `tests/impeccable-engine-release-pin.test.mjs`. The Windows x64
  release checksum is
  `2fd0b53e8d9554f3f028a258fd958d39bd712b3eb4f1725363966ca2380f8c3e`.
- The Windows `impeccable.cmd` and POSIX `impeccable` release launcher blobs
  are unchanged between this AgentHub internal copy and the exact upstream
  `engine-v0.1.28` tag. Keep their checksum refusal and opt-in boundaries;
  no binary is committed to AgentHub.
- Standalone source-only JS detection remains independent from the Rust
  engine binary. Existing internal JS hook/Live helpers remain AgentHub-owned
  overlays, **not** byte-identical runtime-parity guarantees. The upstream
  `live-browser.js` changed after the prior skill release, but it also changed
  its protocol references to the upstream Rust server: do not overwrite the
  internal JS Live implementation without its own host/protocol compatibility
  tests.
- Release validation: Windows x64 pinned-engine launch/probe, a tampered
  checksum manifest refusal, Windows hook migration and Live loopback tests,
  a real Chrome Live smoke, and source/digest checks all must run for the
  **current PR revision**. A passing binary launch does **not** imply full
  product/Live/browser parity. Skill Ratchet's independent strong and weaker
  review receipts are still mandatory for complete DWA skill qualification.

Status: **binary source/digest pinned, full runtime qualification still
pending**. No new top-level `impeccable/SKILL.md` entrypoint is created.

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
