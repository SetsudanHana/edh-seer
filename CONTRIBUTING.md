# Contributing

Thanks for looking. The quickest start needs nothing but Node 22 or newer:

```bash
npm install && npm test        # no database, no network, no API key
```

New to the engine? Read [How it works](docs/HOW-IT-WORKS.md) first. The rest of this page is the
project's habits: a few that are not obvious from the code, each of which exists because skipping it
cost something measurable.

## The most useful contribution

**A wrong pairing.** The site prints a sentence for every pairing it finds, which means every
pairing can be checked against the cards and disagreed with. If one is wrong, that is a defect with
a witness attached, and it is worth more than most patches.

[Report a wrong pairing](https://github.com/SetsudanHana/edh-seer/issues/new?template=wrong-edge.yml)
with both card names and the sentence the site printed.

The same goes for a pairing that is **missing** — two cards that obviously work together and were
not paired. Those are harder to find and rarer to receive.

## Getting set up

Node 22 or newer is enough for `npm test` and most engine work: the matcher is pure and its tests
carry their own fixtures. The bins and the measuring instruments also need MongoDB holding the card
corpus — the [corpus figures](README.md#honest-limitations) are in the README — which is not in the
repository:

```bash
docker compose -f packages/data/docker-compose.yml up -d
npm run ingest -w @edh-seer/data      # Scryfall cards and the combo list
```

The normalized clauses come from the one paid step ([Stage 2](docs/pipeline/2-normalize.md)) and
cannot be rebuilt for free. How to run the site locally, the way production runs it, is in
[the runbook](docs/RUNBOOK.md#running-the-product).

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

Every fix here carries its measured effect in the commit message. Three instruments are free to run
(no model, no API key) and are the ones reviewers will ask about. They read the MongoDB corpus, and
`panel-score.ts` also reads the judged panel, which lives only on the maintainer's machine; if you
cannot run them, say so in the PR and the maintainer will:

```bash
npx tsx packages/instruments/src/panel-score.ts          # precision AND retention on the frozen panel
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

## Screenshots

The README and [edhseer.cards/how-it-works](https://edhseer.cards/how-it-works) show four frames of
a real report: the graph, the game plan, the suggestions and the mana chart. They are the first
picture of the product most people see, and a picture of last month's UI is a claim that is no
longer true.

**If your change alters what one of those frames shows, regenerate them in the same PR:**

```bash
VITE_STATIC_DATA=1 npm run build:client -w @edh-seer/web
npx vite preview --config packages/web/client/vite.config.ts --port 5180 &
npm run screenshots -w @edh-seer/web
```

The script (`packages/web/scripts/docs-screenshots.ts`) analyses a fixed Krenko list, crops each
frame from its own heading, and writes the `.webp` files that both pages use. Your UI and
production's card data, so no corpus is needed. Look at the four files before you commit them.

`screenshots.test.ts` holds the parts a test can see: every frame comes from the script, the page
and the README show the same set, and each file's size matches what the page declares. Whether a
frame is *out of date* no test can tell, which is why it is on the PR checklist.

## Pull requests

Branch, open a PR, get both CI legs green (`test (node 22)` and `test (node 24)`), then squash-merge.
Nobody pushes to `main`; branch protection is enforced for administrators too.

A good PR body says what changed, what it was measured against, and what the number did. If a change
is deliberately unmeasurable, say that instead — an explicit "no measurable effect, here is why" is a
fine answer and a silent one is not.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Please do not open a public issue for it.
