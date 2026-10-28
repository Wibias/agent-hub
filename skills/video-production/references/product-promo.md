# Product Promo Production

Load for product, website, app, feature-launch, or named shot/recipe video work.
This reference adapts the useful production discipline from video-shotcraft while
keeping Agent Hub's renderer choice and design ownership authoritative.

## 1. Inspect before storyboarding

Do one bounded, read-only inspection of the real product or supplied source before
choosing shots. Establish:

- what the product is and which viewer action or understanding matters;
- the small set of features or states that are actually worth showing;
- which screens/states can be captured safely;
- the existing visual language: typography, colour roles, spacing/density,
  material, radius, iconography, and motion tone;
- missing, private, unstable, or misleading source material.

Do not modify the product merely to make capture easier unless the user has
separately authorised that product change.

## 2. Preserve product truth

When the film claims to show the real interface, prefer real screenshots or
controlled captures of the real product over a hand-built imitation. Use approved
demo, synthetic, or sanitized data when real states contain credentials,
customer/personal information, internal identifiers, secrets, or other sensitive
material.

A stylised abstract brand shot may be constructed from code. It must not be
presented as a real product state when it is not one.

## 3. Reuse the design authority

The film should grow from the product's accepted design language. Read the
project's existing design authority or compose with `design-with-ai` when a
reusable contract is needed. Do not create a second independent palette/token
ledger just because a renderer or upstream template has one.

Translate the product system into film decisions such as title scale, safe-area
usage, caption treatment, camera intensity, motion amplitude, transitions, and
material treatment. Shot structure may come from an upstream recipe, but the
visual skin belongs to the product unless the user explicitly chooses a new art
direction.

## 4. Storyboard communication beats

Each shot needs one primary communication job. Record at least:

- viewer takeaway;
- source screen/media/state;
- dominant motion idea;
- approximate duration and hold/rest after the information lands;
- transition purpose;
- caption or on-screen copy when needed;
- sound cue when sound materially supports the action.

Prefer deletion over packing several unrelated ideas into one shot. A shot should
not need decorative motion to explain what its focal point is.

## 5. Motion vocabulary

Use one dominant motion idea per shot. Camera moves, 2.5D depth, object assembly,
masking, typography, or interaction choreography can each be strong, but stacking
several as co-equal tricks usually weakens the message.

Named video-shotcraft recipes are reference vocabulary, not bundled Agent Hub
assets. When a named recipe or exact behavior is requested, inspect the current
upstream recipe and implementation through the read-only GitHub/source owner
instead of reproducing a stale local copy.

Keep a visible settling/hold period after key copy, product state, logo, or metric
lands. Fast motion without readable rest is not a successful promo.

## 6. Sound and music

Sound design should reinforce visible causality rather than decorate every frame.
Use impacts, risers, clicks, texture, or ambience only where they support the
film's structure.

Beat-sync is conditional:

- if music is part of the brief, align important cuts and motion accents to a
  measured musical grid or real transients when tooling permits;
- if no music is requested, do not add a beat-analysis workflow merely because
  the upstream methodology supports one;
- never let beat timing make key information unreadable.

## 7. Finish with artifact review

Review the storyboard and implementation against the product, not just against
an upstream demo. Then use `verification.md` for preview/frame and final-render
evidence.

A cinematic result that misrepresents the product, leaks private data, or loses
its information hierarchy fails even if the animation is technically impressive.
