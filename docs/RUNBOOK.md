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

The `.env` lives in `packages/tagger/`, **not** the repository root. It holds `ANTHROPIC_API_KEY` and
`TAGGER_PROVIDER=anthropic`.

**The second line is not decoration.** Without it, any bin that spends falls back **silently** to a
local Ollama — producing a corpus answered by the wrong model, with nothing on screen to say so. A
fresh clone has no `.env` at all. The dry run prints a `provider:` line; read it before every `--run`.

## Running the product

```bash
npx tsx packages/cli/src/main.ts <decklist.txt>                  # analyse a deck
cd packages/web && NODE_OPTIONS="--import tsx" npx nest start    # API on :3001
cd packages/web && npx vite --config client/vite.config.ts       # UI on :5173
```

If the UI is serving code you know you changed, kill the old servers first — an `EADDRINUSE` in the
log means the browser is measuring yesterday's build.

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
in the commit message. All three of these are free and need no model.

```bash
npx tsx packages/instruments/src/panel-score.ts          # precision AND recall on the frozen panel
npx tsx packages/instruments/src/population-compare.ts   # edges and reasons, before against after
npx tsx packages/instruments/src/eval-pairs.ts           # the compass
```

Three rules about what those numbers mean:

**Never quote precision without recall.** Precision alone is not comparable across any change that
shrinks the claim set, which every de-meshing ruling does — and a gate that deletes every claim it is
unsure of scores 100%.

**The panel's second number is retention, not recall.** The panel was built from claims this engine
already made, so it cannot see an edge that was never claimed. The real recall figure comes from
`recall-sample.ts`, drawn separately.

**A stale baseline is how a real failure gets excused.** Re-measure rather than comparing against a
number written in a document, including this one.

The panel is ratcheted by name: `docs/measurements/panel/known-lost-pairs.json` holds the accepted
losses, `--bank` records a new set, and **both** directions fail — a newly unjoined pair, and a
recovered pair that was never banked. It needs Mongo, so it cannot run in CI; it guards where the
change is made rather than where it merges.

## Adding a verb

A new `VERB_VOCAB` member is not one edit. Five gates fire, across three packages:

| gate | what it demands |
|---|---|
| [`schema.test.ts`](../packages/tagger/src/schema.test.ts) | the list stays closed and unique |
| [`sentence.test.ts`](../packages/matcher/src/sentence.test.ts) | every member has a `VERB_PHRASES` entry, so a claim reads as English |
| [`theme-stats-drift.test.ts`](../packages/matcher/src/theme-stats-drift.test.ts) | every canonical verb family appears in the committed `theme-stats` artifact |
| [`effect-class.test.ts`](../packages/matcher/src/effect-class.test.ts) | kind-keyed collections name only real `EFFECT_KINDS` |
| [`demand-sentence.test.ts`](../packages/web/client/src/lib/demand-sentence.test.ts) | the web client renders the mechanism as English, not as its own key |

A sixth now fires too: [`gen-schema-docs.test.ts`](../packages/tagger/src/bin/gen-schema-docs.test.ts)
fails until the [schema reference](reference/SCHEMA.md) is regenerated.

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
npm run typecheck --workspaces
npm run lint:bins              # where a script is allowed to live
```

**Never run `npx vitest run` from the repository root.** It ignores every package's own vitest config,
so the web client's tests run without jsdom and die on `document is not defined`. `npm test` runs
`npm run test --workspaces`, which gives each package its config.

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

The custom domain lags the deployment alias by about a minute, so one stale read straight after
"Deployment complete" is normal. Persisting is not.
