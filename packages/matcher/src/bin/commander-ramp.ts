/** DOES THE RAMP PACKAGE GET THE COMMANDER DOWN SOONER? (roadmap L2). FREE — Mongo reads only, no
 *  model, no spend.
 *
 *  THE OWNER'S CLAIM: *"my Samut deck because commander is 6 cmc needs a lot of ramp to try to cast
 *  her as soon as possible."* §4 of the sources review could not separate it by CORRELATION
 *  (`r(commanderMV, ramp) = 0.14`, against 0.35 for the deck's own average mana value — an expensive
 *  commander sits in an expensive deck). This answers it by COUNTERFACTUAL instead, per deck, where
 *  there is no collinearity to fight.
 *
 *  §4 FILED THIS AGAINST THE WRONG INSTRUMENT, and that is the reason this bin exists.
 *  `commanderCast` (`castability.commanders`) prices its headline off LANDS ONLY, so replacing a
 *  nonland ramp slot with another nonland changes no argument of that call: measured, it moves in
 *  **0 of 70** priced commanders, exactly 0.00pp. Its upper bound moves but can see only 48% of the
 *  ramp slots, because a land-fetch spell produces no mana of its own. `goldfish.ts` (I11) models
 *  land-fetch, and it is what can answer this.
 *
 *  THE OUTPUT IS A TURN, NOT A PROBABILITY. §4 called the test "exact"; a Monte Carlo answer is not,
 *  so the deliverable is the quantity that survives the policy arm — the median turn the board first
 *  reaches the commander's mana value, with p25/p75 beside it and the censored share printed.
 *
 *  EVERY FIGURE IS A CEILING UNDER A MANA-MAXIMISING POLICY. Read `goldfish.ts` before quoting one,
 *  and read the colour ceiling too: this model is colour-blind, so a turn here is about mana
 *  QUANTITY and says nothing about whether you can pay the pips.
 *
 *    commander-ramp.ts                 the 71-deck sweep, one row per commander
 *    commander-ramp.ts --deck <name>   one deck, both policies, the whole curve
 *    commander-ramp.ts --criteria      R1-R4, the registered criteria that need the corpus */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections } from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { detectBuildCategories } from "../build.js";
import { costRefusal } from "../castability.js";
import { quantiles, simulate, type SimulateResult } from "../goldfish.js";
import { castTurnStats, castTurns, silenceRamp, type CastTurn } from "./commander-ramp-core.js";
import type { DeckCard } from "../types.js";

const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const DECK_DIR_ALT = join(process.cwd(), "packages", "cli", "decks");
const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TRIALS = Number(arg("--trials") ?? 20_000);
const TURNS = 10;
const SEED = Number(arg("--seed") ?? 20260825);
/** The alternative policy arm, from I11's C8: mana held back before casting an accelerant. */
const HOLD_UP = 2;

interface Row {
  deck: string; commander: string; mv: number;
  ramp: number; silenced: number; blind: number;
  /** [greedy, hold-up-2] */
  withRamp: [CastTurn, CastTurn];
  without: [CastTurn, CastTurn];
  refused?: string;
}

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const cardTags = createTagsLookup(store.db);

async function load(file: string, dir: string): Promise<{ deck: DeckCard[]; commanders: string[] }> {
  const s = parseDecklistSections(readFileSync(join(dir, file), "utf8"));
  const deck: DeckCard[] = [];
  for (const n of [...s.commanders, ...s.deck]) {
    const doc = await lookup.findByName(normalizeName(n));
    if (doc) deck.push({ card: docToCard(doc), tags: await cardTags.findOne(String(doc._id)) });
  }
  return { deck, commanders: s.commanders };
}

async function rowsFor(file: string, dir: string): Promise<Row[]> {
  const { deck, commanders } = await load(file, dir);
  const cmdrSet = new Set(commanders.map(normalizeName));
  // DEDUPED BY NAME: a Moxfield export names the commander in the head block AND in the decklist,
  // so the same card arrives twice — J12's finding, one report over.
  const seenName = new Set<string>();
  const cmdrCards = deck.filter((dc) => cmdrSet.has(normalizeName(dc.card.name))
    && !seenName.has(dc.card.name) && seenName.add(dc.card.name) !== null);
  // CR 903.6: a commander starts in the command zone, so it is never in the library the model draws.
  const library = deck.filter((dc) => !cmdrSet.has(normalizeName(dc.card.name)));
  if (cmdrCards.length === 0) return [];

  const rampNames = detectBuildCategories([...library]).get("ramp") ?? new Set<string>();
  const { deck: bare, silenced, blind } = silenceRamp(library, rampNames);

  const sims = (d: readonly DeckCard[]): [SimulateResult, SimulateResult] => [
    simulate(d, { trials: TRIALS, turns: TURNS, seed: SEED }),
    simulate(d, { trials: TRIALS, turns: TURNS, seed: SEED, holdUp: HOLD_UP }),
  ];
  const [withA, withB] = sims(library);
  const [woA, woB] = sims(bare);

  return cmdrCards.map((c) => {
    const mv = c.card.manaValue;
    // THE COST REFUSALS ARE REUSED, NOT RE-TYPED. An {X} or free-cast commander's printed mana value
    // is not what you pay, so a turn computed from it would be a confident wrong answer.
    const refused = costRefusal(c);
    const st = (r: SimulateResult): CastTurn => castTurnStats(castTurns(r, mv), TURNS);
    return {
      deck: file.replace(/\.txt$/, ""), commander: c.card.name, mv,
      ramp: rampNames.size, silenced, blind,
      withRamp: [st(withA), st(withB)], without: [st(woA), st(woB)],
      ...(refused ? { refused } : {}),
    };
  });
}

const files = readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort();
const one = arg("--deck");

if (one) {
  const file = files.find((f) => f === `${one}.txt` || f === one);
  const alt = file ? undefined : readdirSync(DECK_DIR_ALT).filter((f) => f.endsWith(".txt"))
    .find((f) => f === `${one}.txt` || f === one);
  if (!file && !alt) { console.log(`no such deck: ${one}`); await store.close(); process.exit(1); }
  for (const r of await rowsFor((file ?? alt)!, file ? DECK_DIR : DECK_DIR_ALT)) {
    console.log(`\n${r.deck} — ${r.commander}, mana value ${r.mv} · ${TRIALS} trials, seed ${SEED}`);
    console.log(`  ramp package ${r.ramp} · ${r.silenced} silenced · ${r.blind} the model cannot classify`
      + (r.blind > 0 ? " (so the arm UNDER-states)" : ""));
    if (r.refused) console.log(`  REFUSED: ${r.refused}`);
    for (const [i, label] of [[0, "spend everything"], [1, `hold up ${HOLD_UP}`]] as const) {
      const w = r.withRamp[i], o = r.without[i];
      const c = (t: CastTurn): string => `T${t.median} [${t.p25}-${t.p75}]`
        + (t.censored > 0 ? ` · ${(t.censored * 100).toFixed(0)}% never` : "");
      console.log(`  ${label.padEnd(16)} with ramp ${c(w).padEnd(34)} without ${c(o)}`);
    }
  }
  await store.close();
  process.exit(0);
}

const rows: Row[] = [];
for (const file of files) rows.push(...await rowsFor(file, DECK_DIR));
await store.close();

const priced = rows.filter((r) => !r.refused);
/** The delay, in turns, under one policy. Censored medians are compared at horizon+1, so a deck that
 *  goes from "turn 8" to "never" reads as a delay rather than as no change. */
const num = (s: string): number => s.startsWith(">") ? TURNS + 1 : Number(s);
const delay = (r: Row, i: 0 | 1): number => num(r.without[i].median) - num(r.withRamp[i].median);

console.log(`${rows.length} commanders over ${files.length} decks · ${TRIALS} trials · seed ${SEED}`);
console.log(`  ${priced.length} priced, ${rows.length - priced.length} refused on cost\n`);
console.log(`  ${"deck".padEnd(32)} ${"MV".padStart(2)} ${"ramp".padStart(4)} ${"blind".padStart(5)}  `
  + `${"with".padStart(12)} ${"without".padStart(12)} ${"delay".padStart(6)}  ${"hold-2 delay".padStart(12)}`);
/** BOTH ARMS PAST THE HORIZON: the delay is not measurable as a turn, and printing the `+0` that
 *  falls out of comparing two `>N` medians is a WRONG SENTENCE about the decks where ramp matters
 *  most. The censored share is what moved, so that is what the row says. These rows still enter R1
 *  and R2 at +0, which UNDER-states — the correct failure direction, stated rather than corrected
 *  after the fact. */
const floored = (r: Row): boolean => r.withRamp[0].median.startsWith(">") && r.without[0].median.startsWith(">");
for (const r of priced) {
  const c = (t: CastTurn): string => `T${t.median}` + (t.censored > 0 ? `(${(t.censored * 100).toFixed(0)}%x)` : "");
  const d = (i: 0 | 1): string => floored(r)
    ? `${(r.withRamp[i].censored * 100).toFixed(0)}>${(r.without[i].censored * 100).toFixed(0)}%x`
    : `${delay(r, i) >= 0 ? "+" : ""}${delay(r, i)}`;
  console.log(`  ${r.deck.padEnd(32)} ${String(r.mv).padStart(2)} ${String(r.ramp).padStart(4)} ${String(r.blind).padStart(5)}  `
    + `${c(r.withRamp[0]).padStart(12)} ${c(r.without[0]).padStart(12)} ${d(0).padStart(9)}  ${d(1).padStart(12)}`);
}

// R1-R4. Registered in the spec BEFORE any of these numbers existed.
const d0 = priced.map((r) => delay(r, 0)), d1 = priced.map((r) => delay(r, 1));
const moved = d0.filter((v) => v > 0).length;
console.log(`\n  R1  ramp delays the commander in ${moved}/${priced.length} decks `
  + `(median ${quantiles(d0).median} turns, p25/p75 ${quantiles(d0).p25}/${quantiles(d0).p75}) — `
  + `${moved > priced.length / 2 ? "PASS" : "FAIL"}`);
console.log(`      ${priced.filter(floored).length} rows are CENSORED-FLOORED (both arms past turn ${TURNS}) and enter R1/R2 at +0, so both UNDER-state`);

const bucket = (f: (mv: number) => boolean): number[] => priced.filter((r) => f(r.mv)).map((r) => delay(r, 0));
const cheap = bucket((mv) => mv <= 3), dear = bucket((mv) => mv >= 5);
const med = (v: number[]): number => v.length === 0 ? 0 : quantiles(v).median;
console.log(`  R2  median delay: commander MV<=3 (n=${cheap.length}) ${med(cheap)} turns · MV>=5 (n=${dear.length}) ${med(dear)} turns — `
  + `${med(dear) > med(cheap) ? "PASS" : "FAIL"}`);
for (const [label, f] of [["<=3", (mv: number) => mv <= 3], ["4", (mv: number) => mv === 4],
  ["5", (mv: number) => mv === 5], [">=6", (mv: number) => mv >= 6]] as const) {
  const v = bucket(f);
  console.log(`        MV ${label.padStart(3)}  n=${String(v.length).padStart(2)}  median delay ${med(v)}  ·  mean ${(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)).toFixed(2)}`);
}

const same = priced.filter((r) => r.withRamp[0].median === r.withRamp[1].median
  && r.without[0].median === r.without[1].median).length;
const sameDelay = d0.filter((v, i) => v === d1[i]).length;
console.log(`  R3  turn identical under both policies in ${same}/${priced.length} decks; `
  + `the DELAY is identical in ${sameDelay}/${priced.length} — `
  + `${same >= 0.9 * priced.length ? "PASS" : "FAIL"}`);
console.log(`      (re-run with --seed for R4)`);
