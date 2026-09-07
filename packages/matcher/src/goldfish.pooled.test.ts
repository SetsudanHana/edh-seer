import { expect, test } from "vitest";
import { classifyAccelerant, simulate } from "./goldfish.js";
import type { DeckCard } from "./types.js";

/** THE SENTINEL FOR POOLING, which is the one claim in `goldfish.ts` that nothing else can contradict.
 *
 *  `simulate` shares a trial across the class of cards that trial cannot tell apart, and it is allowed
 *  to because a non-accelerant nonland reaches the trajectory through EXACTLY ONE channel: its pips
 *  enter `demandPips`, which steers `pickLand`. It is never cast, never touches `pool`. Give such a
 *  card a second channel -- let the sim read its mana value, its type, its text -- and every pooled
 *  cell goes quietly wrong, with no exception thrown and no test failing anywhere else.
 *
 *  So this file runs both arms and holds them together. MEASURED with the separation deliberately
 *  broken (accelerants pooled with each other instead of kept apart): Manalith moved 11.9pp and its
 *  denominator went 1,992 -> 5,964. Measured with it intact: every accelerant cell is EXACTLY equal
 *  across the arms, and the widest pooled-vs-unpooled gap anywhere is 1.35pp of ordinary Monte Carlo
 *  noise. The exact half is the sharp end of this test; the tolerance half would catch a break of
 *  about 3pp or worse and is honest about not catching a smaller one. */

const card = (
  name: string, typeLine: string, manaValue: number, manaCost?: string,
  oracleText = "", producedMana?: string[],
): DeckCard => ({
  card: {
    name, typeLine, oracleText, keywords: [], colors: [], manaValue,
    ...(manaCost ? { manaCost } : {}), ...(producedMana ? { producedMana } : {}),
  } as never,
  tags: null,
});

const basics = (n: number, type: string, name: string): DeckCard[] =>
  Array.from({ length: n }, (_, i) => card(`${name} ${i}`, `Basic Land — ${type}`, 0));

const rock = (name: string, manaValue: number, cost: string, adds: string, produced: string[]) =>
  card(name, "Artifact", manaValue, cost, `{T}: Add ${adds}.`, produced);

/** Two colours so `pickLand` has a real choice to make, three accelerants that produce DIFFERENT
 *  amounts on different turns, and four pip patterns so pooling has classes to build. */
const ROCKS = [
  rock("Sol Ring", 1, "{1}", "{C}{C}", ["C"]),
  rock("Fellwar Stone", 2, "{2}", "{B}", ["B"]),
  rock("Manalith", 3, "{3}", "{B}", ["B"]),
];
const SPELLS = [
  ["{2}{B}", 3], ["{1}{B}{B}", 3], ["{2}{G}", 3], ["{B}{G}", 2],
].flatMap(([cost, mv]) => Array.from({ length: 14 }, (_, i) =>
  card(`S${cost as string}-${i}`, "Sorcery", mv as number, cost as string)));
const DECK = [...basics(19, "Swamp", "Swamp"), ...basics(18, "Forest", "Forest"), ...ROCKS, ...SPELLS];
const COMMANDER = card("Atraxa", "Legendary Creature — Angel", 4, "{2}{B}{G}");

const TRIALS = 20_000;
const OPTS = { trials: TRIALS, turns: 6, seed: 11, alsoPrice: [COMMANDER] } as const;
const pooled = simulate(DECK, OPTS);
const unpooled = simulate(DECK, { ...OPTS, pooled: false });

test("the deck under test really does hold accelerants, or the exactness check below proves nothing", () => {
  expect(ROCKS.map((r) => classifyAccelerant(r)?.kind)).toEqual(["rock", "rock", "rock"]);
});

test("an accelerant and a commander are never pooled, and their cells are EXACTLY unchanged", () => {
  // An accelerant CHANGES the board it is held in, so it is not exchangeable with anything and stays
  // its own class. A commander is priced from the command zone (CR 903.6) and is held in every trial,
  // so it is its own class too. Both are exact: no tolerance, because there is nothing to average.
  for (const name of [...ROCKS.map((r) => r.card.name), "Atraxa"]) {
    expect(pooled.byCardHeld.get(name)).toEqual(unpooled.byCardHeld.get(name));
    expect(pooled.byCardCastable.get(name)).toEqual(unpooled.byCardCastable.get(name));
    expect(pooled.byCard.get(name)).toEqual(unpooled.byCard.get(name));
  }
});

test("pooling multiplies the denominator it is there to multiply", () => {
  // 14 cards share each pip pattern, so each of them should see about fourteen times the samples.
  // If this ratio ever collapses to 1, pooling has stopped happening and the trial count is back to
  // being the only thing standing behind a cell -- at `REPORT_TRIALS`, which is 2,000.
  const name = "S{2}{B}-0";
  const gain = pooled.byCardHeld.get(name)![3] / unpooled.byCardHeld.get(name)![3];
  expect(gain).toBeGreaterThan(10);
});

test("and it does not move the answer: both arms agree inside Monte Carlo noise", () => {
  let worst = 0, worstAt = "";
  for (const [name, pa] of pooled.byCardCastable) {
    const pb = unpooled.byCardCastable.get(name)!;
    for (let t = 1; t < 6; t++) {
      const d = Math.abs(pa[t] - pb[t]);
      if (d > worst) { worst = d; worstAt = `${name} turn ${t + 1}`; }
    }
  }
  // NAMED, not just bounded: "0.031 is not less than 0.03" tells the next reader nothing about which
  // card broke, and the card is the whole lead on what channel opened.
  const verdict = worst < 0.03 ? "inside noise" : `${(worst * 100).toFixed(2)}pp at ${worstAt}`;
  expect(verdict).toBe("inside noise");
});
