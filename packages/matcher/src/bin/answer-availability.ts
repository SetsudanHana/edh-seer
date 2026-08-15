/** Mean answer availability across the 71 decks, priced at a FIXED turn 5 against each deck's OWN
 *  clock. Free: Mongo reads only. `--blind` withholds the commanders, which is what the engine did
 *  before 47f2ebf and is the only way to re-read a figure measured then.
 *
 *  Written to re-read the payoff recorded in ROADMAP item G, "mean answer availability
 *  29.5% -> 38.0%": both halves of it were computed with `commanderNames` EMPTY, because
 *  `parseDecklistSections` could not read the headerless convention. `--blind` reproduces it at
 *  29.5% -> 38.1%, mean shift 8.6pp, largest 21.9pp — so this instrument is the same one, and the
 *  difference below is the commander rather than a different measurement.
 *
 *  WITH the commanders: **29.8% -> 36.7%, mean shift 6.9pp, largest 18.3pp**. Smaller, and still the
 *  same finding. Two effects, both correct and opposed: the clock is FASTER (median 9 -> 8), which
 *  prices fewer cards seen and lowers the own-clock figure, while a commander-supplied answer is
 *  available with probability 1 rather than drawn — though that is 1 answer class in 1 deck of 71,
 *  so it is the clock doing nearly all of the work. Decks priced from `CORPUS_MEDIAN_CLOCK` fall
 *  5 -> 2: hidetsugu-and-kairi, magar-spellslinger and voltron-mill have no combat clock in the 99
 *  and get one from the command zone, which for a voltron deck is the whole plan. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@mtg/data";
import type { CardTags } from "@mtg/tagger";
import { computeDeckMath } from "../deck-math.js";
import { loadHierarchy } from "../hierarchy.js";
import type { DeckCard } from "../types.js";

const DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const WITH_COMMANDERS = !process.argv.includes("--blind");
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tagsCol = store.db.collection("cardTagsDerived");
const hierarchy = await loadHierarchy();

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const rows: { deck: string; five: number; own: number; turn: number; src: string; cz: number }[] = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(join(DIR, file), "utf8"));
  const deck: DeckCard[] = [];
  for (const name of [...sections.commanders, ...sections.deck]) {
    const doc = await lookup.findByName(normalizeName(name));
    if (!doc) continue;
    deck.push({ card: docToCard(doc), tags: (await tagsCol.findOne({ oracleId: doc._id })) as CardTags | null });
  }
  const cmd = WITH_COMMANDERS ? sections.commanders : [];
  const avail = (m: ReturnType<typeof computeDeckMath>) => mean(m.answers.map((a) => a.available));
  const atFive = computeDeckMath(deck, hierarchy, cmd, 5);
  const atClock = computeDeckMath(deck, hierarchy, cmd);
  rows.push({
    deck: file.replace(/\.txt$/, ""), five: avail(atFive), own: avail(atClock),
    turn: atClock.turn, src: atClock.turnSource,
    cz: atClock.answers.filter((a) => a.fromCommandZone).length,
  });
  process.stdout.write(".");
}
await store.close();

const shift = rows.map((r) => (r.own - r.five) * 100);
console.log(`\n\n${rows.length} decks · commanders ${WITH_COMMANDERS ? "PARSED" : "blind"}\n`);
console.log(`  mean answer availability   turn 5 ${(mean(rows.map((r) => r.five)) * 100).toFixed(1)}%  ->  own clock ${(mean(rows.map((r) => r.own)) * 100).toFixed(1)}%`);
console.log(`  per-deck shift             mean ${mean(shift).toFixed(1)}pp · median ${median(shift).toFixed(1)}pp · largest ${Math.max(...shift).toFixed(1)}pp · smallest ${Math.min(...shift).toFixed(1)}pp`);
console.log(`  pricing turn               median ${median(rows.map((r) => r.turn))} · from own clock ${rows.filter((r) => r.src === "clock").length}, corpus median ${rows.filter((r) => r.src === "corpus-median").length}` +
  ` ${JSON.stringify(rows.filter((r) => r.src === "corpus-median").map((r) => r.deck))}`);
console.log(`  answer classes in the command zone: ${rows.reduce((n, r) => n + r.cz, 0)} across ${rows.filter((r) => r.cz > 0).length} decks` +
  ` ${JSON.stringify(rows.filter((r) => r.cz > 0).map((r) => r.deck))}`);
console.log(`\n  largest shifts:`);
for (const r of [...rows].sort((a, b) => (b.own - b.five) - (a.own - a.five)).slice(0, 5)) {
  console.log(`    ${r.deck.padEnd(38)} T${String(r.turn).padStart(2)} ${(r.five * 100).toFixed(1)}% -> ${(r.own * 100).toFixed(1)}%`);
}
