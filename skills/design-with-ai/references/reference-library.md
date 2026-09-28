# Design reference library adapter

Use the shared catalog before broad external research for standard and deep
non-motion work. The catalog lives outside this skill so its records are loaded
selectively rather than injected into every design context.

## Query contract

From USERPROFILE/.agents run:

    node knowledge/design-references/scripts/query.mjs --profile <profile> --surface <surface-family> --job "<single job>" --platform <platform> --dimensions <comma-separated-dimensions>

Use the surface taxonomy from
knowledge/design-references/taxonomy.json. Read the command's JSON output, not
the full catalog index.

- Exit 0 means the library supplied a complete fresh sample.
- Exit 2 means the output contains coverage gaps. Research only those gaps.
- Other non-zero exits are tooling failures and block claims that the library
  was used.
- Only reviewed, non-stale records count toward the profile sample.
- Map every selected record to one decision or open question before using it.
- Do not load cached images by default. Load a bounded visual subset only when
  text observations cannot resolve a visual decision.
When the requesting workflow is visual (restyle, redesign, build-product-surface,
or any visual-world decision), verify that the returned sample contains enough
visually inspected records (tag `visual-verified`) for the selected profile:
deep requires >= 8 across direct-domain plus adjacent-domain combined; standard
requires >= 4; quick requires >= 1. If the sample falls short, treat the
shortfall as a coverage gap and do targeted live research (rendered inspection)
even when coverageGaps is empty -- the library's structural coverage does not
certify visual evidence. Cached screenshots for visual-verified records live
under the user cache path recorded in each record's provenance and may be
loaded as a bounded visual subset for direction work.

## Returning new evidence

New live discoveries enter as candidates. Generate a template with:

    node knowledge/design-references/scripts/new-record.mjs --surface <surface-family> --stratum <primary-stratum>

Complete the record from the inspected underlying source. A different reviewer
must use review-batch.mjs before the record becomes reusable. Never edit a
candidate directly to reviewed, fabricate access, or count a directory page.

## Failure handling

If the catalog is missing, invalid, or has insufficient legitimate coverage,
record the exact gap and continue with the bounded source-evidence workflow.
Do not lower profile minimums, include stale records, or replace inspection with
vendor corpus claims.

