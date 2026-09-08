# Stage 2 — Normalization

**Input:** the numbered clause list from [Stage 1](1-segment.md).
**Output:** one `cardClauses` document per card — structured sentences.
**Cost:** MONEY. One model call per card, and the only paid step in the whole pipeline.
**Code:** [`normalize-card.ts`](../../packages/tagger/src/normalize-card.ts),
[`normalize-prompt.ts`](../../packages/tagger/src/normalize-prompt.ts),
[`bin/normalize-corpus.ts`](../../packages/tagger/src/bin/normalize-corpus.ts)

---

## What the model is asked to do, and what it is not

A language model runs **exactly once per card, months before anyone pastes a decklist**, and turns
printed oracle text into structured clauses. It never runs at analysis time.

That is not a cost-saving detail. It is what makes the tool answerable: the same decklist always
produces the same report, every claim traces to a rule, and the analysis needs no server to ask.

The pass is deliberately narrow. The model is asked what a sentence **is** — a trigger, an effect, a
subject — and never whether two cards are good together. It is a parser, not a judge.

```json
{"id":1,"abilityType":"triggered",
 "trigger":{"event":"enters","subject":"this creature","control":"you"},
 "actions":[{"verb":"create","object":"three 1/1 red Goblin creature tokens","amount":null}]}
```

## The three properties that make it safe to depend on

### One card per request

Batching several cards into one prompt was measured to **drop and duplicate clauses — 32 returned
where 39 to 41 were correct.** The Anthropic Batch API is used for its 50% discount, but it still
sends one card per request.

### A closed vocabulary

`event` and `verb` must come from fixed lists: **95 verbs, 117 triggers, 7 zones**, all enumerated in
the [schema reference](../reference/SCHEMA.md#the-normalization-vocabulary). An answer using a word
outside them is **refused and not persisted** — the card simply re-queues.

The lists are sized against what the *game* can express, taken from the Comprehensive Rules, not
against what the current decks happen to play. Normalization is a one-way ratchet: nobody re-runs
36,000 cards to add a word, so a gap discovered after the corpus is bought is frozen in. The
consequence is that a member with zero consumers today is still correct to include —
`becomes-blocked` reads 0 in the calibration decks and **164 corpus-wide**.

### The persist gate

Eleven defect kinds are checked before anything is written, listed with their meanings in the
[schema reference](../reference/SCHEMA.md#what-the-persist-gate-refuses). Invented clause ids,
duplicate ids, ability types that contradict the segmenter, unknown trigger events, a zone on a verb
that cannot carry one.

Ten of the eleven **reject**, which refuses the card so it re-queues. One warns and persists:
`dropped-prefilled-action`, because the pre-fill table it compares against is only ~96.7% precise, so
rejecting on it would fail ~3% of cards on *our* error and pay for them on every run, forever. Syr
Konrad is the worked case — three comma-separated trigger limbs defeat the single-comma split, and
the model is right where the table is wrong. It is still recorded, because a rising rate there is the
signal that the model has genuinely started dropping actions.

Governing rule: **a refusal is visible; a banked guess is not.**

## Running it

```bash
set -a && source packages/tagger/.env && set +a       # the .env is in packages/tagger/, not the root
npx tsx packages/tagger/src/bin/normalize-corpus.ts    # DRY RUN — prints the bill and spends nothing
```

**The dry run is the default and `--run` is the only thing that spends.** Read the printed
`provider:` line before every `--run`. Without `TAGGER_PROVIDER=anthropic` in the environment, a
spending bin falls back **silently** to Ollama — a corpus answered by the wrong model, with nothing
to say so. That trap fired three separate times before the line existed, and a fresh clone has no
`.env` at all.

Useful selectors, all of which narrow what gets bought:

| flag | what it selects |
|---|---|
| `--card "<name>"` | one card by name; repeatable |
| `--limit N` | at most N cards |
| `--below-version N` | cards whose stored `normalizeVersion` is under N |
| `--refresh-other` | only cards that fell back to the `other` escape hatch |
| `--commander-legal` | skips what cannot appear in an EDH deck |
| `--max-rank N` | the top N cards by play rank |
| `--batch` | the Batch API, at half price |
| `--concurrency N` | parallel requests, default 6 |

## What a re-buy costs

Measured, not estimated:

- the 2,453-card calibration corpus: **~$8.50**
- 1,408 cards through the Batch API: **$3.24**
- the top-20,000 tranche by play rank: **$33.42**

**Prompt caching has never fired on this workload and is 97.6% of every corpus bill.** Do not plan a
re-buy around it.

## The four version constants

Their current values are in the [schema reference](../reference/SCHEMA.md#version-constants); the
procedure for each is in the [runbook](../RUNBOOK.md#bumping-a-version-constant). The distinction
that matters here:

- `NORMALIZE_VERSION` identifies the prompt. **Free** to bump.
- `NORMALIZE_MIN_COMPATIBLE` decides what is stale. Raising it **re-buys the whole corpus**. Raise it
  only for a breaking change — an additive one (a new verb, a new trigger member) leaves it alone,
  because a new word only widens what the model *may* say and an answer given without the option is
  still correct.
- `VOCAB_VERSION` and `TRIGGER_VOCAB_VERSION` gate the cheap refresh selectors, and they are separate
  on purpose. One constant for both lists was measured to price 182 cards at $0.78 where ~140 of them
  were stuck on an `other` **action** that a TRIGGERS change could not possibly improve.

---

Next: **[Stage 3 — Derivation](3-derive.md)**, where structured sentences become game events, for
free.
