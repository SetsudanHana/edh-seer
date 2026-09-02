import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { manaAudit } from "../mana-audit.js";
import type { DeckCard } from "../types.js";

/** WHAT DEADLINE-AWARE SOURCES COST THE COLOUR PANEL (roadmap T18b).
 *
 *  `met` used to read the deck's whole source count against a demand due on turn 1. This prices the
 *  same demands both ways over the 71 calibration decks and reports how many claims change, because
 *  a fix that moves nothing is a fix nobody needed and one that moves everything is a new bug.
 *
 *  Free: Mongo reads only, no API, no writes.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/mana-audit-deadline.ts              # the 71-deck sweep
 *    npx tsx packages/matcher/src/bin/mana-audit-deadline.ts enchanting-rani   # one deck, every row
 */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = createTagsLookup(store.db);

  let rows = 0, rowsGainedWorst = 0, rowsLostWorst = 0;
  let gainedT2 = 0, gainedT3 = 0;
  let maxAvailT1 = 0; const availT1: number[] = []; const reqT1: number[] = [];
  let demands = 0, flippedToUnmet = 0, flippedToMet = 0;
  const shrinkByTurn = new Map<number, number[]>();
  const decksGaining: string[] = [];

  // ONE DECK, EVERY ROW. The sweep answers "how much does this move"; a single deck is how the
  // contradiction that started T18b is checked to be gone -- the panel and the simulator have to
  // agree about one card on one turn, and only a printed row shows that.
  const only = process.argv[2];
  const files = readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()
    .filter((f) => only === undefined || f.replace(/\.txt$/, "") === only);
  if (files.length === 0) { console.log(`no deck named ${only}`); await store.close(); return; }
  for (const file of files) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      inputs.push({ card: docToCard(doc), tags: await cardTags.findOne(String(doc._id)) });
    }
    let gained = false;
    for (const row of manaAudit(inputs, { commanderNames: sections.commanders })) {
      if (only !== undefined) {
        console.log(`\n${row.color}: supplied ${row.supplied}`);
        for (const d of row.demands) {
          console.log(`  ${String(d.cards).padStart(2)} card(s) want ${d.pips} pip by turn ${d.turn}: `
            + `available ${String(d.available).padStart(2)} of ${row.supplied}, required ${d.required} -> ${d.met ? "MET" : "SHORT"}`);
        }
      }
      rows++;
      const oldUnmet = row.demands.filter((d) => row.supplied < d.required);
      const newUnmet = row.demands.filter((d) => !d.met);
      if (oldUnmet.length === 0 && newUnmet.length > 0) { rowsGainedWorst++; gained = true; }
      if (oldUnmet.length === 0 && newUnmet.filter((d) => d.turn >= 2).length > 0) gainedT2++;
      if (oldUnmet.length === 0 && newUnmet.filter((d) => d.turn >= 3).length > 0) gainedT3++;
      for (const d of row.demands) {
        if (d.turn !== 1) continue;
        availT1.push(d.available); reqT1.push(d.required);
        maxAvailT1 = Math.max(maxAvailT1, d.available);
      }
      if (oldUnmet.length > 0 && newUnmet.length === 0) rowsLostWorst++;
      for (const d of row.demands) {
        demands++;
        const wasMet = row.supplied >= d.required;
        if (wasMet && !d.met) flippedToUnmet++;
        if (!wasMet && d.met) flippedToMet++;
        const list = shrinkByTurn.get(d.turn) ?? [];
        list.push(row.supplied - d.available);
        shrinkByTurn.set(d.turn, list);
      }
    }
    if (gained) decksGaining.push(file.replace(/\.txt$/, ""));
  }
  await store.close();

  const median = (xs: number[]): number => {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
  };

  console.log(`colour rows: ${rows}, demands: ${demands}`);
  console.log(`rows that gained a shortfall: ${rowsGainedWorst} (${(rowsGainedWorst / rows * 100).toFixed(1)}%)`);
  console.log(`rows that lost one:           ${rowsLostWorst}`);
  console.log(`demands met -> unmet: ${flippedToUnmet} (${(flippedToUnmet / demands * 100).toFixed(1)}%)`);
  console.log(`demands unmet -> met: ${flippedToMet}`);
  console.log(`\nsources dropped (supplied - available), by deadline turn:`);
  for (const turn of [...shrinkByTurn.keys()].sort((a, b) => a - b)) {
    const xs = shrinkByTurn.get(turn)!;
    console.log(`  turn ${String(turn).padStart(2)}: n=${String(xs.length).padStart(4)}  median ${median(xs)}  max ${Math.max(...xs)}`);
  }
  console.log(`\nif turn-1 demands are excluded from the headline: rows gaining ${gainedT2} (${(gainedT2 / rows * 100).toFixed(1)}%)`);
  console.log(`if turn-1 AND turn-2 are excluded:                rows gaining ${gainedT3} (${(gainedT3 / rows * 100).toFixed(1)}%)`);
  console.log(`turn-1 demands: median available ${median(availT1)}, best any deck reaches ${maxAvailT1}, median required ${median(reqT1)}`);
  console.log(`\ndecks gaining a shortfall (${decksGaining.length}): ${decksGaining.slice(0, 12).join(", ")}`);
}

void main();
