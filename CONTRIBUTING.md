# Contributing

Thanks for looking. This project has a few habits that are not obvious from the code, and every one
of them exists because skipping it cost something measurable.

## The most useful contribution

**A wrong synergy claim.** The engine prints a sentence for every edge it draws, which means every
edge can be disagreed with. If one is wrong, that is a defect with a witness attached, and it is
worth more than most patches.

[Report an edge](https://github.com/SetsudanHana/edh-seer/issues/new?template=wrong-edge.yml) with
both card names and the sentence the site printed.

The same goes for an edge that is **missing** — two cards that obviously work together and got no
claim. Those are harder to find and rarer to receive.

## Getting set up

Node >= 22, and a MongoDB instance holding the card corpus.

```bash
npm install
npm test
```

The corpus itself is not in the repository — it is roughly 34,000 Scryfall cards plus 21,000
normalized clause documents. Ingestion bins live in `packages/data/src/bin/`. Most engine work does
not need it: the matcher is pure and its tests carry their own fixtures.

## Running the suite

```bash
npm test                        # every workspace, each with its own config
npm test -w @edh-seer/matcher   # one workspace
npm run typecheck               # vitest does NOT typecheck; run this too
npm run lint:bins               # where a script is allowed to live
```

**Never run `npx vitest run` from the repository root.** It ignores each package's own vitest config,
so the web client's tests run without jsdom and die on `document is not defined`. That produced a
"75 tests fail on a clean checkout" baseline that was quoted for weeks and was purely the wrong
command.

The suite is green on a clean checkout. There is no environmental exception — if something is red,
it is the change.

## Where a script goes

Three homes, and the test is what the script is **for**, not what it is named:

| home | what belongs there |
|---|---|
| `packages/*/src/bin/` | **pipeline** — it writes the database or a tracked artifact the product ships, or it is a module with a test |
| `packages/instruments/src/` | **scoring and verification** — it judges the engine's output rather than building anything |
| `research/<package>/` | **one-shot measurement** — a census, sweep or probe that prints and that nothing imports |

`npm run lint:bins` enforces this in both directions, and the direction that bites is the second one:
a `*.test.ts` under `research/` is collected by no vitest project, so it reads as covered while its
coverage is silently missing.

Research scripts import package source by **relative path**, never by package name. Importing by name
would force dozens of modules into the public export maps purely to relocate a script.

## Measure before and after, and say the number

Every fix here carries its measured effect in the commit message. Three instruments are free to run,
need no model, and are the ones reviewers will ask about:

```bash
npx tsx packages/instruments/src/panel-score.ts          # precision AND recall on the frozen panel
npx tsx packages/instruments/src/population-compare.ts   # edges and reasons, before against after
npx tsx packages/instruments/src/eval-pairs.ts           # the compass
```

**Never quote the panel's precision without the retention figure beside it.** A gate that deletes
every claim it is unsure of scores 100%, so precision alone is not comparable across any change that
shrinks the claim set — and most correctness fixes shrink it.

**Do not trust a number written in a document, including ours.** Re-measure. A stale baseline is how
a real regression gets excused.

## Things that will fail your build for a non-obvious reason

- **Adding a verb is not one edit.** A new `VERB_VOCAB` member trips six gates across three packages
  — the closed-list test, the sentence table, the theme-stats artifact, the effect-kind collections,
  the web client's mechanism rendering, and the generated schema reference. `TRIGGER_CUES` in
  `clause-store.ts` has **no** gate; add its row by hand. See
  [the runbook](docs/RUNBOOK.md#adding-a-verb).
- **`docs/reference/SCHEMA.md` is generated.** Edit the source, then run
  `npx tsx packages/tagger/src/bin/gen-schema-docs.ts`. A test compares the checked-in file against
  the generator.
- **`tokens/` is CI-checked.** `npm run tokens:check` validates the token files and their contrast,
  and CI rebuilds `tokens/theme.css` and fails on any diff. Do not hand-edit the generated CSS.
- **No emoji anywhere** — not in the UI, code, JSON, copy, comments or commit messages. This one is
  a convention rather than a gate, so it is on review to catch. Use a real icon (lucide, inline SVG,
  `currentColor`) or plain words.

## Pull requests

Branch, open a PR, get both CI legs green (`test (node 22)` and `test (node 24)`), then squash-merge.
Nobody pushes to `main`; branch protection is enforced for administrators too.

A good PR body says what changed, what it was measured against, and what the number did. If a change
is deliberately unmeasurable, say that instead — an explicit "no measurable effect, here is why" is a
fine answer and a silent one is not.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Please do not open a public issue for it.
