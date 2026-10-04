# The precon build: where the half hour goes, and the tasks (2026-10-04)

The owner, 2026-10-04: "building precon pages takes like 30 min, so deployment jumped from a couple
of minutes to over half an hour, is there any space for us to optimize it?"

Yes. One precon was measured end to end (procedure at the bottom). The time is almost entirely
the mana-base keeper re-analysing the deck once per candidate move, and each of those re-analyses
runs the full report: the 2,000-game mana simulation, the wire graph, and a fresh shard cache.
The keeper reads three numbers (band, mana base total, synergy score), and none of them depends
on the simulation or the graph.

## What `npm run deploy -w @edh-seer/web` does

`packages/web/package.json`: `build:precons`, then `build:static-site` (vite build and
`assemble-deploy.mjs`), then `wrangler pages deploy`. The precon build is
`packages/web/scripts/build-precons.mts`: a serial loop over the 197 precons in
`packages/data/precons.json`, and for each:

1. `analyzeDeckStatic` for the full report (edges, simulation, graph);
2. `suggestForDeck`;
3. `preconPackages` (`packages/web/client/src/lib/precon-packages.ts`): `upgradeOptions` loads the
   candidate pools, `gatherPackage` builds one package per bracket target, then `keepManaBase`
   (lines 159-193) reads the swapped list through the `analyse` callback and, while the package
   misses its band or its mana total, tries every move (drop a non-land swap, or give a bring-down
   cut its next replacement) and reads each one. Every read is a full `analyzeDeckStatic`.

## Measured: one precon, Counterpunch (Commander 2011), fully cached

| phase | wall time |
|---|---|
| 1. the report | 1.9 s |
| 2. suggestions | 2.7 s |
| 3. packages | 58.7 s |
| of which 36 keeper re-analyses | 55.8 s (1.55 s each) |
| total | 63.3 s |

Packages came out 2:17, 3:17, 4:20 swaps. The 36 reads are 3 first readings plus 33 moves.

CPU profile of the same run (`node --cpu-prof`), self time by file:

| where | share | what |
|---|---|---|
| `matcher/src/goldfish.ts` (`simulate`, `boardFor`, `payable`, `pickLand`, ...) | ~45% self, ~54% inclusive under `manaModel` | the 2,000-trial mana simulation, two policy arms, per analysis |
| `matcher/src/edges.ts`, `implied.ts`, `zones.ts`, `land-conditions.ts` | ~15% self, ~28% inclusive under `directedReasons` | edge matching |
| `TextDecoder`, `parseJSONFromBytes`, `Buffer.slice` | ~13% | re-decoding shard JSON: 7,892 shard reads, 253 MB, for one precon |
| garbage collector | 5% | |
| `buildWireGraph`, `computeDeckMath`, `deckBracket`, `upgradeOptions`, `gatherPackage` | ~2% together | |

Why the JSON share exists: `analyzeDeckStatic` (`packages/web/client/src/api.static.ts`) builds a
new `StaticLookup` on every call, so every keeper read re-fetches and re-parses the ~80 shards the
deck hashes into. The build's own `packageLookup` is shared only across `preconPackages`.

The machine this was measured on is slower than the owner's; the proportions carry, the seconds
do not. 197 precons at this box's 63 s would be 3.5 h, so the owner's 30 min is the same shape.

## What the keeper's three numbers depend on

- `report.bracket.band`: `deckBracket(cards, combos)` (`brackets.ts:73`). Cards and combos only.
- `report.deckMath.lands.manaBase.total`: `computeDeckMath` -> `manaBaseScore(deck, { target:
  finalLandsTarget, actual }, commanderNames)` (`deck-math.ts:295`). `finalLandsTarget` is
  `adjustedTargets(primary, gatedLandsTarget(recommendedLands(deck).target))`. `recommendedLands`
  (`land-count.ts:148`) reads the deck. `primary` is `strategies[0]` from `detectArchetypes`
  (`analyze.ts:966`), which reads the edges. Nothing here reads `manaSim`; `castCurves` is passed
  to `computeDeckMath` for the castability rows only.
- `report.synergyOverall` (`analyze.ts:762`): the edges.

So a keeper reading needs resolve, `buildDeckCards`, the edges, the archetypes, the bracket and
the land maths. It does not need `manaModel` (`analyze.ts:779`) or `buildWireGraph`
(`orchestrate.ts:250`).

## Tasks, in order

Each one PR. The precon pages are the measure: build the 20-precon S2 sample
(`docs/plans/2026-09-30-precon-upgrade-package.md`, every 9th precon) before and after, and the
page JSON must be byte-identical for every task but P3, where only the order of tried moves may
differ and the shipped package must still be identical. Say the per-precon time in the PR body.

### P1. A reading without the simulation or the graph

- Add to `analyzeDeckStructured` (`analyze.ts:217`) an options bag with `skipSimulation?: true`.
  When set, `manaSim` is a stub (`curves` empty, `manaMedian` undefined, `availability` undefined)
  and `castByName` is empty. Guard every reader of those three; the ones that print rows
  (castability, mana availability) print nothing.
- A `readDeckStatic(decklist, commanders, baseUrl, fetchImpl, lookup?)` in `api.static.ts` (or in
  `matcher/src/orchestrate.ts` as `readDecklist`) that resolves, calls `analyzeResolvedDeck` with
  `skipSimulation`, and does NOT call `buildWireGraph`. It returns `{ band, mana, synergy }`.
- `build-precons.mts` passes it as `analyse`. The page's own numbers (`page.synergy`, the report
  the link opens) still come from the full report in step 1, so nothing the page shows changes.
- Test: for the 20-precon sample, `readDeckStatic` of the precon list equals the full report's
  three numbers.
- Expected: a keeper read drops from ~1.55 s to ~0.6 s here (the simulation is about half of an
  analysis, the graph a rounding error). Per precon ~63 s -> ~30 s.

### P2. One shard cache for the whole build

- Split `StaticLookup` (`matcher/src/static-lookup.ts`) into a `ShardCache` (fetch + parse a shard
  once, keyed by path, holding the parsed `ShardFile`) and the per-deck view it is today (the
  `byName`, `byAlias`, `byId`, `combos` maps). `prefetch` reads from the cache. The per-deck view
  keeps its rule that only requested names are read out of a shard, so `allCombos()` still holds
  only the deck's combos and the band is unchanged.
- `analyzeDeckStatic` and `readDeckStatic` take an optional `cache`; `build-precons.mts` makes one
  and passes it everywhere, including `suggestForDeck` and `packageLookup`.
- The browser path is untouched: with no cache given, a lookup makes its own, as now.
- Expected: the ~13% JSON decode and most of the 5% GC go. 253 MB of shard reads per precon
  become ~100 MB once per build.

### P3. Fewer keeper reads

`keepManaBase` reads every move on every iteration. Two cheap cuts, in this order, each measured
on the 20-precon sample for an identical shipped package:

1. **Memoize by list.** Key the reading on the swapped decklist string. The `alternatives` lists
   repeat across iterations and across targets 3 and 4.
2. **Pre-rank by the cheap half.** For each move compute band (`deckBracket`, free) and the mana
   total with the precon's own `primary` held fixed (`recommendedLands` + `adjustedTargets` +
   `manaBaseScore`, no edges). A move that fails the band is never read. Read the edges only for
   moves that pass, and only as many as the rank needs: the keeper picks by band, then least mana
   cost, then fewest swaps lost, then synergy, so synergy decides only among ties on the first
   three. Note the primary CAN move with a synergy swap; so the cheap mana total is a pre-rank,
   and the move chosen is still confirmed by one real reading before it is taken.

Expected: the 33 move reads for Counterpunch become well under half; most moves fail on mana
alone.

### P4. Precons in parallel

- `build-precons.mts` maps the 197 precons through `mapInWorkers` (`packages/data/src/parallel.ts:108`)
  with `defaultWorkers()`, the way `build-static.ts` builds partners. Each worker holds its own
  `ShardCache` (P2) and writes its own page file; the main thread writes `index.json` and the log
  lines in precon order so the output reads as before.
- Memory: one cache is ~100 MB parsed per worker. On an 8-core machine that is fine; expose
  `--workers N` as `build-static` does.
- Expected: wall time divided by (cores - 1).

### P5. Skip the precon build when nothing it reads has changed

- The output already lives under `static-out/<version>/precons/`. Write into `index.json` the
  manifest version and a hash of the builder's inputs: `precons.json` and the source files under
  `packages/web/client/src/lib/precon-*.ts`, `cut-choice.ts`, `engine-model.ts`,
  `packages/matcher/src/upgrade-*.ts`, `bracket-guard.ts`, `suggest-static.ts`, `same-job.ts`.
- `build-precons.mts` exits at once when an `index.json` for this version carries the same hash,
  unless `--force`. A UI-only deploy then costs what it did before the precon pages existed.
- The RUNBOOK's deploy section says so, next to the existing warning about a stale `static-out/`.

### P6. Overlap the client build

`deploy` runs `build:precons` then `build:static-site`. The vite build does not read the precon
pages (`assemble-deploy.mjs` copies `static-out/` after it), so the two can run concurrently and
`assemble-deploy` waits for both. Small, but free: `"deploy": "npm-run-all -p build:precons
build:client && node scripts/assemble-deploy.mjs && wrangler pages deploy ..."` or a plain `&`
with `wait`.

### What not to do

- Do not lower `REPORT_TRIALS` (`goldfish.ts:1067`) for the shipped report; the page quotes it and
  the engineering log of 2026-08-25 records why 2,000.
- Do not share one `StaticLookup` instance across decks without P2's split: `allCombos()` is the
  union of every fetched card's combos, and a shared instance would hand the bracket guard combos
  from other decks.

## Expected result

| step | per precon (this box) | 197 precons, 7 workers |
|---|---|---|
| today | 63 s | serial: 3.5 h here, ~30 min on the owner's machine |
| P1 | ~30 s | |
| P1 + P2 | ~26 s | |
| P1 + P2 + P3 | ~15 s | |
| + P4 | | ~7 min here, a few minutes on the owner's machine |
| + P5, code-only deploy | 0 | 0 |

## How this was measured

A script placed in the gitignored `static-out/` so workspace imports resolve, run with
`npx tsx static-out/time-precon.mts "Counterpunch"` and again under
`node --cpu-prof --import tsx`. It is the body of `build-precons.mts` for one precon, with:

- `fetchImpl` pointed at `https://edhseer.cards/static`, wrapped in an on-disk cache keyed by
  pathname and a 12-connection cap (a burst of a thousand parallel fetches times out through a
  proxy; the build's own `Promise.all` in `prefetch` does exactly that burst, which is harmless
  against local files);
- `performance.now()` laps around the three phases, and a counter and timer inside the `analyse`
  callback;
- the `.cpuprofile` summed by `callFrame` for self time and by ancestor chain for inclusive time.

Re-run after each task; the numbers in the PR body are the ones this prints.
