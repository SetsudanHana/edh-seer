# Runbook

What to run, in what order, and what each number means. The pipeline itself is described in
[`docs/pipeline/`](pipeline/); this page is the operations.

Run everything **from the repository root**. Every relative data path assumes it.

---

## Before anything

Every bin and the web server need the environment sourced:

```bash
set -a && source packages/tagger/.env && set +a
```

The `.env` lives in `packages/tagger/`, **not** the repository root. A fresh clone has none. It
holds:

| variable | what it is | default |
|---|---|---|
| `ANTHROPIC_API_KEY` | the key the paid normalization step spends | none |
| `TAGGER_PROVIDER` | which model answers; set it to `anthropic` | Ollama |
| `MONGO_URI` | the corpus database | `mongodb://localhost:27017` |
| `MONGO_DB` | the database name | `mtg` |

**`TAGGER_PROVIDER` is not decoration.** Without it the provider is a local Ollama. A spending bin
used to fall back to it **silently** — a corpus answered by the wrong model, with nothing on screen
to say so — and now refuses `--run` unless `--allow-provider` is passed. The dry run prints a
`provider:` line; read it before every `--run`.

A local MongoDB comes from `docker compose -f packages/data/docker-compose.yml up -d`, and
`npm run ingest -w @edh-seer/data` downloads the Scryfall cards and the combo list into it. The
normalized clauses are the paid step ([Stage 2](pipeline/2-normalize.md)) and cannot be rebuilt for
free.

## Running the product

The site analyses in the browser: it fetches each card's derived tags from `/static` shards and runs
the matcher itself. There is no API in the analysis path, and since 2026-09-25 no API server at all.

```bash
npx tsx packages/matcher/src/bin/build-static.ts                 # static-out/, from Mongo, ~70s
npm run dev -w @edh-seer/web                                     # UI on :5173, /static from static-out/
npx tsx packages/cli/src/main.ts <decklist.txt>                  # a deck report in the terminal
```

The dev server serves `/static/*` straight out of `static-out/` (the `edh-seer-static-out` plugin in
`client/vite.config.ts`), so the shards are never copied. **Rebuild `static-out/` after a derivation
change**, or the dev server shows the engine's old reading of every card.

The pair-judging panel (`#calibrate`) is served by the same dev server, from
`@edh-seer/matcher/calibration-judge`, and only when asked for: it writes the calibration ratchet's
own files.

```bash
MTG_CALIBRATE=1 npm run dev -w @edh-seer/web                     # then open /#calibrate; needs Mongo
```

Deck-link import goes to the import worker: run `npx wrangler dev --port 8788` in
`packages/import-worker` and the dev server proxies `/api/import` to it.

If the UI is serving code you know you changed, kill the old dev server first -- an `EADDRINUSE` in
the log means the browser is measuring yesterday's build.

## Buying corpus

See [Stage 2](pipeline/2-normalize.md) for what it costs and which selector to reach for.

```bash
npx tsx packages/tagger/src/bin/normalize-corpus.ts               # DRY RUN, prints the bill
npx tsx packages/tagger/src/bin/normalize-corpus.ts --batch --run # spends, at half price
```

`--run` is the only thing that spends. Read `provider:` first.

## Re-deriving

Free, and the reason the engine is improvable at all.

```bash
npx tsx packages/tagger/src/bin/derive-corpus.ts            # what is stale
npx tsx packages/tagger/src/bin/derive-corpus.ts --force    # everything
```

## Measuring a change

**Measure before and after, and say the number.** Every fix in this repo carries its measured effect
in the commit message. All three of these are free and need no model, but they read the MongoDB
corpus, and `panel-score.ts` also reads the judged panel, which is local to the maintainer's checkout.

```bash
npx tsx packages/instruments/src/panel-score.ts          # precision AND retention on the frozen panel
npx tsx packages/instruments/src/population-compare.ts   # edges and reasons, before against after
npx tsx packages/instruments/src/eval-pairs.ts           # the compass
```

Three rules about what those numbers mean:

**Never quote precision without retention.** Precision alone is not comparable across any change that
shrinks the claim set, which every de-meshing ruling does — and a gate that deletes every claim it is
unsure of scores 100%.

**The panel's second number is retention, not recall.** The panel was built from claims this engine
already made, so it cannot see an edge that was never claimed. The real recall figure comes from
`recall-sample.ts`, drawn separately and judged blind, then scored by `recall-score.ts` (both in
`packages/instruments/src/`).

**A stale baseline is how a real failure gets excused.** Re-measure rather than comparing against a
number written in a document, including this one.

The panel is ratcheted by name: `docs/measurements/panel/known-lost-pairs.json` (local to the
maintainer's checkout, not committed) holds the accepted
losses, `--bank` records a new set, and **both** directions fail — a newly unjoined pair, and a
recovered pair that was never banked. It needs Mongo, so it cannot run in CI; it guards where the
change is made rather than where it merges.

## Adding a verb

A new `VERB_VOCAB` member is not one edit. Six gates fire, across three packages:

| gate | what it demands |
|---|---|
| [`schema.test.ts`](../packages/tagger/src/schema.test.ts) | the list stays closed and unique |
| [`sentence.test.ts`](../packages/matcher/src/sentence.test.ts) | every member has a `VERB_PHRASES` entry, so a claim reads as English |
| [`theme-stats-drift.test.ts`](../packages/matcher/src/theme-stats-drift.test.ts) | every canonical verb family appears in the committed `theme-stats` artifact |
| [`effect-class.test.ts`](../packages/matcher/src/effect-class.test.ts) | kind-keyed collections name only real `EFFECT_KINDS` |
| [`demand-sentence.test.ts`](../packages/web/client/src/lib/demand-sentence.test.ts) | the web client renders the mechanism as English, not as its own key |
| [`gen-schema-docs.test.ts`](../packages/tagger/src/bin/gen-schema-docs.test.ts) | the [schema reference](reference/SCHEMA.md) is regenerated |

**`TRIGGER_CUES` in [`clause-store.ts`](../packages/tagger/src/clause-store.ts) has no gate at all.**
It is a lookup keyed by trigger event, and a new event with no row there is silently treated as
matching anything. Add the row by hand.

Remember which vocabulary is being changed. The clause vocabulary (`VERBS`, `TRIGGERS`, `ZONES`) is
what the model may say; `VERB_VOCAB` is what the matcher joins on. They are deliberately not the same
list.

## Bumping a version constant

Current values: [schema reference](reference/SCHEMA.md#version-constants).

| constant | cost | when |
|---|---|---|
| `DERIVE_VERSION` | free | any derivation semantics change. Bump, then re-derive |
| `NORMALIZE_VERSION` | free | anything that determines the request: the prompt, the vocabularies, or `segment.ts` |
| `VOCAB_VERSION` | free | only when `VERBS`, `TRIGGERS` or `ZONES` changed. Never for a prose rule |
| `TRIGGER_VOCAB_VERSION` | free | only when `TRIGGERS` changed |
| `NORMALIZE_MIN_COMPATIBLE` | **re-buys the whole corpus** | a breaking change only |

The one that costs is the one to think about twice. An **additive** change — a new verb, a new trigger
member, a new prompt rule — leaves `NORMALIZE_MIN_COMPATIBLE` alone; pick the affected cards up with
`normalize-corpus.ts --refresh-other` instead.

Bumping `NORMALIZE_VERSION` without touching a vocabulary and then running `--refresh-other` re-buys
cards that were already correct. That treadmill has been paid for twice; gate the selector on what
actually changed.

## Regenerating the schema reference

```bash
npx tsx packages/tagger/src/bin/gen-schema-docs.ts
```

[`reference/SCHEMA.md`](reference/SCHEMA.md) is generated and must never be hand-edited — a test
compares it against the generator's output on every run.

## Testing

```bash
npm test                       # all workspaces, each with its own config
npm test -w @edh-seer/matcher  # one workspace
npm run typecheck              # every workspace; vitest does not typecheck
npm run lint:bins              # where a script is allowed to live
```

`npx vitest run` from the repository root is the same set of suites in one process: the root
`vitest.config.ts` lists each package as a project under its own config. `npm test` runs them per
workspace, which is what CI does.

The suite is green on a clean checkout. There is no environmental exception; any red is yours.
`vitest` does not typecheck, so a green suite is not proof the branch compiles — run `typecheck` too.

## Rebuilding and deploying the site

**The deploy ships `static-out/`, and nothing rebuilds it for you.**

```bash
npx tsx packages/matcher/src/bin/build-static.ts   # default out dir, from Mongo, ~70s
cat static-out/manifest.json                        # the version must have CHANGED
npm run deploy -w @edh-seer/web
curl -s https://edhseer.cards/static/manifest.json  # must print the same version
```

`npm run deploy` copies the repository's gitignored `static-out/` into the site as `/static`; it does
not read Mongo. A data change measured by building into a scratch directory with `--out` leaves
`static-out/` at the old version, and the site then serves old data with new code — which has
happened, and the missing card was not noticed until a user asked.

"Already rebuilt this session" is not the same as "rebuilt from the commit being deployed". A new
record field ships absent and the feature is silently dead.

**The deploy runs from the maintainer's machine**, with a logged-in `wrangler`; there is no deploy
workflow in CI. The upload is capped at 20,000 files, the free tier's limit, which
`assemble-deploy.mjs` checks. Two things deploy separately:

```bash
npm run deploy -w @edh-seer/import-worker   # the Moxfield / Archidekt import worker, /api/import/*
npm run deploy:indexnow -w @edh-seer/web    # tell search engines which pages changed
```

After a UI change, regenerate the README and /how-it-works screenshots and the README demo before
the PR (`npm run screenshots -w @edh-seer/web`, `npm run demo-gif -w @edh-seer/web`, see
[CONTRIBUTING](../CONTRIBUTING.md#screenshots)).

The custom domain lags the deployment alias by about a minute, so one stale read straight after
"Deployment complete" is normal. Persisting is not.
