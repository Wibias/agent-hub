# Capability Preflight

The preflight inventories routing surfaces before a skill is created, merged,
forked, or substantially expanded. It ranks candidates; the agent makes the
semantic decision after reading plausible matches.

## Default inventory

The cross-platform CLI checks existing locations when present:

- `$AGENTS_HOME/skills` or `~/.agents/skills`;
- `$AGENTS_HOME/rules` and `$AGENTS_HOME/AGENTS.md`;
- `$CODEX_HOME/skills/.system` and `$CODEX_HOME/plugins/cache`;
- optional project `AGENTS.md`, `.agents/rules`, `agent-rules`,
  `.cursor/rules`, `.agents/skills`, `.codex/skills`, and `.github/skills`;
- repeatable caller-supplied `--root` paths.

Missing optional roots are reported but are not fatal. Secret, credential,
VCS, dependency, and sandbox-secret directories are never inventoried.

## Ranking

Tokenize the query and routing surface, remove common stopwords, then compute:

```text
score = max(jaccard(query, surface), query_recall * 0.85)
```

Weight skill names by repeating them three times in the routing surface. In
`--discovery-only` mode, inspect only name and description. When a description
contains `Do not use for:`, two or more query-token matches in that negative
clause set the candidate score to zero.

The plausible cutoff is the greater of the configured threshold and 75% of the
top score. At most five near-best entries are marked plausible. Return the top
ten ranked entries.

## Duplicate handling

For skills with the same canonical name:

1. Keep the highest-priority copy.
2. Drop lower-priority copies with routing-token similarity of at least 0.80.
3. Keep materially different copies and add `variant_note`.

Rules and agent instruction files are never deduplicated by skill name.

## Classification

After `REVIEW_MATCHES`, read every `plausible: true` candidate and record:

- `REUSE`: complete coverage;
- `EXTEND`: correct owner, additive delta;
- `MERGE`: overlapping owners; human approval required;
- `CREATE`: all plausible candidates rejected with reasons.

After `NO_MATCHES`, inspect at most the top three near-matches before `CREATE`.

## Evidence safety

`--evidence` may write only inside the operating system temporary directory.
Containment is canonical and separator-aware: a sibling such as `/tmp-evil`
does not count as a child of `/tmp`.

Output ordering is deterministic: score descending, priority ascending, then
path ascending.
