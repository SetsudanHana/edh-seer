# Stage 4 — Matching

**Input:** every card's supply and demand, from [Stage 3](3-derive.md).
**Output:** `Reason[]` — one printable sentence per claim.
**Cost:** free. Pure functions, no I/O of any kind.
**Code:** [`eventMatches()`](../../packages/matcher/src/edges.ts),
[`subjectMatches()`](../../packages/matcher/src/subject.ts)

---

## The claim, and why it is a sentence

EDH Seer claims two cards work together only when it can print the sentence that says why:

> *"When Siege-Gang Commander dies, Skullclamp draws you 2 cards"*

**The `text` is the product.** An edge a player cannot check is worth nothing; every claim names both
cards and the mechanism, so it can be held against the card and disagreed with.

## The pair

| | verb | subject |
|---|---|---|
| Siege-Gang **supplies** | `dies` | `{control: you, subtype: goblin}` |
| Skullclamp **demands** | `dies` | `{control: you, type: creature}` |

Same verb, same controller, and a Goblin *is* a creature — resolved through a subtype-to-type
hierarchy generated from MTGJSON rather than hardcoded
([`gen-hierarchy.ts`](../../packages/matcher/src/bin/gen-hierarchy.ts)). So a claim forms:

```
tag        = "dies:creature"
effectKind = "draw-card"
text       = "When Siege-Gang Commander dies, Skullclamp draws you 2 cards"
```

## The order the gates run in

[`eventMatches()`](../../packages/matcher/src/edges.ts) is the whole decision, and the order is
deliberate — each gate assumes the ones above it have passed.

1. **Same verb?** `verbSatisfies`, which also carries the rules bridges (CR 120.3 lets a life-loss
   trigger accept a damage emit).
2. **Is the consumer's subject `restricted`?** Refuse. A targeting restriction is a demand nothing
   here can check.
3. **Instant-speed relaxation.** A producer that acts at instant speed and picks its own victim can
   satisfy a combat-state demand it never names — your sac outlet eating your own attacker.
4. **Origin compatible?** `originMatches` — token, not-cast, enters-tapped.
5. **Self-supplied?** `combatSelfSupplied`, `castSelfSupplied`, `selfEtbSelfSupplied`. A card must not
   satisfy its own trigger.
6. **Special-cased verbs.** A graveyard fill, a counter being added, and damage each route to their
   own comparison.
7. **Subjects compatible?** `subjectMatches`, through the hierarchy.

Two of those deserve their own note.

**Damage has two participants, and a dealer must be compared against a dealer.** A damage trigger
always names the source; the emit side did not, so an authored damage emit was checking a *victim*
against a *dealer* and could never match. Impact Tremors took 10 incoming `enters:creature` edges and
formed **zero** outgoing ones in a deck holding six cards that trigger on damage. A life-loss trigger
is the exception inside the exception: it watches the player who loses the life, never the dealer.

**A targeting restriction is refused rather than approximated.** Three corpus cards carry one on a
trigger subject and they made **108 reasons across the 71 calibration decks** — 59 from Leyline of
Resonance alone, every one of them false, because the type leaked out of a relative clause.

## The refusals

A large part of the code exists to say nothing. The governing rule is the same one the persist gate
follows: *a silent wrong answer is worse than a missing one.*

| refusal | why |
|---|---|
| **Self-reference** — "this creature", "this spell", the card's own name | reading these as a class once produced **74% of all false edges** |
| **Self-supplied triggers** — a creature's own attack satisfying "whenever a creature attacks" | the card would claim synergy with itself |
| **Unknown trigger events** | surfaced as `unknownTriggers` rather than snapped to a near-miss verb |
| **Unrepresentable restrictions** — "targets only", board states with no field | the ability keeps its kind and claims no cards |
| **Deck roles** — `tax`, `win-game`, `extra-turn`, `extra-phase`, and cost reduction | a pairwise edge would make the same claim beside every card in the deck |
| **Bare-type tutors** — "search for a creature card" | true of the whole creature base, so it distinguishes nothing |

The tutor line is the one most often misread, so state it precisely. Of 115 corpus search actions:

- **a bare type does not narrow.** Demonic Tutor reaches all 99 other cards; Worldly Tutor reaches the
  whole creature base. No claim.
- **a subtype, a stat predicate or a name does.** Flamekin Harbinger searching for an Elemental card
  genuinely relates to every Elemental in the deck. So does Imperial Recruiter's "power 2 or less",
  and The First Doctor searching for a card *named* TARDIS narrows hardest of all.
- **land finders are their own relation** (owner ruling, 2026-08-15, reversing a blanket exclusion).
  Farseek relates to the duals it can actually fetch, which is what lets a report say "your ramp finds
  4 targets for this colour and 11 for that one".

Some misses are permanent and documented as **ceilings** rather than bugs: "my tutor can find you"
and "my recursion could return you" are real synergies a producer-event/consumer-trigger model cannot
express at all.

## After the claim

`dedupeReasons` drops claims identical in every field a reader or a score can see — a producer with
two graveyard-fill events feeding a consumer with two recursion abilities printed the same line four
times, and inflated the edge score by four while it was at it.

What remains feeds everything downstream: per-card rating, archetype detection, theme ranking, and
the graph, where **tokens are nodes too** — so a token maker edges to the token and the token edges to
the payoff, rather than the maker claiming a relation it only has through an object.

## Checking it

Every one of these is free to run and none of them needs the network:

```bash
npx tsx packages/instruments/src/panel-score.ts          # precision AND recall on the frozen panel
npx tsx packages/instruments/src/population-compare.ts   # edges and reasons, before against after
npx tsx packages/instruments/src/eval-pairs.ts           # the compass
```

See [the runbook](../RUNBOOK.md#measuring-a-change) for what each number means and which ones may
never be quoted alone.

---

Back to **[How it works](../HOW-IT-WORKS.md)**, or on to the
**[schema reference](../reference/SCHEMA.md)**.
