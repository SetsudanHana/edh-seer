import { expect, test } from "vitest";
import type { DeckCard } from "./types.js";
import { pAtLeastMana, simulate } from "./goldfish.js";

/** N16. AN EXACT ANCHOR FOR THE RAMP ARM, which had none.
 *
 *  A1 validates the LANDS-ONLY curve against the closed form. The ramp arm is the part doing all the
 *  work — median +33.8pp on the headline cell — and nothing checked it, which is where N15 sat
 *  undetected through two adversarial reviews of this module: a fetch removed the EARLIEST land in
 *  draw order where every fetch says "then shuffle", and the model understated mana by 1.90pp on
 *  exactly the decks the feature was built for.
 *
 *  THIS IS AN ANCHOR, NOT A REPLACEMENT, and the refusal is on MEASUREMENTS: an exact DP costs 33ms
 *  on a deck shaped like this one, 6.2s on `fairdrazi` (475k states), and the colour dimension alone
 *  is 6.8M states at turn 8 — against the simulator's 63ms. What it CAN do is price a small synthetic
 *  deck exactly, which is all an anchor has to do.
 *
 *  IT MODELS THE SIMULATOR'S POLICY, NOT AN IDEAL PLAYER: seven cards, one draw per turn INCLUDING
 *  turn one, one untapped land per turn, then accelerants cast greedily cheapest-first, a rock paying
 *  the turn it lands (CR 302.6) and a dork waiting one. A DP that modelled a better player would
 *  disagree for a reason that is not a defect. */

/** The state is (lands seen, lands played, ramp seen, ramp online) — everything else is recoverable:
 *  cards seen is `7 + turn`, lands in hand is `seen - played`, ramp in hand is `seen - online`, and
 *  the filler count is the remainder. That is the collapse N17 records for the land dimension, plus
 *  one pair for the ramp category. */
type Key = string;
const DECK = 99, HAND = 7;

/** Exact P(mana >= m) per turn for a deck of `lands` untapped lands and `ramp` two-mana accelerants,
 *  everything else filler. `delay` is 0 for a rock (pays the turn it lands) and 1 for a dork. */
function exactCurve(lands: number, ramp: number, delay: 0 | 1, turns: number): number[][] {
  const filler = DECK - lands - ramp;
  // Probability of drawing each category next, given what has been seen.
  let dist = new Map<Key, number>();
  // The opening seven, as a hypergeometric over three categories.
  const logFact: number[] = [0];
  for (let i = 1; i <= DECK; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const choose = (n: number, k: number): number =>
    k < 0 || k > n ? 0 : Math.exp(logFact[n] - logFact[k] - logFact[n - k]);
  for (let l = 0; l <= Math.min(lands, HAND); l++) {
    for (let r = 0; r + l <= HAND && r <= ramp; r++) {
      const f = HAND - l - r;
      if (f < 0 || f > filler) continue;
      const p = (choose(lands, l) * choose(ramp, r) * choose(filler, f)) / choose(DECK, HAND);
      if (p > 0) dist.set(`${l}|0|${r}|0`, (dist.get(`${l}|0|${r}|0`) ?? 0) + p);
    }
  }

  const out: number[][] = [];
  for (let turn = 1; turn <= turns; turn++) {
    // Rule 1: draw one card, INCLUDING on turn one.
    const drawn = new Map<Key, number>();
    for (const [k, p] of dist) {
      const [ls, lp, rs, ro] = k.split("|").map(Number);
      const seen = HAND + turn - 1;
      const left = DECK - seen;
      const pl = (lands - ls) / left, pr = (ramp - rs) / left, pf = (filler - (seen - ls - rs)) / left;
      const add = (key: Key, q: number) => { if (q > 0) drawn.set(key, (drawn.get(key) ?? 0) + p * q); };
      add(`${ls + 1}|${lp}|${rs}|${ro}`, pl);
      add(`${ls}|${lp}|${rs + 1}|${ro}`, pr);
      add(`${ls}|${lp}|${rs}|${ro}`, pf);
    }

    // Rules 2-4, deterministic given the state.
    const next = new Map<Key, number>();
    const mana = new Map<number, number>();
    for (const [k, p] of drawn) {
      let [ls, lp, rs, ro] = k.split("|").map(Number);
      if (ls - lp > 0) lp++;                               // rule 2: one land per turn
      let pool = lp + ro;                                  // what the board makes right now
      let online = ro;                                     // ramp that already pays
      while (rs - online > 0 && pool >= 2) {                // rule 3: greedy, cheapest first
        pool -= 2;
        online++;
        if (delay === 0) pool += 1;                        // rule 4: a rock pays the turn it lands
      }
      const made = lp + (delay === 0 ? online : ro);       // a dork waits a turn
      mana.set(made, (mana.get(made) ?? 0) + p);
      next.set(`${ls}|${lp}|${rs}|${online}`, (next.get(`${ls}|${lp}|${rs}|${online}`) ?? 0) + p);
    }
    dist = next;
    const row: number[] = [];
    for (let m = 0; m <= 20; m++) {
      let q = 0;
      for (const [made, p] of mana) if (made >= m) q += p;
      row.push(q);
    }
    out.push(row);
  }
  return out;
}

const card = (name: string, typeLine: string, manaValue: number, oracleText: string, producedMana?: string[]): DeckCard =>
  ({ card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue, ...(producedMana ? { producedMana } : {}) } as never, tags: null });

const build = (lands: number, ramp: number, rampCard: (i: number) => DeckCard): DeckCard[] => [
  ...Array.from({ length: lands }, (_, i) => card(`Forest ${i}`, "Basic Land — Forest", 0, "", ["G"])),
  ...Array.from({ length: ramp }, (_, i) => rampCard(i)),
  ...Array.from({ length: DECK - lands - ramp }, (_, i) => card(`Spell ${i}`, "Sorcery", 4, "")),
];

const TRIALS = 20_000;
/** Three standard errors at 20,000 trials is 1.06pp at p = 0.5, so a real disagreement shows and
 *  sampling noise does not. */
const TOL = 0.015;

// THE COST, SPLIT: the DP is the cheap half. Measured on this file's own decks -- the exact curve
// is ~1ms and the 20,000-trial simulation it checks is ~180ms, so the anchor is affordable in
// `npm test` while an exact REPLACEMENT is not (6.2s on `fairdrazi`, and 6.8M states once colours
// enter). That asymmetry is the whole argument for anchoring rather than replacing.
test("N16: the exact DP is cheap enough to run in the suite", () => {
  const t0 = performance.now();
  exactCurve(36, 10, 0, 8);
  expect(performance.now() - t0).toBeLessThan(200);
});

test("N16: the ramp arm agrees with an exact DP — rocks, which pay the turn they land", () => {
  const rock = (i: number) => card(`Signet ${i}`, "Artifact", 2, "{T}: Add {C}.", ["C"]);
  const deck = build(36, 10, rock);
  const exact = exactCurve(36, 10, 0, 8);
  const sim = simulate(deck, { trials: TRIALS, turns: 8, seed: 20260826 });
  for (let t = 1; t <= 8; t++) {
    for (let m = 1; m <= 8; m++) {
      expect(Math.abs(pAtLeastMana(sim, m, t) - exact[t - 1][m])).toBeLessThan(TOL);
    }
  }
});

test("N16: the ramp arm agrees with an exact DP — dorks, which wait a turn", () => {
  const dork = (i: number) => card(`Bird ${i}`, "Creature — Bird", 2, "{T}: Add {C}.", ["C"]);
  const deck = build(36, 10, dork);
  const exact = exactCurve(36, 10, 1, 8);
  const sim = simulate(deck, { trials: TRIALS, turns: 8, seed: 20260826 });
  for (let t = 1; t <= 8; t++) {
    for (let m = 1; m <= 8; m++) {
      expect(Math.abs(pAtLeastMana(sim, m, t) - exact[t - 1][m])).toBeLessThan(TOL);
    }
  }
});

/** THE CASE THAT WOULD HAVE CAUGHT N15. A fetch searches a land out of the library and every fetch
 *  says "then shuffle", so the residual library is EXCHANGEABLE — which is exactly what makes a
 *  counts-only DP correct here. Removing the earliest land in draw order instead leaves a residual
 *  that is not exchangeable, so the simulator and this function disagree, which is the disagreement
 *  the ramp arm had no instrument to see. */
function exactFetchCurve(lands: number, fetches: number, turns: number): number[][] {
  const filler = DECK - lands - fetches;
  const logFact: number[] = [0];
  for (let i = 1; i <= DECK; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const choose = (n: number, k: number): number =>
    k < 0 || k > n ? 0 : Math.exp(logFact[n] - logFact[k] - logFact[n - k]);

  let dist = new Map<Key, number>();
  for (let l = 0; l <= Math.min(lands, HAND); l++) {
    for (let r = 0; r + l <= HAND && r <= fetches; r++) {
      const f = HAND - l - r;
      if (f < 0 || f > filler) continue;
      const p = (choose(lands, l) * choose(fetches, r) * choose(filler, f)) / choose(DECK, HAND);
      if (p > 0) dist.set(`${l}|0|${r}|0`, (dist.get(`${l}|0|${r}|0`) ?? 0) + p);
    }
  }

  const out: number[][] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const drawn = new Map<Key, number>();
    for (const [k, p] of dist) {
      const [ls, lp, fs, fc] = k.split("|").map(Number);
      const seen = HAND + turn - 1;
      // A FETCH TOOK A LAND OUT OF THE LIBRARY, so both the deck size and the land count shrink.
      const left = DECK - seen - fc;
      if (left <= 0) { drawn.set(k, (drawn.get(k) ?? 0) + p); continue; }
      const landsLeft = lands - ls - fc;
      const fetchLeft = fetches - fs;
      const pl = landsLeft / left, pf = fetchLeft / left, px = (left - landsLeft - fetchLeft) / left;
      const add = (key: Key, q: number) => { if (q > 0) drawn.set(key, (drawn.get(key) ?? 0) + p * q); };
      add(`${ls + 1}|${lp}|${fs}|${fc}`, pl);
      add(`${ls}|${lp}|${fs + 1}|${fc}`, pf);
      add(`${ls}|${lp}|${fs}|${fc}`, px);
    }

    const next = new Map<Key, number>();
    const mana = new Map<number, number>();
    for (const [k, p] of drawn) {
      let [ls, lp, fs, fc] = k.split("|").map(Number);
      if (ls - lp > 0) lp++;
      let pool = lp + fc;
      let cast = fc;
      while (fs - cast > 0 && pool >= 2) { pool -= 2; cast++; pool += 1; }  // the fetched land is untapped
      const made = lp + cast;
      mana.set(made, (mana.get(made) ?? 0) + p);
      next.set(`${ls}|${lp}|${fs}|${cast}`, (next.get(`${ls}|${lp}|${fs}|${cast}`) ?? 0) + p);
    }
    dist = next;
    const row: number[] = [];
    for (let m = 0; m <= 20; m++) {
      let q = 0;
      for (const [made, p] of mana) if (made >= m) q += p;
      row.push(q);
    }
    out.push(row);
  }
  return out;
}

test("N16: a land-fetch agrees with an exact DP, which is the check N15 did not have", () => {
  const FETCH = "Search your library for a basic land card, put it onto the battlefield, then shuffle.";
  const deck = build(30, 12, (i) => card(`Lore ${i}`, "Sorcery", 2, FETCH));
  const exact = exactFetchCurve(30, 12, 8);
  const sim = simulate(deck, { trials: TRIALS, turns: 8, seed: 20260826 });
  for (let t = 1; t <= 8; t++) {
    for (let m = 1; m <= 8; m++) {
      expect(Math.abs(pAtLeastMana(sim, m, t) - exact[t - 1][m])).toBeLessThan(TOL);
    }
  }
});
