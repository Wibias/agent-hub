# Realistic worst-case data

Use only for executable `worst-case <surface>` stress testing. The goal is to
replace kind demo data with production-shaped pressure while preserving the real
component and its real data boundary.

## 1. Map before inventing

For every rendered value, record:

| Field | Source | Type | Real limit | Optional? |
|---|---|---|---|---|

Search validation schemas, form constraints, API types/contracts, persistence
schemas, and existing fixtures. When frontend and backend limits disagree, note
the wider source that can actually reach the UI. If no limit is discoverable,
record `unbounded` and use a believable long value rather than random filler.

Include easy-to-miss values: counts, dates, status/badge text, button labels from
data, tooltips, media URLs/aspect ratios, list length, permissions, and optional
metadata.

## 2. Build one production-shaped stress fixture

Prefer one mixed fixture that exercises many realistic failures at once. Keep its
shape identical to the normal fixture or API payload.

### Text and identity pressure

Cover applicable combinations such as:

- long compound or hyphenated names with diacritics;
- one- or two-character names;
- CJK text with no spaces and RTL names/content;
- emoji/ZWJ grapheme sequences where naive indexing can split a character;
- long unbreakable emails, URLs, UUIDs, paths, and filenames;
- translated labels that expand materially, including long German compounds;
- empty/whitespace-only optional strings and missing secondary fields;
- user-controlled strings that look like HTML/Markdown and must remain inert.

Look for overflow, accidental shrinkage, bad initials, orphan separators,
incorrect truncation, inaccessible ellipsis, and script/line-height clipping.

### Number and time pressure

Exercise `0`, `1`, large values, negatives, decimals, null/NaN guards, locale
formatting, live digit-width changes, future/past dates, timezone boundaries,
and long durations where relevant. Numbers used for comparison must remain fully
legible; do not solve overflow by truncating them.

Prefer locale-aware platform formatters over hand-built plural, date, currency,
or thousands-separator strings.

### Collection pressure

At minimum consider:

- empty;
- exactly one item;
- normal populated state;
- page-size boundary and page-size-plus-one when pagination exists;
- realistic large collection pressure when the UI may receive it;
- repeated/ambiguous labels and unusually large media/content rows.

Large collections test both visual resilience and whether the rendering strategy
needs pagination or virtualization. Do not claim a performance root cause without
measurement.

### Media and state pressure

Exercise missing/failed media, extreme source aspect ratios, slow-loading media,
partial records, loading/error/permission states, every status enum together, and
the current-user/self row when those states exist.

## 3. Inject through the real boundary

Change data, not markup. Use the same fixture, prop, mock, story, API stub, or
prototype input boundary the normal state uses. A CSS edit that manufactures
an overflow is not a data-stress test.

When authorized to write a harness, expose the states with URL-stable or local
dev-only switching according to the project's conventions. Useful states are:

`Demo | Worst case | Empty | One | Large`

Only include states that teach something. Switching itself is instant and the
harness is plain diagnostic chrome, not part of the design under test.

## 4. Environment pressure

Check the actual container first, then relevant extremes:

- 320px or the narrowest supported viewport/container;
- a representative wide layout;
- 200% browser zoom or large text pressure;
- RTL when supported or localization-ready;
- dark mode when supported;
- touch capability for controls that otherwise rely on hover;
- keyboard/open-soft-keyboard overlap for mobile input surfaces when material.

Rendered/browser evidence is preferred when tooling exists. If tooling is
missing, distinguish source-inferred risks from visually confirmed failures.

## 5. Common failure signatures

Use these as diagnostic leads, not universal CSS prescriptions:

- fixed-size icons/avatars collapse because flex shrinking is allowed;
- middle text columns overflow because they cannot shrink (`min-width: auto`);
- unbreakable identifiers push trailing actions off-screen;
- badges wrap when they need a deliberate single-line policy;
- fixed heights clip localized or large text;
- missing optional fields leave dangling punctuation or empty reserved rows;
- naive initials/string slicing breaks emoji, CJK, particles, or one-word names;
- raw numbers/dates leak locale or floating-point artifacts;
- failed images have no fallback or wrong aspect-ratio handling;
- hover-only actions disappear on touch;
- thousands of DOM rows reveal an unbounded rendering strategy.

The correct fix depends on field semantics: wrap, end-truncate, middle-truncate,
clamp, reflow, or never truncate. The user must still be able to recover the full
meaning of identity-critical truncated values.

## 6. Report before fixing

For each confirmed break record:

| Severity | Field/state | Stress value | Observed failure | Cause | Proposed fix |
|---|---|---|---|---|---|

Severity:

- **Broken**: information is wrong/unreadable or an action is unreachable;
- **Ugly**: usable but visibly malformed or inconsistent;
- **Fragile**: passes this fixture but lacks a real bound/fallback and is one
  plausible step from failure.

Separate ambiguous product decisions (wrap vs truncate, pagination vs
virtualization, placeholder vs omission) from mechanical fixes. After authorized
fixes, rerun every diagnostic state including the original Demo state.

Source lineage: adapted and consolidated from `emilkowalski/skills` `break-ui`
and its worst-case catalog (MIT), with Agent Hub ownership, security, and
verification boundaries applied.
