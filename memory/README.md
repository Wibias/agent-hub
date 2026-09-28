# memory/ - local episodic memory

The public Agent Hub ships the memory workflow, not a maintainer's personal memory history.

## Ownership

Use:

- `knowledge/` for stable facts and reference material;
- `memory/notes/` for reusable episodic lessons from verified solves;
- `rules/` for durable behavioral rules;
- `skills/` for repeatable workflows.

The installed Hub normally lives at `~/.agents`.

## Public templates versus local state

Tracked public files:

- `memory/README.md`
- `memory/MEMORY.example.md`
- `memory/pending-rules.example.md`
- `memory/notes/.gitkeep`

Local user state is intentionally ignored by Git:

- `memory/MEMORY.md`
- `memory/pending-rules.md`
- `memory/notes/*.md`

Do not commit personal notes, transcript-derived state, local absolute paths, credentials, cookies, tokens, or other operator-specific data.

## First use

`extract-approach` initializes missing local state through its deterministic helper:

```shell
node skills/extract-approach/scripts/ensure-memory-state.mjs
```

When the Hub is installed somewhere other than the default user location:

```shell
node skills/extract-approach/scripts/ensure-memory-state.mjs --hub-root "<agent-hub>"
```

The helper copies the public examples when available and otherwise creates minimal local files. Existing local files are preserved.

## Registry

Read `memory/MEMORY.md` first when it exists. It is the local topic index for `memory/notes/`.

Each note uses:

```markdown
# <Problem title> (YYYY-MM-DD)

**Tool/Context:** <tool or Multi>
**Tags:** <max 3 keywords>

## Observation
<Underlying problem and recognition cues.>

## Lesson
<Reusable decision rule.>

## Candidate for Rules/Knowledge?
<No | Yes - target>

## Links
- <repo-relative path, issue, or public documentation>
```

Keep one reusable insight per note. Prefer a machine-enforced invariant over prose when the lesson can be encoded cheaply in a test, type, lint rule, validator, or runtime check.

## Promotion

When repeated lessons justify a durable rule or stable fact:

1. record the candidate in local `memory/pending-rules.md`;
2. promote the durable owner to `rules/` or `knowledge/`;
3. keep the local episodic note only as historical context.

The public repository never needs the private episode history to use the skills.
