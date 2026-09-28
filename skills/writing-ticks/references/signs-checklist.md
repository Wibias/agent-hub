# Signs checklist (condensed)

Source: [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)  
(WP:AISIGNS / WP:AITELLS). Descriptive field guide — not proof of AI authorship.

Adapted for general prose (docs, blogs, email, proposals). Wikipedia-only markup
tells are marked **[wiki]**.

---

## Content

### C1 — Legacy / significance puff (`AILEGACY`)

**Watch:** *stands/serves as, is a testament/reminder, vital/significant/crucial/pivotal/key role, underscores/highlights its importance, reflects broader, symbolizing its enduring, contributing to, setting the stage, marking a shift, evolving landscape, focal point, indelible mark, deeply rooted*

Unsolicited "why this matters to history/society" claims, especially on mundane facts.

**Fix:** State the concrete fact. Drop the significance clause unless the user or sources demand it.

### C2 — Notability / media laundry list (`OVERATTRIBUTION`)

**Watch:** *independent coverage, national media outlets, trade publications, profiled in, active social media presence, widely-read outlets*

Lists of outlets as self-proof; parroting "significant coverage" language.

**Fix:** Cite one real source inline, or cut the résumé of press mentions unless the piece is about press.

### C3 — Superficial analysis (`SUPERFICIAL`)

**Watch:** trailing *-ing* clauses — *highlighting, underscoring, ensuring, reflecting, symbolizing, contributing to, fostering, encompassing, enhancing*; *valuable insights, align/resonate with*

Sentence ends with empty analysis no expert would bother saying.

**Fix:** End on the fact. If analysis is needed, make it specific and attributable.

### C4 — Promotional tone (`AIPUFFERY`)

**Watch:** *boasts a, vibrant, rich, profound, showcasing, exemplifies, commitment to, natural beauty, nestled, in the heart of, groundbreaking, renowned, diverse array*

Travel-brochure or press-release voice on neutral topics.

**Fix:** Neutral verbs (*has, is, includes*). Specific numbers and names beat adjectives.

### C5 — Weasel / vague authority (`AIWEASEL`)

**Watch:** *Industry reports, Observers have cited, Experts argue, Some critics argue, several sources* (when few exist)

**Fix:** Name who said what, or drop the claim.

### C6 — Challenges & future template

**Watch:** section titles *Challenges and Legacy / Future Outlook*; openers *Despite its… faces several challenges*; closers *Despite these challenges… continues to…*

Rigid essay outline bolted onto short pieces.

**Fix:** Mention real constraints only if true and useful. No obligatory optimistic coda.

### C7 — Title-as-entity lead **[wiki-heavy]**

Defining a list/title as if it were a proper noun: *"The List of X is a curated compilation…"*

**Fix:** Write naturally for the genre (for blogs: just start; for wiki: MOS lead).

---

## Language and grammar

### L1 — AI vocabulary density (`AIVOCAB`) — strongest surface tell

Cluster matters more than single hits.

| Era | Common cluster |
|-----|----------------|
| 2023–mid-2024 | Additionally, boasts, bolstered, crucial, delve, emphasizing, enduring, garner, intricate, interplay, key, landscape, meticulous, pivotal, underscore, tapestry, testament, valuable, vibrant |
| Mid-2024–mid-2025 | align with, bolstered, crucial, emphasizing, enhance, enduring, fostering, highlighting, pivotal, showcasing, underscore, vibrant |
| Mid-2025+ | emphasizing, enhance, highlighting, showcasing (+ C2 notability laundry) |
| Grok-ish | causal, empirical, correlate, underscore |

**Rule:** One incidental *key* is fine. Three+ from the list in a short paragraph = High.

**Fix:** Ordinary words. *Also* not *Additionally*. *Shows* not *showcases*. *Is important* only if you prove it.

### L2 — Copula avoidance

**Watch:** *serves as / stands as / marks / functions as / operates as / represents a*; *boasts / features / maintains / offers* instead of *has*; *refers to* for simple definitions

**Fix:** *X is Y. It has Z.*

### L3 — Negative parallelisms (`AIPARALLEL`)

**Watch:** *not only X but also Y*; *not just X — it's Y*; *It's not X, it's Y*; stacked *no … no … just …*

**Fix:** State the positive claim once. Contrast only when the audience holds a real misconception.

### L4 — Rule of three (`RO3`)

Decorative triples of adjectives or bullet themes with no information gain.

**Fix:** Use two items, one strong item, or a real exhaustive list.

### L5 — Elegant variation

Forced synonym cycling for the same entity every sentence (*the platform… the solution… the offering… the system*).

**Fix:** Repeat the clear name. Pronouns over thesaurus.

---

## Style / formatting

### S1 — Em dash cadence (`AIDASH`)

Em dashes (`—`) as default clause glue, especially multiple per paragraph.

**Fix:** Periods, commas, or parentheses. Occasional dash is fine; stack is a tell.

### S2 — Boldface / Title Case / emoji chrome

**Watch:** **bold** on random key phrases; Title Case Headlines Mid Sentence; emoji as section bullets in serious docs.

**Fix:** Bold sparingly for UI/docs convention only. Sentence case. No decorative emoji.

### S3 — Inline-header vertical lists

Every bullet starts with **Label:** explanation in perfect parallel — common LLM dump shape.

**Fix:** Prose, or bullets that are actually list items without fake category headers.

### S4 — Curly quotes / fancy punctuation

Smart quotes `“ ”` and decorative ellipses in plain-text contexts that usually use straight marks.

**Fix:** Match the house style (often straight ASCII for code-adjacent docs).

---

## Communication / scaffolding (often meta)

### M1 — Collaborative chatbot voice

*I hope this helps!, Let me know if you'd like me to…, Of course!, Great question!*

**Fix:** Deliver the content. Offer follow-up only if the channel expects it (chat).

### M2 — Knowledge-cutoff / gap hedging as filler

*As of my last training data…* when irrelevant; invented uncertainty theater.

**Fix:** Check live facts when needed; otherwise omit.

### M3 — Placeholder / template residue

`[Insert company name]`, `lorem`, `TODO example`, `Your Name Here`.

**Fix:** Real content or delete the section.

---

## Markup / citation residue **[often wiki or paste artifacts]**

### X1 — Model citation junk

`contentReference`, `oaicite`, `oai_citation`, `turn0search0`, `grok_card`, `utm_source=` spam, broken DOI/ISBN, `:::writing` fences.

**Fix:** Strip junk; replace with real citations or none.

### X2 — Markdown in non-Markdown surfaces

`**bold**` or `- ` lists pasted into plain email/wiki that expects different markup.

**Fix:** Convert to target format.

---

## Human-positive signals (not proof)

- Concrete, checkable details that are slightly awkward to invent
- Uneven sentence length; occasional fragments where the genre allows
- Willingness to say "unknown" / "I don't know" without a grand hedge
- Consistent personal or house voice across a long piece
- Ability to explain *why* a wording choice was made

## Ineffective as sole evidence

- Presence of correct grammar
- Use of any single watch-word in isolation
- Detector percentage scores
- Length alone
- "Sounds smart"

---

## Quick rewrite map

| Tick | Prefer |
|------|--------|
| *serves as a vital…* | *is a…* / cut |
| *This underscores the broader…* | delete or one specific consequence |
| *Not just X — it's Y* | *X, and Y* or just *Y* |
| *Additionally,* (sentence start) | *Also,* / merge sentences |
| *delve into / tapestry / landscape* | concrete noun |
| *Despite challenges… future remains bright* | real risk only; no pep coda |
| *nestled in the heart of* | place name + distance/relation |
| Triple adjective stack | one accurate adjective or none |
