/** THE FIT BEHIND `MANA_BASE_COST` (#1169 task 3), REBUILT. FREE: Mongo reads only, no model.
 *
 *  THE ORIGINAL IS GONE. `mana-base.ts` says "the script is research-only and lives outside the repo", and it was never committed (docs/plans/2026-10-04-mana-base-quality.md F3,
 *  M1). This is a REBUILD from that comment's description, not a recovery: it reproduces the DEFINITIONS, not the code, so the first thing it prints is whether its simulator
 *  lands near the recorded part sizes (colours 0.62 lost turns on average, tapped lands 0.19, the land count 0.08; colour R^2 0.70, tapped 0.48). It is run once per refit;
 *  a coefficient is only as good as that check.
 *
 *  WHAT IT MEASURES. 268 decks (the 197 Commander precons of `packages/data/precons.json` and the 71 calibration decks), `--trials` games each (default 2,000), ten turns,
 *  through `goldfish.ts`'s own board (mulligans by `keepsHand`, land first, accelerants next, draw, the mana-base's colours and tapped lands), with this file's `observe` hook
 *  casting the dearest spells the mana and its colours can pay and counting the ways a turn is LOST:
 *    SCREW   no land drop, and a spell costing no more than the turn number is stuck for mana (its mana value is above what the board has left);
 *    COLOUR  the mana is there by count and not by colour: a spell whose cost fits the count but not the colours is held and some mana goes unspent;
 *    FLOOD   the card drawn is a land, and the mana on the table plus the lands in hand already pay for the dearest spell in hand and in the command zone.
 *  LOST TURNS PER TEN is the mean over games, over the first ten turns, of the number of ways a turn was lost: a turn that is both colour-screwed and flooded counts twice (`--sum`, the
 *  default). That reading is the one that REPRODUCES the recorded figures (see the validation in the commit): colours 0.61 on average against 0.62, a three-colour deck 0.86 against 0.87,
 *  and the shipped 0.133 refit on the old colour count as 0.137. Reading a turn as lost ONCE however many ways hold (`--or`) gives colours 0.43 and 0.094, 30% under both.
 *  NOT RECOVERED, GUESSED FROM THE PROSE: the exact predicates above (the description gives each in one clause), greedy dearest-first spending, commander tax ignored, a plain
 *  spell is never removed from the hand the land policy reads (the goldfish does not cast one), and X costs are never cast.
 *
 *  THE ARMS, same seed so the games are the same shuffles: BASE; ALLCOL (every land taps for every colour of the commander's identity, `SimulateOptions.landColours`);
 *  UNTAPPED (every land, and every land a spell fetches, enters untapped, `landsUntapped`); and TARGET (lands traded for the deck's own non-ramp non-draw spells until the count is
 *  `landTarget`'s). The part a thing costs is the lost turns BASE has over its arm:
 *    colour = lost(BASE) - lost(ALLCOL), regressed through the origin on `colourMiss`   -> MANA_BASE_COST.colourMiss, R^2 reported centred and uncentred
 *    tapped = lost(BASE) - lost(UNTAPPED), on `tappedLandCount`                         -> MANA_BASE_COST.tapped
 *    count  = lost(BASE) - lost(TARGET), reported against the quadratic in lands off target (`short` / `over`)
 *  The precon-only fit is then held against the calibration decks.
 *
 *    npx tsx research/matcher/mana-base-fit.ts rows <out.json> [--shard i/n] [--trials N] [--only substring]   one shard of the sweep (needs Mongo)
 *    npx tsx research/matcher/mana-base-fit.ts fit <rows.json...> [--or] [--write-fixture <out.json>]           the regression and the report (no Mongo)
 *    npx tsx research/matcher/mana-base-fit.ts --check                                                          re-derive every colourMiss (x) from Mongo, diff against the fixture
 *
 *  THE RECORD OF `MANA_BASE_COST.colourMiss` is the fit module `packages/instruments/src/mana-base-fit-core.ts` over the fixture `packages/instruments/data/mana-base-fit-rows.json`
 *  (`--write-fixture` makes it from the shards of `rows`); a test pins the constant to that slope. The fixture's x values come from Mongo `cardTagsDerived` (DERIVE_VERSION 307), so
 *  RUN `--check` AFTER ANY CHANGE TO `colourSources`, `colourMiss`, `fixerSupply` OR DERIVE: it exits non-zero when the code no longer gives the x the slope was fitted on.
 *  `--or` reads a turn's lost-ness as once however many of its three ways hold, instead of the sum (the description does not say which; the sum is the one that reproduces the record).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS } from "@edh-seer/data";
import { preconDecklist, type Precon } from "@edh-seer/data/precons";
import { createTagsLookup } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { buildDeckCards, analyzeDeckStructured } from "../../packages/matcher/src/index.js";
import { classifyAccelerant, colorMask, drawOf, payable, simulate, spendUnits, type TurnView } from "../../packages/matcher/src/goldfish.js";
import { deckIdentity } from "../../packages/matcher/src/mana-lines.js";
import { MANA_BASE_COST } from "../../packages/matcher/src/mana-base.js";
import { fit, round3, type Fit, type FitRow } from "../../packages/instruments/src/mana-base-fit-core.js";
import { countsAsLand } from "../../packages/matcher/src/typeline.js";
import type { DeckCard } from "../../packages/matcher/src/types.js";

const TURNS = 10;
const arg = (flag: string): string | undefined => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
const TRIALS = Number(arg("--trials") ?? 2000);
const SEED = 20261013;

interface Lost { lost: number; screw: number; colour: number; flood: number }
interface Row {
  name: string; kind: "precon" | "calibration";
  lands: number; target: number; colourMiss: number; tappedLands: number; identity: string[];
  base: Lost; allCol: Lost; untapped: Lost; atTarget: Lost | null; targetNote: string;
}

const popcount = (m: number): number => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; };

/** The observer: casts the dearest payable spells each turn and counts the three ways a turn is lost. One per run; state resets with each trial. */
function observer(trials: number): { observe: (v: TurnView) => void; result: () => Lost } {
  let trial = -1;
  let cast = new Set<object>();
  const sum = { lost: 0, screw: 0, colour: 0, flood: 0 };
  return {
    observe(v) {
      if (v.trial !== trial) { trial = v.trial; cast = new Set(); }
      const units: number[] = [];
      for (const s of v.sources) for (let k = 0; k < s.mana; k++) units.push(s.colors);
      units.sort((a, b) => popcount(a) - popcount(b));
      units.splice(0, Math.max(0, units.length - v.pool));
      const avail = units.length;
      const full = units.slice();
      const spells = [...v.hand.filter((c) => !c.isLand && !c.accelerant), ...v.commanders.filter((c) => !c.accelerant)]
        .filter((c) => c.cost !== null && !cast.has(c));
      const held = spells.slice().sort((a, b) => b.manaValue - a.manaValue);
      for (const s of held) if (spendUnits(units, s.cost!)) cast.add(s);
      const stuck = spells.filter((s) => !cast.has(s));
      const screw = !v.landDrop && stuck.some((s) => s.manaValue <= v.turn && s.manaValue > avail);
      const colour = units.length > 0 && stuck.some((s) => s.cost!.total <= avail && !payable(full.map((colors) => ({ mana: 1, colors })), s.cost!));
      const handLands = v.hand.filter((c) => c.isLand).length;
      const need = Math.max(0, ...stuck.map((s) => s.manaValue));
      const flood = v.drewLand && v.made + v.tappedNow + handLands - 1 >= need;
      if (screw) sum.screw++;
      if (colour) sum.colour++;
      if (flood) sum.flood++;
      if (screw || colour || flood) sum.lost++;
    },
    result: () => ({ lost: sum.lost / trials, screw: sum.screw / trials, colour: sum.colour / trials, flood: sum.flood / trials }),
  };
}

function run(library: DeckCard[], commanders: DeckCard[], extra: { landColours?: number; landsUntapped?: boolean }): Lost {
  const o = observer(TRIALS);
  simulate(library, { trials: TRIALS, turns: TURNS, seed: SEED, alsoPrice: commanders, observe: o.observe, ...extra });
  return o.result();
}

/** TRADE LANDS FOR THE DECK'S OWN SPELLS until the count is `target`: a land comes out as the basic the deck has most of, and goes in as a copy of one it holds; the spell traded
 *  is a non-ramp, non-draw nonland (nearest the deck's mean mana value going out, a copy of that one coming in). Deterministic. */
function toTarget(library: DeckCard[], target: number, deckAll: readonly DeckCard[]): { deck: DeckCard[]; note: string } {
  const lands = library.filter((dc) => countsAsLand(dc.card));
  let deck = library.slice();
  const filler = (): DeckCard[] => deck.filter((dc) => !countsAsLand(dc.card) && !classifyAccelerant(dc, deckAll) && !drawOf(dc));
  const delta = target - lands.length;
  if (delta === 0) return { deck, note: "at target" };
  const basics = lands.filter((dc) => /\bbasic\b/i.test(dc.card.typeLine ?? ""));
  const pool = basics.length > 0 ? basics : lands;
  const byName = new Map<string, DeckCard[]>();
  for (const dc of pool) byName.set(dc.card.name, [...(byName.get(dc.card.name) ?? []), dc]);
  const most = (): DeckCard => [...byName.values()].sort((a, b) => b.length - a.length)[0]![0]!;
  const mean = deck.filter((dc) => !countsAsLand(dc.card)).reduce((n, dc) => n + dc.card.manaValue, 0) / Math.max(1, deck.filter((dc) => !countsAsLand(dc.card)).length);
  let moved = 0;
  for (let i = 0; i < Math.abs(delta); i++) {
    const f = filler();
    if (f.length === 0) break;
    if (delta > 0) {
      const out = f.reduce((b, dc) => Math.abs(dc.card.manaValue - mean) < Math.abs(b.card.manaValue - mean) ? dc : b);
      deck.splice(deck.indexOf(out), 1);
      const add = most();
      deck.push(add);
      byName.get(add.card.name)!.push(add);
    } else {
      const gone = most();
      const at = deck.lastIndexOf(gone);
      if (at < 0) break;
      deck.splice(at, 1);
      byName.get(gone.card.name)!.shift();
      if (byName.get(gone.card.name)!.length === 0) byName.delete(gone.card.name);
      deck.push(f.reduce((b, dc) => Math.abs(dc.card.manaValue - mean) < Math.abs(b.card.manaValue - mean) ? dc : b));
    }
    moved++;
  }
  return { deck, note: `${moved} of ${Math.abs(delta)} swaps` };
}

interface Job { name: string; kind: Row["kind"]; text: string }
function jobsFor(si: number, sn: number, only?: string): Job[] {
  const precons = JSON.parse(readFileSync(new URL("../../packages/data/precons.json", import.meta.url), "utf8")) as Precon[];
  return [
    ...readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort().map((f) => ({ name: f.replace(/\.txt$/, ""), kind: "calibration" as const, text: readFileSync(join(CALIBRATION_DECKS, f), "utf8") })),
    ...precons.map((p) => ({ name: `${p.setCode}:${p.name}`, kind: "precon" as const, text: preconDecklist(p) })),
  ].filter((j, i) => i % sn === si && (!only || j.name.includes(only)));
}

/** One deck through the product's own analysis: the cards, the commanders' names and the manaBase the shipped code gives it. */
async function analyse(j: Job, lookup: ReturnType<typeof mongoLookup>, tags: ReturnType<typeof createTagsLookup>) {
  const s = parseDecklistSections(j.text);
  const { cards, combos } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const cmdNames = new Set(s.commanders.map(normalizeName));
  const dcs = await buildDeckCards(cards, lookup, tags);
  const cn = dcs.filter((dc) => cmdNames.has(normalizeName(dc.card.name))).map((dc) => dc.card.name);
  const rep = analyzeDeckStructured(dcs, cn, undefined, undefined, new ComboIndex(combos));
  return { dcs, cn, mb: rep.deckMath?.lands?.manaBase };
}

async function rows(): Promise<void> {
  const out = process.argv[3];
  if (!out) throw new Error("usage: rows <out.json> [--shard i/n]");
  const [si, sn] = (arg("--shard") ?? "0/1").split("/").map(Number) as [number, number];
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const tags = createTagsLookup(store.db, "derived");
  const jobs = jobsFor(si, sn, arg("--only"));
  const rowsOut: Row[] = [];
  for (const j of jobs) {
    const { dcs, cn, mb } = await analyse(j, lookup, tags);
    if (!mb) { console.error(`no manaBase: ${j.name}`); continue; }
    const library = dcs.filter((dc) => !cn.includes(dc.card.name));
    const commanders = dcs.filter((dc) => cn.includes(dc.card.name));
    const identity = [...(deckIdentity(dcs, cn) ?? [])];
    const mask = colorMask(identity.length > 0 ? identity : ["W", "U", "B", "R", "G"]);
    const t = toTarget(library, mb.target, dcs);
    rowsOut.push({
      name: j.name, kind: j.kind, lands: mb.actual, target: mb.target, colourMiss: mb.colourMiss, tappedLands: mb.tappedLands, identity,
      base: run(library, commanders, {}), allCol: run(library, commanders, { landColours: mask }), untapped: run(library, commanders, { landsUntapped: true }),
      atTarget: t.note === "at target" ? null : run(t.deck, commanders, {}), targetNote: t.note,
    });
    console.error(`${rowsOut.length}/${jobs.length} ${j.name} lost ${rowsOut.at(-1)!.base.lost.toFixed(2)}`);
  }
  writeFileSync(out, JSON.stringify(rowsOut));
  await store.close();
}

const FIXTURE = new URL("../../packages/instruments/data/mana-base-fit-rows.json", import.meta.url);

/** `--check`: re-derive every deck's colourMiss from Mongo and the shipped code, diff against the fixture. Exit 1 on any drift (a deck gone, a deck new, an x moved). */
async function check(): Promise<void> {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as FitRow[];
  const want = new Map(fixture.map((r) => [r.name, r.colourMiss]));
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const tags = createTagsLookup(store.db, "derived");
  const bad: string[] = [];
  const seen = new Set<string>();
  const jobs = jobsFor(0, 1);
  for (const j of jobs) {
    seen.add(j.name);
    const { mb } = await analyse(j, lookup, tags);
    const x = mb?.colourMiss;
    if (!want.has(j.name)) bad.push(`not in the fixture: ${j.name}`);
    else if (x === undefined || Math.abs(x - want.get(j.name)!) > 1e-9) bad.push(`${j.name}: fixture ${want.get(j.name)} now ${x}`);
  }
  for (const n of want.keys()) if (!seen.has(n)) bad.push(`in the fixture, no longer a deck: ${n}`);
  await store.close();
  console.log(`${jobs.length} decks re-derived against ${fixture.length} fixture rows: ${bad.length === 0 ? "no drift" : `${bad.length} DRIFTED`}`);
  for (const b of bad.slice(0, 30)) console.log(`  ${b}`);
  if (bad.length > 0) process.exitCode = 1;
}

const f3 = (x: number): string => x.toFixed(3);
const show = (label: string, f: Fit): string => `${label.padEnd(34)} n=${String(f.n).padStart(3)} slope ${f3(f.slope)}  R2 centred ${f3(f.r2Centred)} uncentred ${f3(f.r2Uncentred)} pearson ${f3(f.r2Pearson)}  mean x ${f3(f.meanX)} mean y ${f3(f.meanY)}`;

function report(): void {
  const orArm = process.argv.includes("--or");
  const all: Row[] = process.argv.slice(3).filter((f) => f.endsWith(".json") && f !== arg("--write-fixture")).flatMap((f) => JSON.parse(readFileSync(f, "utf8")) as Row[]);
  if (!orArm) for (const r of all) for (const k of ["base", "allCol", "untapped", "atTarget"] as const) { const l = r[k]; if (l) l.lost = l.screw + l.colour + l.flood; }
  const pre = all.filter((r) => r.kind === "precon"), cal = all.filter((r) => r.kind === "calibration");
  console.log(`decks ${all.length} (${pre.length} precons, ${cal.length} calibration); shipped colourMiss ${MANA_BASE_COST.colourMiss}, tapped ${MANA_BASE_COST.tapped}`);
  const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
  const colour = (r: Row): number => r.base.lost - r.allCol.lost, tapped = (r: Row): number => r.base.lost - r.untapped.lost;
  const count = (r: Row): number => r.atTarget ? r.base.lost - r.atTarget.lost : 0;
  console.log(`\nLOST TURNS PER TEN, mean over decks: base ${f3(mean(all.map((r) => r.base.lost)))} (screw ${f3(mean(all.map((r) => r.base.screw)))}, colour ${f3(mean(all.map((r) => r.base.colour)))}, flood ${f3(mean(all.map((r) => r.base.flood)))})`);
  console.log("WHERE THE LOST TURNS WERE (recorded: colours 0.62 avg, mono 0.08, three-colour 0.87, tapped 0.19, count 0.08):");
  const byN = (n: number): Row[] => all.filter((r) => r.identity.length === n);
  console.log(`  colours ${f3(mean(all.map(colour)))} avg; by identity size ${[1, 2, 3, 4, 5].map((n) => `${n}c ${f3(mean(byN(n).map(colour)))} (${byN(n).length})`).join(", ")}`);
  console.log(`  tapped ${f3(mean(all.map(tapped)))}; count ${f3(mean(all.map(count)))} (|delta| mean over decks off target ${f3(mean(all.filter((r) => r.atTarget).map((r) => Math.abs(count(r)))))}, ${all.filter((r) => r.atTarget).length} decks off target)`);
  console.log("\nCOLOUR  (y = lost(base) - lost(every land every colour), x = colourMiss)");
  console.log(show("all decks", fit(all.map((r) => r.colourMiss), all.map(colour))));
  console.log(show("precons only", fit(pre.map((r) => r.colourMiss), pre.map(colour))));
  console.log(show("calibration only", fit(cal.map((r) => r.colourMiss), cal.map(colour))));
  const preSlope = fit(pre.map((r) => r.colourMiss), pre.map(colour)).slope;
  console.log(show(`calibration at the PRECON slope`, fit(cal.map((r) => r.colourMiss), cal.map(colour), preSlope)));
  console.log(show(`all decks at the SHIPPED ${MANA_BASE_COST.colourMiss}`, fit(all.map((r) => r.colourMiss), all.map(colour), MANA_BASE_COST.colourMiss)));
  console.log(`  raw slope rounded to 3 places ${f3(round3(fit(all.map((r) => r.colourMiss), all.map(colour)).slope))}, shipped ${MANA_BASE_COST.colourMiss}`);
  const fixturePath = arg("--write-fixture");
  if (fixturePath) {
    const ways = (l: Lost): { screw: number; colour: number; flood: number } => ({ screw: l.screw, colour: l.colour, flood: l.flood });
    const fixture: FitRow[] = all.map((r) => ({ name: r.name, kind: r.kind, colourMiss: r.colourMiss, base: ways(r.base), allCol: ways(r.allCol) }));
    writeFileSync(fixturePath, JSON.stringify(fixture));
    console.log(`fixture: ${fixture.length} decks -> ${fixturePath}`);
  }
  console.log("\nTAPPED  (y = lost(base) - lost(every land untapped), x = lands that always enter tapped)");
  console.log(show("all decks", fit(all.map((r) => r.tappedLands), all.map(tapped))));
  console.log(show("precons only", fit(pre.map((r) => r.tappedLands), pre.map(tapped))));
  console.log(show(`all decks at the SHIPPED ${MANA_BASE_COST.tapped}`, fit(all.map((r) => r.tappedLands), all.map(tapped), MANA_BASE_COST.tapped)));
  console.log("\nCOUNT  (y = lost(base) - lost(at the land target); modelled = short/over quadratic in lands off target)");
  const off = all.filter((r) => r.atTarget);
  const model = (r: Row): number => { const d = r.lands - r.target; return d < 0 ? MANA_BASE_COST.short * d * d : MANA_BASE_COST.over * d * d; };
  console.log(show("modelled count cost vs measured", fit(off.map(model), off.map(count))));
  for (const [lo, hi] of [[1, 3], [3, 6], [6, 10], [10, 99]] as const) {
    const g = off.filter((r) => Math.abs(r.lands - r.target) >= lo && Math.abs(r.lands - r.target) < hi);
    if (g.length > 0) console.log(`  ${lo}-${hi} lands off: n=${g.length} measured ${f3(mean(g.map(count)))} modelled ${f3(mean(g.map(model)))}`);
  }
  const sh = off.filter((r) => r.lands < r.target), ov = off.filter((r) => r.lands > r.target);
  if (sh.length > 0) console.log(show("short: measured on d^2", fit(sh.map((r) => (r.lands - r.target) ** 2), sh.map(count))));
  if (ov.length > 0) console.log(show("over: measured on d^2", fit(ov.map((r) => (r.lands - r.target) ** 2), ov.map(count))));
}

if (process.argv[2] === "rows") await rows();
else if (process.argv[2] === "fit") report();
else if (process.argv[2] === "--check") await check();
else throw new Error("rows <out.json> | fit <rows.json...> | --check");
