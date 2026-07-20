# Scryfall Oracle Tags → Structured Vocab Crosswalk

**Date:** 2026-07-20
**Status:** Reference / vocab-coverage audit
**Source:** Scryfall Tagger functional tag list (offline HTML dump, `oracletag:` slugs only; artwork `art:` tags excluded).
**Related:** `docs/tagging-strategy.md`, Stage 2 spec (`docs/superpowers/specs/2026-07-19-stage2-structured-matching-design.md`).

## Why

Scryfall's community-curated *functional* Oracle Tags are the closest external analogue to our structured `cardTags`. This crosswalk normalizes them **from our schema's perspective** to answer one foundational question: **is our closed vocab (`EFFECT_KINDS`, `VERB_VOCAB`, `SubjectFilter`) complete enough that the extraction prompt captures every functional archetype the community recognizes?**

Otags are **not** adopted as a base for tagging (they are flat labels, noisy, partial coverage, and not in bulk data — only per-tag search harvest). They serve three downstream roles:

1. **Vocab coverage audit** (this document) — every functional otag family we cannot express is a prompt/schema gap.
2. **Soft-theme layer feed** (Stage-2.5, deferred edge class C) — the `synergy-*` / tribal / archetype otags are the theme vocabulary.
3. **Corpus-wide extraction cross-check** — `otag:<slug>` search vs our `cardTags` as a free, noisy validation signal at 38k-card scale.

## Key structural finding

Functional otag slugs already encode **base concept + subject filter** — the same decomposition as our schema:

| otag slug | our normalization |
|-----------|-------------------|
| `sacrifice-outlet-token` | `forced-sacrifice`, subject `token:true` |
| `sacrifice-outlet-artifact` | `forced-sacrifice`, subject `type:artifact` |
| `reanimate-from-opponent` | `graveyard-recursion`, subject `control:opp, zone:graveyard` |
| `cost-reducer-instant-sorcery` | `cost-reduction`, subject `type:[instant,sorcery]` |
| `untapper-land` | (gap) `untap`, subject `type:land` |
| `removal-token` | out of scope (interaction) |

So normalization is mostly **mechanical suffix-stripping**: split `<base>-<subject-suffix>`, map the base to our vocab, map the suffix to a `SubjectFilter` field (`type` / `subtype` / `token` / `control` / `zone`). 5289 functional otags collapse to **94 base concepts with family size ≥2**; the ~4700 singleton bases are card/set-specific noise (`cycle-stx-c-2c`, `abu-dual-land`).

## Bucket 1 — COVERED (vocab validated)

Every EFFECT_KIND / VERB below has a matching community otag family, confirming the concept is real and correctly named. No prompt change needed.

| Our vocab | Matching otag base(s) |
|-----------|-----------------------|
| `graveyard-recursion` | `reanimate`, `regrowth`, `recursion`, `restock`, `eternalize` |
| `cost-reduction` | `cost-reducer`, `alternate-cost`, `gives-castable` |
| `copy-spell` / `clone` | `copy` |
| `forced-sacrifice` + `sacrifice` verb | `sacrifice-outlet` |
| `token-generation` | `token-generator`, `repeatable-token-generator`, `conjure-*-creature` |
| `token-doubling` | `token-doubler` |
| `trigger-doubling` | `trigger-doubler` |
| `damage` | `burn`, `bombard` |
| `mana-generation` | `mana-rock`, `manarock`, `mana-dork`, `ramp` |
| `fast-mana` / `ritual` | `ritual`, utility mana-rocks |
| `speed-increase` | `extra-turn` |
| `top-manipulation` | `scry` |
| `counter-placement` / `enters-with-counters` | `gives-1-1-counters`, `removes-mm-counters` |
| `draw` verb / `draw-card` | `draw` |
| `discard` verb | `discard-outlet`, `discard` |
| `mill` verb | `mill`, `self-mill` |
| `gain-life` verb | `lifegain` |
| `pump` | `power`, `toughness`, `gives-deathtouch/lifelink/wither` (keyword grants) |

## Bucket 2 — GAPS (functional synergy, no clean vocab home)

Producer/consumer archetypes the community tags as functional that our closed vocab **cannot currently express**. These are the actionable output — candidates to add before scaling extraction.

| # | otag family (size) | Why it matters | Recommendation |
|---|--------------------|----------------|----------------|
| 1 | `flicker` (11) + `blink` (2) | Blink archetype. A flicker card **re-fires `enters` events** for ETB payoffs (Inalla-style). With no effect.kind for "flickers others", a blink card emits nothing and forms zero edges to ETB consumers. | **Add** `effect.kind: flicker` that emits `enters` on its subject. High value. |
| 2 | `untapper` (9) + `untap` | Untap lands/creatures = ramp and untap/tap combo enabler. No untap concept at all. | **Add** verb `untaps` (or effect `untap`) — mirrors existing `taps`. Medium. |
| 3 | `animate` (11) | Man-lands / animate-artifact become creatures; feed tribal, attack, sacrifice. No "becomes-creature". | **Add** effect `animate` emitting a creature characteristic. Medium. |
| 4 | `tapper` (8) + `tap-fuel` (5) | Forces others to tap / "tapped-matters" payoff. We have `taps` (self) but not the producer "I tap your stuff" nor the tapped-matters consumer. | **Defer** — niche; revisit with soft-theme layer. |
| 5 | `graveyard-fuel` (14) | Self-mill/discard that **fills the graveyard** to feed recursion/aristocrats consumers. Partly covered by `mill`/`discard` verbs, but "fills GY" as an emit isn't modeled. | **Consider** an emit hint; medium for reanimator edges. |
| 6 | `impulse` (24) + `conjure` (12) | Card advantage from exile-play / card creation. Partly `draw`. | **Soft** — treat as card-advantage theme, not structured. |
| 7 | `fling` (2) | Sacrifice + damage scaled by power. | **Deferred** (magnitude, already in Stage-2 backlog). |

## Bucket 3 — SOFT (theme layer, Stage-2.5 class C)

Not mechanics — archetype/"X-matters" themes. These ARE the soft-theme vocabulary; harvest via `otag:` search when class C is built.

`synergy-*` (Scryfall's own "matters" meta tags), `tutor`, `seek`, `consult`, `tribal`, `typal`, `cycle`, `sneak`, `cheat-death`, `storm-count-matters`, `storm-like`.

## Bucket 4 — OUT (not this engine)

Interaction / hate / protection / stax / removal / cosmetic — the synergy engine is producer/consumer, not interaction. Explicitly excluded so the prompt does **not** try to tag them:

`removal`, `counterspell`, `hate`, `hate-*`, `protects`, `rescue`, `lockdown`, `freeze`, `stun`, `damage-prevention`, `prevent`, `theft`, `donate`, `phasing`, `deanimate`, `turns-off-defender`, `color-change`, `type-errata`, `becomes`, `vanilla`, `french-vanilla`, `unique`, `eponymous`.

## Verdict

Foundation is sound: 18 of our vocab terms are independently confirmed by community otag families. The prompt has **three high-value gaps** worth closing before full-corpus tagging — `flicker`/blink (add effect.kind), `untap` (add verb), `animate` (add effect.kind) — plus `graveyard-fuel` as a lower-priority emit hint. All are producer-side (they emit events other cards trigger on), so closing them directly increases Stage-2 edge coverage.
