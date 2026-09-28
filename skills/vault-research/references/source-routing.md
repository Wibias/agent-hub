# Source routing

Route by capability first. Provider names are implementation details.

Do not require one commercial engine for the research contract to work. Use the
best available read-only surface that satisfies the capability and record
coverage failures honestly.

## Local-first gate

Before external research, ask whether the uncertainty can be resolved by:

1. repository files or indexed workspace search;
2. local configuration, logs, tests, history, or generated artifacts;
3. a cheap safe deterministic experiment.

If yes, use the domain owner and stay local.

Escalate here when material uncertainty remains and external evidence can
reasonably resolve it.

## Capability matrix

| Capability | Preferred options when available | Fallback |
|---|---|---|
| broad web search | native web search, Parallel Search, Composio search-capable toolkit | targeted direct search/query URLs |
| full-page extract | direct fetch, Parallel Extract, Firecrawl | curl/direct HTTP when safe and sufficient |
| broad/deep research | native deep-research surface, Parallel deep research/task, bounded parallel researchers | sequential bounded passes |
| official docs/source | direct official URL, source repository | source-driven-development when implementation-specific |
| Reddit/HN/community | platform-native or connected read-only API/toolkit | web search with site/date filters |
| X | connected read-only X surface, official X API/MCP | narrow known-URL retrieval; label mirrors unofficial |
| YouTube | YouTube search plus youtube-transcript/yt-dlp | direct metadata only, marked insufficient for transcript claims |
| TikTok/Instagram/other social | connected read-only provider/toolkit | web-indexed public pages with partial-coverage label |
| current markets/forecast communities | domain source such as Polymarket when relevant | omit if not relevant or unavailable |

Provider availability changes. Discover current capabilities at runtime rather
than freezing a provider assumption into the skill.

## Parallel

Parallel is an optional high-quality backend, not a mandatory dependency.

When configured, it can satisfy:

- search;
- page extraction;
- deeper research/task runs.

Treat any generated Parallel summary as a lead. Fetch the cited underlying
source content before using a material claim as proof.

Do not reduce source diversity by routing every question through one provider.

## Firecrawl

Use Firecrawl when ordinary retrieval is incomplete, blocked, heavily
client-rendered, or otherwise unsuitable for extracting the source text.

Firecrawl extraction proves what the fetched page contains. It does not make the
page independent, current, or trustworthy by itself.

## Composio and connected services

Use connected read-only services for platform-specific coverage when available.

Discover tool names and schemas at runtime. Do not assume a remembered slug is
still valid. Missing, unauthenticated, rate-limited, or credit-exhausted
providers are coverage failures, not evidence of absence.

## Search and extraction discipline

Use this sequence for material claims:

```text
SEARCH -> SELECT -> FETCH/EXTRACT -> READ -> RECEIPT -> CORROBORATE
```

Do not stop at `SEARCH`.

For known primary sources, direct fetch can skip broad search.

## Source selection

Prefer:

1. primary/direct evidence relevant to the exact claim;
2. independent evidence that can test or contextualize the primary claim;
3. practitioner evidence for real-world use, friction, and sentiment.

Use aggregators mainly for discovery.

Avoid counting SEO pages, copied comparison tables, affiliate roundups, or
syndicated copies as independent corroboration.

## Coverage accounting

Track every material surface attempted.

A platform returning zero matches after a successful complete query is
`no-results`.

These states are not zero evidence:

- `partial`;
- `rate-limited`;
- `auth-failed`;
- `unreachable`;
- `timeout`;
- `schema-drift`;
- `skipped-unconfigured`;
- `error`.

When coverage is partial, narrow the conclusion to the evidence actually
observed.

## Delegation

Parallel read-only research units are useful when sub-questions or surfaces are
genuinely independent.

Do not spawn multiple agents merely to create numerical consensus. Use separate
reviewers when fresh context, independence, or adversarial checking materially
improves confidence.

The parent owns evidence integration and must detect copied lineages and
conflicts before synthesis.
