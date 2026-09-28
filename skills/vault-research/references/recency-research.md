# Recent community research

Use this profile when the question is about what people are saying, using,
complaining about, adopting, or changing now.

Default window: **last 30 days**.

Use the user's explicit time window when supplied. For very fast-moving topics,
a shorter window may be more representative.

## Goal

Measure recent practitioner signal without confusing popularity with truth.

The output should answer:

- what themes recur;
- which claims have cross-source support;
- what changed during the requested window;
- which claims are only hype or single-account anecdotes;
- where coverage is incomplete.

## Relevant surfaces

Choose surfaces that fit the topic. Typical options:

- Reddit;
- Hacker News;
- X;
- YouTube, including transcript evidence;
- TikTok;
- Instagram / Threads;
- GitHub issues, discussions, releases, and repository activity;
- specialist forums or communities;
- Polymarket or other forecast/market communities only when the question is
  genuinely about expectations, probabilities, or market belief.

Do not query every surface mechanically.

## Collection

For each surface:

1. use a date-bounded query when the provider supports it;
2. record coverage status;
3. keep source date and observation date separate;
4. retain author/account/community identity for practitioner evidence;
5. capture engagement metadata when useful, but never treat it as truth;
6. fetch full context for material posts, threads, articles, or transcripts.

A YouTube title or thumbnail is not transcript evidence.

## Ranking recent signals

Use a qualitative combination of:

- relevance to the exact question;
- recency within the requested window;
- independence from other observations;
- concrete mechanism, example, or reproduction;
- engagement as a weak popularity signal.

Do not let large follower counts override stronger direct evidence.

## Community claim floor

For a material "people are saying" claim, target at least:

- three independent accounts or communities;
- across at least two relevant surfaces when practical.

If that floor is not reached, keep the observation `UNCONFIRMED` or state it
as a narrow anecdote.

Do not generalize from sampled communities to "users" or "the internet" without
a sampling basis.

## Counter-sweep

Search specifically for:

- people reporting the opposite result;
- negative or failed experiences;
- corrections and deleted/updated claims;
- accusations of astroturfing, affiliate incentives, coordinated promotion, or
  copied talking points;
- older recurring claims that are being resurfaced as if new.

A strong counterexample may turn a trend claim into `CONTESTED` even when the
positive side has more engagement.

## Synthesis

Separate:

- **Observed signal** - what appeared in the sampled window;
- **Verified fact** - what independent or primary evidence establishes;
- **Interpretation** - what the pattern may mean;
- **Coverage limits** - which surfaces failed or were not available.

If the sampled community is narrow, name it.

## Persistence

Recent-community findings expire quickly. Use the `volatile` or `fast`
freshness class unless there is a clear reason not to.

A later sweep should update the existing topic page rather than create a chain
of duplicate conclusions with no reconciliation.
