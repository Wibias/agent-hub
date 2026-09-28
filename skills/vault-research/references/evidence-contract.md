# Evidence contract

Use this contract for material external claims. Its purpose is to stop discovery
tools, copied reporting, popularity, and stale sources from being promoted into
facts without enough proof.

## Lead versus proof

A **lead** helps locate evidence. It does not establish a material claim by
itself.

Treat these as leads unless they are also the underlying source:

- search snippets and result cards;
- AI or tool-generated summaries;
- deep-research summaries that cite but do not expose the source content;
- rankings, recommendation lists, trend summaries, and engagement aggregates;
- another agent's synthesis;
- quoted fragments with insufficient surrounding context.

**Proof evidence** is the underlying material that can support or contradict a
claim: a fetched primary document, full relevant page, source code, raw dataset,
filing, changelog, full transcript, direct post, reproducible measurement, or a
strong independent source whose relevant content was actually retrieved.

A provider's summary can route the researcher to proof. It cannot upgrade
itself into proof.

## Evidence classes

Classify every evidence record:

| Class | Meaning | Typical examples |
|---|---|---|
| `primary` | direct authoritative evidence for what the source itself did, published, promised, or specified | official docs, changelog, filing, source code, first-party announcement |
| `direct-measurement` | reproducible observed behavior or raw measurement | benchmark run, captured API response, dataset result |
| `independent-secondary` | analysis or reporting independent of the subject and original evidence lineage | reputable reporting, independent lab test, technical analysis |
| `practitioner` | real-world experience or opinion from users/operators | Reddit, HN, X, YouTube, TikTok, forums |
| `aggregator` | discovery or synthesis layer | search result, comparison site, generated research summary |

Primary does not mean unbiased. It means direct. A vendor is authoritative
about its release notes, not automatically about its product's reliability.

## Claim types and corroboration

Do not apply a fixed "three sources" rule. Match evidence to the claim.

### Direct fact

Examples: a version added an API, a price changed, a company filed a document.

A single authoritative primary source can verify the claim when the claim is
about what that source directly controls or records. Without primary evidence,
seek at least two independent proof lineages.

### Performance, reliability, safety, or outcome

A first-party claim alone is insufficient.

Prefer either:

- a reproducible direct measurement relevant to the actual environment; or
- at least two independent proof lineages, with one independent from the
  subject making the claim.

State population, workload, environment, and date when they affect the result.

### Community sentiment, adoption, or "what people say"

Do not turn one loud account into a trend.

For a material community claim, target at least three independent accounts or
communities across at least two relevant surfaces when practical. Report it as
observed practitioner signal, not universal population truth.

Engagement is a weighting signal, not evidence that the underlying claim is
correct.

### Analysis or recommendation

Prefer one relevant primary source plus independent evidence, or at least two
independent proof lineages when no primary source exists. Preserve material
trade-offs and counter-evidence.

## Independence and evidence lineage

Count lineages, not URLs.

Every proof record has an `independence_group`. Sources that copy, syndicate,
quote, or derive the same underlying report belong to the same group unless they
add genuinely independent evidence.

Examples:

- five articles repeating one wire story = one lineage;
- three posts quoting the same benchmark = one lineage for the benchmark claim;
- an official release note plus an independent reproduction = two lineages;
- three unrelated practitioners describing their own deployments = three
  practitioner lineages.

When lineage is unknown, do not assume independence merely because domains
differ.

## Dedicated disconfirmation pass

For each material claim in a deep run, perform one bounded search whose only job
is to find why the claim may be wrong.

Look for:

- official corrections or changed documentation;
- issue trackers and incident reports;
- retractions and updated articles;
- failed reproductions or competing measurements;
- informed disagreement from independent sources;
- later evidence that supersedes an older claim;
- sampling, survivorship, or selection bias in community evidence.

Record credible contradictions. Do not discard them because the main narrative
already looks coherent.

## Hard verification gates

A claim may be marked `VERIFIED` only when all three pass:

1. **Correctness** - the cited evidence actually supports the exact claim and
   its scope.
2. **Recency** - the evidence is fresh enough for the claim's volatility and
   target time period.
3. **Source quality** - the evidence class, independence, and retrieval quality
   are sufficient for that claim type.

These gates use AND semantics. A majority vote across different dimensions is
invalid.

Independent reviewers are useful when they judge the same proposition. They do
not replace a missing gate.

## Freshness and expiry

Expiry controls when evidence must be rechecked. It does not mean historical
facts become false on that date.

Use the shortest reasonable volatility class:

| Volatility | Default TTL | Examples |
|---|---:|---|
| `volatile` | 7 days | live pricing, quotas, outages, active policy, current rankings |
| `fast` | 30 days | APIs, current product capability, recommendations, active ecosystem state |
| `medium` | 90 days | operational guidance, ecosystem maturity, non-daily market structure |
| `stable` | 365 days | mature standards, long-lived architecture guidance |
| `historical` | null | dated primary historical record that is not being used as evidence of current state |

Override the default when the domain is known to change faster or slower.

If `expires_at` is in the past, the claim cannot remain `VERIFIED` for a
current-state assertion until rechecked.

## Claim states

Use these states consistently:

- `VERIFIED` - applicable corroboration and all hard gates pass;
- `SUPPORTED` - useful evidence supports the claim but the strongest
  verification bar is not met;
- `CONTESTED` - credible evidence materially disagrees;
- `UNCONFIRMED` - evidence is thin, dependent, or only a lead;
- `STALE` - evidence exceeded the relevant freshness window;
- `BLOCKED` - required retrieval or coverage failed.

Do not soften `BLOCKED` into `SUPPORTED`.

## Structured receipt schema

Deep or durable runs may store JSONL records with three record types.

### Claim record

```json
{
  "record_type": "claim",
  "claim_id": "C1",
  "claim": "The API supports feature X in the current release.",
  "claim_type": "direct-fact",
  "material": true,
  "verification_status": "VERIFIED",
  "counterevidence_checked": true,
  "correctness_gate": "pass",
  "recency_gate": "pass",
  "source_quality_gate": "pass",
  "expires_at": "2026-10-27"
}
```

Allowed `claim_type` values:

`direct-fact`, `performance`, `community-sentiment`, `analysis`, `other`.

### Evidence record

```json
{
  "record_type": "evidence",
  "claim_id": "C1",
  "evidence_role": "proof",
  "evidence_class": "primary",
  "surface": "official-docs",
  "source_url": "https://example.com/docs/feature-x",
  "source_title": "Feature X",
  "source_author": "Example",
  "source_published_at": "2026-09-20",
  "observed_at": "2026-09-27",
  "last_verified_at": "2026-09-27",
  "independence_group": "example-official-feature-x",
  "stance": "supports"
}
```

Allowed `evidence_role`: `lead`, `proof`.

Allowed `stance`: `supports`, `contradicts`, `context`.

### Coverage record

```json
{
  "record_type": "coverage",
  "surface": "x",
  "source_status": "rate-limited",
  "observed_at": "2026-09-27",
  "detail": "Provider returned rate limit before the requested window was covered."
}
```

Allowed coverage status:

`ok`, `no-results`, `partial`, `rate-limited`, `auth-failed`,
`unreachable`, `timeout`, `schema-drift`, `skipped-unconfigured`,
`error`.

Only `no-results` means a completed search with zero matches.

## Validation expectations

`scripts/validate-receipts.mjs` checks structural invariants and the minimum
corroboration required for `VERIFIED` material claims.

The validator is a floor, not a substitute for judgment. Passing it does not
prove that a source is truthful or that the claim wording is correct.
