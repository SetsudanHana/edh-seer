# Grammar and derive: duplicated work, gaps in both directions, and the tasks (2026-10-04)

A review of the setup after #896 (the card grammar) landed, asked by the owner on 2026-10-04:
"I am afraid we are doing duplicated work in some areas, or we have something that grammar
supports but derive does not, or the other way around." Every claim below names the file and
line it was read from; re-check before acting, as the engineering log's own rule says.

This file is written to be handed to a Claude Code session. Each task says what to change,
where, how to measure it, and what must not move.

## The shape today

```
oracle text
  -> segment()                                       tagger/src/segment.ts
  -> MODEL (paid, once per card)                     bin/normalize-corpus.ts  -> cardClauses (Mongo)
  -> ClauseRecord[] (strings: trigger {event,subject,control}, actions {verb,object,...})
  -> deriveCardTags()                                derive/derive.ts         -> cardTagsDerived
       inside derive, per clause:
         withGrammarActions()   calls grammar/action.ts  parseActions(text)   derive.ts:1471
         grammarTriggersOf()    calls grammar/trigger.ts parseTrigger(text)   derive.ts:1553
         subjectFrom()          calls grammar/filter.ts  parse(text)          derive.ts:757
         everything else        regex over the clause text (the "stored path")

#896 task 7 adds a second producer of ClauseRecord[]:
  oracle text -> grammarClauseRecords()              grammar/clause-record.ts
              -> ClauseRecord[] spelled "as the store writes it"
              -> the SAME deriveCardTags() above, which re-runs the grammar on the same text
```

`bin/derive-corpus.ts` derives every card from the stored answer, then, when the grammar reads the
card completely, derives it AGAIN from the grammar records, diffs the two (`grammar/derive-diff.ts`),
and keeps the grammar's when the diff is empty or its group is labelled "grammar right" in
`packages/tagger/grammar-only-triage.json`. Measured in #960: 23,074 of 32,057 cards derive from
printed text; 82.4% of complete cards derive identically.

## Findings

### F1. The seam flattens typed readings to strings, and derive re-parses them

`grammar/clause-record.ts` takes `ActionReading` (a typed `object: SubjectFilter`, `actor`,
`counter`, `fromZone`, `toZone`, `condition`) and `TriggerReading` and writes the model's string
conventions: `objectWords()` (lines 69-90), `actionsOf()` (lines 125-247), the trigger as three
strings (line 266). The phrase "as the store writes it" appears about forty times in that file.
Derive then re-reads the strings with `parseSubject`, `counterKindOf`, `references.ts` and the
rest of the stored path.

Cost: every rule in `clause-record.ts` exists only to imitate the model's spelling. Each of the
three labelling rounds (#958, #959, #960) was mostly fixes to that imitation, not to reading.

### F2. Derive re-runs the grammar on text the grammar already read

For a card on the grammar path: text -> grammar -> strings -> derive -> grammar again on the same
text -> merge. Concretely, per clause:

- `withGrammarActions` (derive.ts:1469) calls `parseActions` on every clause with actions, then
  aligns the readings to the stored actions by verb family and rewrites fields.
- `grammarTriggersOf` (derive.ts:1548) calls `parseTrigger` on every triggered clause.
- `subjectFrom` (derive.ts:755) calls the filter grammar `parse` on every subject string.
- `deriveCardTags` (derive.ts:2815) calls `parseActions` once more over every static clause for
  `creatureOnlyIf`.
- `segment()` runs six times per derive: five in `derive-input.ts` (`clauseTexts`, `clauseFaces`,
  `grantedTokenClauses`, `clauseRequires`, `clauseCosts`) and once in `grammarClauseRecords`.
- `derive-corpus.ts` runs `deriveCardTags` twice per complete card on every run (lines 64-72).

### F3. Grammar reads it, derive drops it

| field | set by | read by |
|---|---|---|
| `ActionReading.object` (typed `SubjectFilter`) | grammar/action.ts | nothing; `clause-record.ts` writes the words, derive re-parses |
| `ActionReading.actor` | grammar/action.ts | only to pick which words to write (clause-record.ts:143-152, derive.ts:1500-1512) |
| `Action.condition` | derive.ts:1527 via `withGrammarActions` | nothing (canonicalize.ts:50: "nothing reads it yet") |
| `TriggerReading.oncePerTurn` | grammar/trigger.ts:795 | nothing in derive (one mention, in a comment, derive.ts:1400) |
| `TriggerReading.condition`, `narrowing`, `damage` | grammar/trigger.ts | derive.ts:1567-1580, but ONLY on the in-derive call; `ClauseRecord.trigger` cannot carry them, so the clause-record path loses them and derive recovers them by re-parsing |
| `ActionReading.phrase` | grammar/action.ts | clause-record.ts only |

### F4. Derive reads it, grammar does not

Still regex over clause text, with no grammar reading behind them: `derive/recipient.ts`,
`references.ts` (antecedents), `replacement.ts` (CR 614), `repeats.ts`, `threshold.ts`,
`scaling.ts`, `event-count.ts`, `event-amount.ts`, `payment.ts`, `doubles.ts`, `reduction.ts`,
`markers.ts`, and the subject gates in derive.ts itself. Clauses with no printed trigger word, a
reflexive "when you do", and a mid-sentence delayed trigger stay on the stored path (derive.ts:1894).
Tail keyword actions (prepare, empower, recruit, cloak, vote) are "read for the census only"
(DERIVE 255 note). `parseSubject` (derive/subject.ts, 783 lines) remains the fallback for every
subject the filter grammar refuses, and `matcher/src/implied.ts` still imports it directly.

Coupling, measured with `git log --since=2026-09-20 --name-only`: 13 commits touched both
`grammar/` and `derive/`, 2 touched grammar alone, 5 derive alone.

### F5. The paid step does not use what the grammar earns

#896 task 7's deliverable: "A card whose every clause parses completely skips the paid normalize
call. The cost saved is reported." `bin/normalize-corpus.ts` contains no reference to the grammar
(grep "grammar|complete": none). `needsNormalize` (clause-store.ts:72) checks only `segmentHash`
and `normalizeVersion`. So the model is still bought for every card whose answer the switch then
overrides. For a new set this is the largest duplicated work in money.

### F6. Keywords are handled in four places

- `tagger/src/keyword-augment.ts` (connive, toughness-matters), reached only by `extract.ts`, the
  pre-derive flat-tagging path that now serves only `bin/score-gold.ts` and `extract.test.ts`.
- the keyword table in `derive/emits.ts` (connive -> draw + discard, explore, bolster, ...).
- keyword actions in `grammar/action.ts:868-883` (explores, connives, endures, is goaded, fights).
- `matcher/src/implied.ts` `keywordAbilities()` and `keywordEvents()`, plus `derive/cr-keywords.json`
  read by both derive.ts:990 and matcher/edges.ts:35.

### F7. Measurement artifacts live in the runtime package

In `packages/tagger/`: `phrases.jsonl` 1.4 MB, `triggers.jsonl` 632 KB, `actions.jsonl.gz` 716 KB,
`grammar-triage.json` 188 KB, `grammar-only-triage.json` 18 KB; in `src/derive/`:
`repeats-refused.json` 812 KB, `intervening-if-unrepresented.json` 30 KB. Only `cr-keywords.json`
and `token-types.json` are imported by runtime code. `grammar-only-triage.json` is imported by
`derive-corpus.ts` and so is runtime for the pipeline. The triage is keyed on diff-group strings
that move whenever either parser changes, so every grammar fix re-opens labels.

### F8. The test suite is one corpus ratchet

`npm test -w @edh-seer/tagger`: 64 files, 1,052 tests, 51 s. `grammar/action.test.ts` alone is
46 s: its last test (line 551) gunzips `actions.jsonl.gz` and parses all 32,406 census rows as a
per-family coverage ratchet. CI runs the suite twice (node 24, node 26).

### F9. derive-corpus is serial and chatty

`bin/derive-corpus.ts` does, per card, `findOne` on the derived row, `findOne` on the card, and
`updateOne`: three round trips times 32k cards, no `bulkWrite`, no worker pool, though
`@edh-seer/data/parallel` and `matcher/src/partners-parallel.ts` already provide one.

### F10. The docs do not know the grammar exists

`docs/pipeline/1-segment.md` through `4-match.md`, `docs/RUNBOOK.md`, `docs/HOW-IT-WORKS.md`,
`CONTRIBUTING.md` and `packages/tagger/RUNBOOK.md` contain zero occurrences of "grammar"
(`grep -c -i grammar`). `2-normalize.md` still presents the model as the parser. The engineering
log's last entry is 2026-09-17; #896 shipped about twenty PRs between 2026-09-30 and 2026-10-04.
Only `docs/reference/SCHEMA.md` (generated) mentions the filter grammar. The design spec
`docs/superpowers/specs/2026-10-02-card-grammar-model-free-design.md`, cited in
`instruments/src/grammar-only.ts:1`, is not in the repository.

### F11. Deployment: sound shape, one point of failure

Static site on Cloudflare Pages, Pages Functions for prerendered pages, one Worker for imports,
analysis in the browser. No runtime server. Content-hashed shard directories cache correctly.

The failure point is data: Mongo exists only on the owner's machine, `static-out/` is built only
there (`web/scripts/assemble-deploy.mjs:10-15`), the deploy runs only from there
(`docs/RUNBOOK.md` "Rebuilding and deploying"), and nothing dumps or restores `cardClauses`
(grep "mongodump|backup|restore" over docs, scripts, data/README: none), the collection
`clause-store.ts:1-11` calls "the one artifact this pipeline promises never to re-buy". The grammar
is now the best redundancy for it: 23k of 32k cards re-derive from Scryfall text alone.

## Tasks, in order

Each is one PR. Measure with the existing instruments (`panel-score`, `compass`, G4 on the 71
decks and 197 precons) and say the numbers in the PR body, as #957 and #960 do. H1 from #896
holds: no test loosened, no ratchet lowered.

### T1. Skip the paid call for grammar-complete cards (F5)

- In `bin/normalize-corpus.ts`, before queueing a card, call `grammarClauseRecords(card)`; if
  `complete`, do not buy. Print the count and the money not spent in the dry run.
- Keep a `--buy-complete` flag for the case where the owner wants the model's answer for
  labelling a new group.
- `needsNormalize` is unchanged: a bought answer is still kept and still used for cards the
  switch keeps on "model".
- Report: cards skipped, dollars saved, from a dry run over the current corpus.

### T2. Stop deriving twice (F2, F9)

- Store on the derived row: `clauseSource` (already there), `grammarComplete: boolean`,
  `grammarDiffKey: string | null`, and the `DERIVE_VERSION` they were computed at.
- In `derive-corpus.ts`: derive from the grammar first when the card is complete. Run the
  stored-path derive only when the key is unknown for this `DERIVE_VERSION` or the group is not
  labelled "grammar right". Keep `lostClaims` as the guard.
- Batch the Mongo work: one `find` over `cards` with a projection, `bulkWrite` in chunks of 500,
  and the worker pool from `@edh-seer/data/parallel` for the derive itself.
- `instruments/src/grammar-only.ts` keeps computing both; it is the instrument, not the pipeline.
- Measure: wall time of `derive-corpus --force` before and after; byte-identical
  `cardTagsDerived` apart from the new fields.

### T3. Pass the readings through instead of re-parsing (F1, F2, F3)

Short form, no schema change:

- Memoize `parseActions`, `parseTrigger`, `parse` (filter) and `segment` per input string inside
  one derive call (a `Map` created in `deriveCardTags`, passed down, or a module-level LRU keyed
  on the string). Six `segment()` calls and two to three grammar passes per clause become one.
- Extend `DeriveInput` with optional `readings?: Record<number, { trigger?: TriggerReading[];
  actions?: ActionReading[] }>`. `grammarClauseRecords` returns them beside the records;
  `derive-input.ts` threads them through; `withGrammarActions` and `grammarTriggersOf` use them
  when present and parse only when absent (the model path).
- Measure: derive-corpus wall time; `cardTagsDerived` byte-identical.

Long form, the real fix for F1, its own plan document before it starts:

- A typed clause record: `trigger?: TriggerReading | stored`, `actions: (ActionReading | Action)[]`.
  `clause-record.ts` stops spelling objects "as the store writes it" and hands derive the
  `SubjectFilter` it already has. `subjectFrom` takes a `SubjectFilter` directly when given one.
- The forty imitation rules in `clause-record.ts` go, one group at a time, each with the G3 diff
  showing the group empty.
- `Action.condition`, `oncePerTurn` and `actor` become inputs to derive rather than dropped fields:
  `oncePerTurn` feeds `repeats.ts`; `actor` replaces the `actionRecipients` regex for a clause
  the grammar read; `condition` stays unread until a consumer needs it, but is carried.

### T4. Move corpus ratchets out of the unit suite (F8)

- `grammar/action.test.ts:551` and any other test that reads `*.jsonl` or `repeats-refused.json`
  move to a `vitest` project `packages/tagger/ratchets/` (or `test:ratchet` script), run in CI
  once, on node 24 only, as its own step after `npm test`.
- Target: `npm test -w @edh-seer/tagger` under 10 s. Note the ratchet's number in the PR.

### T5. One keyword table (F6)

- Decide whether `extract.ts` / `keyword-augment.ts` / `bin/score-gold.ts` still serve the gold
  set (#896 H1 names it). If the gold set is scored through derive now, delete the three and
  their tests; if not, move the gold scorer onto `deriveCardTags` first, then delete.
- Point `grammar/action.ts` keyword actions and `derive/emits.ts` keyword expansions at one
  table generated from `cr-keywords.json` (`bin/gen-cr-keywords.ts` already exists), so a keyword's
  primitives are stated once.

### T6. Measurement data out of the package (F7)

- `phrases.jsonl`, `triggers.jsonl`, `actions.jsonl.gz`, `repeats-refused.json`,
  `intervening-if-unrepresented.json` move to `docs/measurements/card-grammar/fixtures/` (or
  `research/`), with the instruments and ratchets reading them from there. `grammar-triage.json`
  and `grammar-only-triage.json` stay with the code that reads them, in `packages/tagger/triage/`.
- Check `lint:bins` still passes (a test under research/ is collected by no project).

### T7. Back up the clause store, build static in CI (F11)

- `packages/data/src/bin/dump-clauses.ts`: `cardClauses` to gzip JSONL (expected a few MB),
  and `restore-clauses.ts` back. Document both in `docs/RUNBOOK.md` under "Buying corpus".
- Put the dump somewhere off the laptop the owner chooses (a private repo, an R2 bucket).
- A GitHub Actions workflow, manual trigger, that restores the dump into the throwaway Mongo CI
  already has, runs `derive-corpus`, `build-static`, `assemble-deploy`, and `wrangler pages
  deploy` with a repository secret. The laptop deploy stays as the fallback until this has
  shipped a release the owner checked.

### T8. Write the grammar into the docs (F10)

- A `docs/pipeline/2b-grammar.md` (or a section in `3-derive.md`): what reads completely, what
  falls back, the switch rule, the numbers from #957 and #960, the instruments.
- `2-normalize.md`: the model is the fallback for cards the grammar does not read, with the
  count after T1.
- `docs/engineering-log/2026-10-0X.md` entries for the #896 tasks, in the log's own format.
- Either add the missing `docs/superpowers/specs/2026-10-02-card-grammar-model-free-design.md`
  or fix the citation in `instruments/src/grammar-only.ts`.

## What must not move

- `cardTagsDerived` for T2, T3 short form, T4, T6: byte-identical apart from new bookkeeping
  fields. Prove it with a diff of `derive-corpus --force` output before and after.
- Panel precision and retention, compass, anti, the 71-deck and 197-precon G4 edge keys:
  unchanged unless a label predicts the change (#896 S3).
- No ratchet file loosened. No test skipped.

## How this was measured

- `npm ci && cd packages/tagger && npx vitest run --reporter=json` on 2026-10-04 at
  `dd7ef77`; per-file durations from the JSON report.
- Grep counts and line numbers at the same commit.
- Switch numbers from the bodies of #957 and #960.
