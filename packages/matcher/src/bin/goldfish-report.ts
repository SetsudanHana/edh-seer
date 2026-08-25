/** THE MANA AVAILABILITY INSTRUMENT (roadmap I11). FREE — Mongo reads only, no model, no spend.
 *
 *  NOTHING IMPORTS THE MODEL INTO A SCORE. `goldfish.ts` is a leaf and this is its only caller, which
 *  is the condition the K7/J7 reconciliation holds under: report wiring is a separate later item, and
 *  it is where the refused quantities could leak into a headline.
 *
 *    goldfish-report.ts                  the 71-deck sweep, one row per deck
 *    goldfish-report.ts --deck <name>    one deck's full curve, with the spread
 *    goldfish-report.ts --criteria       C4 and C8, the two criteria that need the corpus
 *
 *  EVERY FIGURE IS A CEILING UNDER A MANA-MAXIMISING POLICY, not an expectation — rule 3 casts every
 *  accelerant it can afford and the owner's own decks hold mana up for interaction. Read the policy
 *  in `goldfish.ts` before quoting any number here. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections } from "@mtg/data";
import { classifyAccelerant, pAtLeastMana, quantiles, simulate } from "../goldfish.js";
import type { DeckCard } from "../types.js";

const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
/** §5's headline deck (`samut.txt`) lives one directory up, outside the calibration set. `--deck`
 *  falls back to it so criterion R — the shipped bin must reproduce the spec's own tables — is
 *  actually reachable rather than a claim about a probe that no longer exists. */
const DECK_DIR_ALT = join(process.cwd(), "packages", "cli", "decks");
const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TRIALS = Number(arg("--trials") ?? 20_000);
const TURNS = 8;
const SEED = Number(arg("--seed") ?? 20260822);

/** The headline cell: six mana on turn six. Chosen because it is where §5's measured failure lives
 *  (Samut reads [34.1%, 43.5%] against a simulated 55.8%), NOT swept. */
const HEADLINE_MANA = 6;
const HEADLINE_TURN = 6;

const store = await connect(loadConfig());
const lookup = mongoLookup(store);

async function loadDeck(file: string, dir: string = DECK_DIR): Promise<DeckCard[]> {
  const s = parseDecklistSections(readFileSync(join(dir, file), "utf8"));
  const out: DeckCard[] = [];
  for (const n of [...s.commanders, ...s.deck]) {
    const doc = await lookup.findByName(normalizeName(n));
    // A COMMANDER IS NOT IN THE LIBRARY (CR 903.6) and this model draws from the library, so it is
    // excluded here exactly as `deck-math.ts` excludes it — including one from the shuffle would
    // both dilute the draw and pretend it can be drawn.
    if (doc && !s.commanders.map(normalizeName).includes(normalizeName(n))) out.push({ card: docToCard(doc), tags: null });
  }
  return out;
}

const files = readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort();

/** `--deck`: one deck's whole curve, with the spread on every row. */
const one = arg("--deck");
if (one) {
  const file = files.find((f) => f === `${one}.txt` || f === one);
  const altFiles = readdirSync(DECK_DIR_ALT).filter((f) => f.endsWith(".txt"));
  const alt = file ? undefined : altFiles.find((f) => f === `${one}.txt` || f === one);
  if (!file && !alt) { console.log(`no such deck: ${one}`); await store.close(); process.exit(1); }
  const deck = await loadDeck((file ?? alt)!, file ? DECK_DIR : DECK_DIR_ALT);
  const accel = deck.map(classifyAccelerant).filter((a) => a !== null);
  const r = simulate(deck, { trials: TRIALS, turns: TURNS, seed: SEED });
  console.log(`${file ?? alt} — ${deck.length} library cards, ${accel.length} accelerants (${TRIALS} trials, seed ${SEED})`);
  console.log(`  accelerants: ${accel.map((a) => `${a!.name} [${a!.kind} ${a!.manaValue}]`).join(" · ")}`);
  console.log("\n  turn   mana p25/median/p75   payable share p25/median/p75   P(>=6 mana)");
  for (let t = 1; t <= TURNS; t++) {
    const m = quantiles(r.manaAt[t - 1]);
    const p = quantiles(r.payableShareAt[t - 1]);
    const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
    console.log(`  ${String(t).padStart(4)}   ${m.p25}/${m.median}/${m.p75}`.padEnd(28)
      + `   ${pct(p.p25)}/${pct(p.median)}/${pct(p.p75)}`.padEnd(32)
      + `   ${(pAtLeastMana(r, HEADLINE_MANA, t) * 100).toFixed(1)}%`);
  }
  await store.close();
  process.exit(0);
}

/** C4 and C8 — the two registered criteria that need the corpus rather than a fixture. */
const criteria = process.argv.includes("--criteria");

const rows: { deck: string; accelerants: number; headline: number; held: number; landsOnly: number }[] = [];
for (const file of files) {
  const deck = await loadDeck(file);
  const accelerants = deck.map(classifyAccelerant).filter((a) => a !== null).length;
  const r = simulate(deck, { trials: TRIALS, turns: TURNS, seed: SEED });
  // THE ALTERNATIVE POLICY IS RUN FOR EVERY DECK, NOT ONLY UNDER `--criteria`, because the point
  // readout is WITHDRAWN (the whole-item falsifier fired) and the pair of policies IS the output.
  const held = simulate(deck, { trials: TRIALS, turns: TURNS, seed: SEED, holdUp: 2 });
  // THE COUNTERFACTUAL IS THE SAME DECK WITH THE ACCELERANTS INERT, not a different deck: swapping
  // them out would change the library size and measure that instead. This is the mechanism test.
  const inert: DeckCard[] = deck.map((dc) => classifyAccelerant(dc)
    ? { card: { ...dc.card, producedMana: [], oracleText: "" }, tags: null }
    : dc);
  const bare = simulate(inert, { trials: TRIALS, turns: TURNS, seed: SEED });
  rows.push({
    deck: file.replace(/\.txt$/, ""),
    accelerants,
    headline: pAtLeastMana(r, HEADLINE_MANA, HEADLINE_TURN),
    held: pAtLeastMana(held, HEADLINE_MANA, HEADLINE_TURN),
    landsOnly: pAtLeastMana(bare, HEADLINE_MANA, HEADLINE_TURN),
  });
}

const deltas = rows.map((r) => r.headline - r.landsOnly).sort((a, b) => a - b);
const q = quantiles(deltas);
const accelCounts = rows.map((r) => r.accelerants).sort((a, b) => a - b);
console.log(`${rows.length} decks · ${TRIALS} trials · seed ${SEED} · headline cell P(>=${HEADLINE_MANA} mana at turn ${HEADLINE_TURN})`);
console.log(`  accelerants per deck: min ${accelCounts[0]} · median ${quantiles(accelCounts).median} · max ${accelCounts[accelCounts.length - 1]}`);
console.log(`  ramp is worth: p25 ${(q.p25 * 100).toFixed(1)}pp · MEDIAN ${(q.median * 100).toFixed(1)}pp · p75 ${(q.p75 * 100).toFixed(1)}pp`);
console.log(`  decks where ramp helps at all: ${rows.filter((r) => r.headline > r.landsOnly).length}/${rows.length}`);
// THE POINT READOUT IS WITHDRAWN AND THIS INTERVAL IS WHAT SURVIVES — the item's own registered
// falsifier fired: policy sensitivity measured 27.6pp against a 32.7pp median ramp signal, i.e.
// mana availability is a POLICY property at this deck's scale. The two arms are the two policies:
// spend-everything (a ceiling) and hold-up-2 (nearer how the owner's decks are actually played).
const widths = rows.map((r) => Math.abs(r.headline - r.held)).sort((a, b) => a - b);
const w = quantiles(widths);
console.log(`  THE OUTPUT IS AN INTERVAL, NOT A POINT (the falsifier fired -- see the module):`);
console.log(`    width p25 ${(w.p25 * 100).toFixed(1)}pp · median ${(w.median * 100).toFixed(1)}pp · p75 ${(w.p75 * 100).toFixed(1)}pp`);

if (criteria) {
  // C4 NEGATIVE ARM — the mechanism test, and the one that separates "measures ramp" from "measures
  // library size". Decks at or below the corpus MINIMUM must barely move.
  const min = accelCounts[0];
  const thin = rows.filter((r) => r.accelerants <= Math.max(min, 3));
  console.log(`\nC4 negative arm — decks with <= ${Math.max(min, 3)} accelerants: ${thin.length}`);
  for (const r of thin) console.log(`  ${r.deck.padEnd(38)} ${r.accelerants} accelerants · ${((r.headline - r.landsOnly) * 100).toFixed(1)}pp`);
  const worst = Math.max(0, ...thin.map((r) => r.headline - r.landsOnly));
  console.log(`  worst move: ${(worst * 100).toFixed(1)}pp  (registered bound: < 5pp)  -> ${worst < 0.05 ? "PASS" : "FAIL"}`);

  // C8 POLICY SENSITIVITY, WITH ITS DEMOTION RULE. The alternative policy holds up two mana rather
  // than spending everything, which is what the owner's own decks actually do. IF THE POLICY DELTA
  // RIVALS THE RAMP SIGNAL, THE POINT READOUT IS WITHDRAWN AND AN INTERVAL SHIPS — the resolution
  // `castability.ts` already reached, for the same reason.
  console.log("\nC8 policy sensitivity — hold up 2 mana before casting an accelerant");
  const worstPolicy = Math.max(...rows.map((r) => Math.abs(r.headline - r.held)));
  const rampSignal = q.median;
  console.log(`  worst policy delta ${(worstPolicy * 100).toFixed(1)}pp against a median ramp signal of ${(rampSignal * 100).toFixed(1)}pp`);
  console.log(`  demotion rule (policy delta > half the ramp signal -> withdraw the point readout): ${
    worstPolicy > rampSignal / 2 ? "TRIGGERED — ship an interval" : "not triggered"}`);
}

console.log("\n  worst ten by ramp value:");
for (const r of [...rows].sort((a, b) => (b.headline - b.landsOnly) - (a.headline - a.landsOnly)).slice(0, 10)) {
  const lo = Math.min(r.headline, r.held) * 100, hi = Math.max(r.headline, r.held) * 100;
  console.log(`  ${r.deck.padEnd(38)} ${String(r.accelerants).padStart(2)} accelerants · lands-only ${(r.landsOnly * 100).toFixed(1)}% -> [${lo.toFixed(1)}%, ${hi.toFixed(1)}%]  (+${((r.headline - r.landsOnly) * 100).toFixed(1)}pp at the ceiling)`);
}

await store.close();
