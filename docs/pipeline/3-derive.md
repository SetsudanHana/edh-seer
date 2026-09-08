# Stage 3 — Derivation and implied events

**Input:** the `cardClauses` documents bought in [Stage 2](2-normalize.md).
**Output:** one `cardTagsDerived` document per card — typed abilities, with what each one watches for
and what it supplies.
**Cost:** free. Pure functions, no model, no network.
**Code:** [`deriveAbilities()`](../../packages/tagger/src/derive/derive.ts),
[`impliedEvents()`](../../packages/matcher/src/implied.ts)

---

## Why free matters more than it sounds

This is the stage where the pipeline's shape pays off. Derivation reads clauses that are already
bought and turns them into game events, so **the rules can be changed and the whole corpus re-derived
as often as anyone likes.** `DERIVE_VERSION` has been bumped to 114; every one of those bumps was a
semantic change re-run over the corpus for nothing.

That is the property that makes the engine improvable rather than merely built. A wrong claim is
fixable, not permanent.

```bash
npx tsx packages/tagger/src/bin/derive-corpus.ts            # re-derives what is stale
npx tsx packages/tagger/src/bin/derive-corpus.ts --force    # re-derives everything
```

## From a clause to an ability

An ability carries a **trigger** — what the card watches for — and **emits** — what it supplies.
Every field is in the [schema reference](../reference/SCHEMA.md#types); the shape reads like this:

**Siege-Gang Commander**
```
kind=triggered  effect=token-generation
  trigger: enters  subject={control:"you", type:"creature", self:true}
  emit:    create-token {control:"you", token:true, colors:["R"], type:"creature", subtype:"goblin"}
  emit:    enters       {control:"you", token:true, colors:["R"], type:"creature", subtype:"goblin"}

kind=activated
  emit:    sacrifice    {control:"you", subtype:"goblin"}
  emit:    dies         {control:"you", subtype:"goblin"}          <- the one that matters

kind=activated  effect=damage
  emit:    non-combat-damage {control:"any", scope:"target"}
```

**Skullclamp**
```
kind=static     effect=pump
kind=triggered  effect=draw-card
  trigger: dies  subject={control:"you", type:"creature"}          <- the demand
  emit:    draw  {control:"you"}
```

Note what derivation added that the printed text never said: sacrificing a Goblin means a Goblin
**dies**. That inference is the entire reason the pair in [Stage 4](4-match.md) forms an edge.

## Implied events: what no card prints

A card supplies events nobody wrote on it. A creature can be cast, can enter, can attack, can deal
combat damage — none of which its text mentions.
[`impliedEvents()`](../../packages/matcher/src/implied.ts) adds these, stamped with the card's own
printed characteristics.

Siege-Gang Commander's full supply list, as the matcher sees it:

```
create-token       {control:"you", token:true, colors:["R"], type:"creature", subtype:"goblin"}
enters             {control:"you", token:true, ..., subtype:"goblin", zone:"battlefield"}
sacrifice          {control:"you", subtype:"goblin"}
leaves             {control:"you", subtype:"goblin", zone:"battlefield"}
non-combat-damage  {control:"any", scope:"target"}
cast               {control:"you", type:"creature", subtype:"goblin", power:2, ...}   <- implied
enters             {control:"you", type:"creature", subtype:"goblin", ...}            <- implied
attacks            {control:"you", type:"creature", subtype:"goblin", ...}            <- implied
combat-damage      {control:"you", type:"creature", subtype:"goblin", ...}            <- implied
enters             {control:"you", subtype:"goblin", zone:"graveyard"}                <- a death fills a graveyard
```

Rules the game states but no card prints are added here too: a Saga sacrifices itself after its final
chapter (CR 704.5s), the legend rule kills a copy of a legendary permanent (CR 704.5j). No amount of
text parsing reaches those, because they are not written anywhere.

The neighbouring functions do the rest of that job:
[`keywordEvents()`](../../packages/matcher/src/implied.ts) for what a printed keyword implies,
[`sagaEvents()`](../../packages/matcher/src/implied.ts), and
[`impliedGraveyardEvents()`](../../packages/matcher/src/implied.ts), which is how a death becomes a
graveyard being filled.

## The refusals that live here

Derivation is also where the engine decides what it will *not* say.

**Self-reference is the largest defect family this project has had.** "This creature", "this spell",
and the card's own name all mean the card itself; reading them as a class produced **74% of all false
edges**. [`SubjectFilter.self`](../reference/SCHEMA.md#subjectfilter) carries the fact, and the gates
in [Stage 4](4-match.md#the-refusals) act on it.

An unrepresentable restriction keeps its ability and claims nothing. A trigger event outside the
vocabulary surfaces in `unknownTriggers` rather than being snapped to the nearest verb that happens
to exist. Both follow the same rule as the persist gate: **a silent wrong answer is worse than a
missing one.**

## A number worth reading correctly

Two populations get confused constantly, and confusing them understates a case by two orders of
magnitude:

- the **derived corpus** — the cards derived from the 71 calibration decks, 2,541 as of 2026-08-15
- the **corpus** — roughly 34,000 cards

A verb that reads "0 in the derived corpus" may be hundreds of cards corpus-wide. Say which
population a count came from, every time.

---

Next: **[Stage 4 — Matching](4-match.md)**, where supply meets demand.
