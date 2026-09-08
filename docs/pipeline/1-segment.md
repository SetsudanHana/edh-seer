# Stage 1 — Segmentation

**Input:** a card's oracle text, keywords and type line.
**Output:** a numbered list of clauses, one per printed ability.
**Cost:** free. No model, no network, no database.
**Code:** [`segment()`](../../packages/tagger/src/segment.ts)

---

## Why this stage exists at all

The obvious design hands the whole card to the model and asks for structure back. That was measured
and rejected.

Across two identical extraction runs, **only 55% of cards produced the same structure**, while the
corpus-wide verb set came back byte-identical. So the model is stable about *what a sentence says*
and unstable about *how many abilities a card has and how they group*. Segmentation is where the
nondeterminism lives.

This stage takes that decision away from the model. Text is split here, deterministically, and the
model is handed a numbered list of slots it must fill one for one.

That buys a completeness check the pipeline had no way to make before: **a clause that produces no
record is an error rather than a silence.** That class of bug is what let Bitterblossom sit in the
corpus with zero abilities, indistinguishable from a vanilla bear.

## The eight clause kinds

Every line of oracle text lands in exactly one of these, and the kind decides what happens next.

| kind | what it is |
|---|---|
| `ability` | ordinary rules text |
| `keyword` | printed keywords only — "Flying, first strike", "Ward {2}" |
| `mode` | one bullet of a modal ability |
| `chapter` | a Saga chapter — "I —", "II, III —" |
| `level` | a Class level marker — "{3}{W}: Level 2" |
| `modal` | the line that introduces modes — "Choose two —" |
| `granted` | an ability granted in quotes — `... has "{T}: Add {C}."` |
| `reminder` | parenthetical reminder text only |

Read the current shape in [`ClauseKind`](../../packages/tagger/src/segment.ts); the fields each
clause carries are in [`Clause`](../../packages/tagger/src/segment.ts).

**`kind` is what makes the corpus affordable.** A `keyword` or `reminder` clause is inert: it never
reaches the model. A card whose entire text is "Flying" therefore costs nothing to process.

## What is decided here rather than asked

Two things the model is deliberately not consulted about:

- **`abilityType`** — spell, activated, triggered or static. It disagreed with itself on 3 of 20
  cards over a question with a mechanical answer (is Path to Exile's text a spell ability?), so the
  segmenter decides and [the persist gate](2-normalize.md#the-persist-gate) rejects an answer that
  contradicts it.
- **Clause ids.** They are 1-based and stable within a card. The model fills slots; it does not get
  to invent them.

## The failure mode this stage has actually had

**Inertness has bitten twice, both times the same shape.** Cycling and Extort live *entirely inside
reminder text* — the printed keyword carries no rules text of its own, so segmenting them as inert
made both mechanics invisible for months.

Where a keyword's reminder **is** the ability, it is handled separately at match time rather than
through the model:
[`augmentKeywordAbilities()`](../../packages/tagger/src/keyword-augment.ts).

The general lesson is worth stating, because it applies to every future keyword: *inert* means "the
printed words add nothing the type line does not already say". It does not mean "short".

## Running it

Segmentation is not a stage you run on its own — it happens inside
[normalization](2-normalize.md) and inside `derive-corpus`. To see what it does to one card, the
clause list is printed by the normalize dry run, which is the default:

```bash
set -a && source packages/tagger/.env && set +a
npx tsx packages/tagger/src/bin/normalize-corpus.ts --card "Skullclamp"
```

## A worked example

Skullclamp segments into three clauses, and the third is inert:

```
{id:1, kind:"ability"}  "Equipped creature gets +1/-1."
{id:2, kind:"ability"}  "Whenever equipped creature dies, draw two cards."
{id:3, kind:"keyword"}  "Equip {1}"
```

Clause 2 is the one that becomes a demand for a creature dying, three stages later.

---

Next: **[Stage 2 — Normalization](2-normalize.md)**, the only stage that costs money.
