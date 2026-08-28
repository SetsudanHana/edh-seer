/** WHAT YOUR RAMP CAN ACTUALLY FIND. Free: Mongo reads only, no model.
 *
 *  A land finder is not a synergy in the usual sense and it is not the mana base either — it is a
 *  DEPENDENCY. Farseek fetches a Plains, an Island, a Swamp or a Mountain and nothing else, so in a
 *  deck whose only white source is a Triome it finds one card; Nature's Lore fetches a Forest and is
 *  dead in a deck with none. That is a deckbuilding fact the colour audit cannot state, because
 *  `manaAudit` counts SOURCES against pip demand and never asks whether your ramp can reach them.
 *
 *  Built on the `ramp-target:` reasons (owner's ruling, 2026-08-15). Reports, per deck:
 *    - each land finder, how many targets it has, and the thinnest ones;
 *    - per basic land type, how many finders want it against how many cards supply it.
 *
 *  The row to read is a finder with 0-2 targets: the card is a slot doing almost nothing.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/matcher/src/bin/ramp-coverage.ts [deck.txt] */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { analyzeDeckStructured } from "../index.js";
import type { DeckCard } from "../types.js";

const DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const only = process.argv[2];
const THIN = 2;

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const derived = store.db.collection<CardTags>("cardTagsDerived");

const files = only ? [only] : readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort();
const thinAcross: { deck: string; finder: string; targets: number }[] = [];
const perType: { deck: string; type: string; finders: number; distinct: number; copies: number }[] = [];
const allCounts: number[] = [];
let decksWithFinders = 0;

for (const file of files) {
  const path = only && only.includes("/") ? only : join(DIR, file);
  const sections = parseDecklistSections(readFileSync(path, "utf8"));
  const deck: DeckCard[] = [];
  for (const name of [...sections.commanders, ...sections.deck]) {
    const doc = await lookup.findByName(normalizeName(name));
    if (!doc) continue;
    deck.push({ card: docToCard(doc), tags: (await derived.findOne({ oracleId: String(doc._id) })) as CardTags | null });
  }
  const report = analyzeDeckStructured(deck, sections.commanders, undefined, undefined, new ComboIndex([]));

  // A finder's targets are COUNTED WITH DUPLICATES, because that is what a search actually sees: a
  // deck running eight Plains gives Rampant Growth eight outs, not one.
  const targets = new Map<string, string[]>();
  const wantedType = new Map<string, Set<string>>();
  for (const e of report.edges) {
    for (const r of e.reasons) {
      const tag = String(r.tag);
      if (!tag.startsWith("ramp-target:")) continue;
      const finder = String(r.producer);
      if (!targets.has(finder)) targets.set(finder, []);
      targets.get(finder)!.push(String(r.consumer));
      const type = tag.slice("ramp-target:".length);
      if (!wantedType.has(type)) wantedType.set(type, new Set());
      wantedType.get(type)!.add(finder);
    }
  }
  if (targets.size === 0) continue;
  decksWithFinders++;

  const thin = [...targets].filter(([, t]) => t.length <= THIN);
  for (const [f, t] of thin) thinAcross.push({ deck: file.replace(/\.txt$/, ""), finder: f, targets: t.length });

  for (const [, t] of targets) allCounts.push(t.length);
  // PER TYPE, which is the question a deckbuilder actually asks: my ramp wants Mountains — how many
  // cards in this deck are one? Counted with duplicates, and over the union of every finder naming
  // that type, so two Farseeks do not double the supply.
  for (const [type, finders] of wantedType) {
    const supply = new Set<string>();
    let copies = 0;
    for (const f of finders) for (const c of targets.get(f) ?? []) { supply.add(c); copies++; }
    perType.push({ deck: file.replace(/\.txt$/, ""), type, finders: finders.size, distinct: supply.size, copies });
  }

  if (!only && thin.length === 0) continue;
  console.log(`\n=== ${file.replace(/\.txt$/, "")} ===`);
  for (const [finder, t] of [...targets].sort((a, b) => a[1].length - b[1].length)) {
    const flag = t.length <= THIN ? "  <-- THIN" : "";
    console.log(`  ${finder.slice(0, 34).padEnd(36)} ${String(t.length).padStart(3)} targets${flag}`);
    if (t.length <= THIN) console.log(`        ${[...new Set(t)].join(", ") || "NOTHING IT CAN FIND"}`);
  }
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
console.log(`\n\n${decksWithFinders} of ${files.length} decks run a land finder.`);
console.log(`targets per finder: min ${Math.min(...allCounts)} · median ${median(allCounts)} · max ${Math.max(...allCounts)} over ${allCounts.length} finders`);
console.log(`finders with ${THIN} or fewer targets: ${thinAcross.length}`);
for (const t of thinAcross.sort((a, b) => a.targets - b.targets).slice(0, 20)) {
  console.log(`  ${String(t.targets).padStart(2)}  ${t.finder.slice(0, 32).padEnd(34)} ${t.deck}`);
}
// RANKED BY COPIES, not by distinct names: a mono-blue deck's basics are 69 cards all called
// "Island", and ranking by name made every such deck look starved of what it has most of.
console.log(`\nthinnest deck/type pairs — the ramp wants this type and the deck barely has it:`);
for (const r of perType.sort((a, b) => a.copies - b.copies).slice(0, 15)) {
  console.log(`  ${String(r.copies).padStart(3)} findable (${String(r.distinct).padStart(2)} distinct)  ${r.type.padEnd(9)} ${String(r.finders)} finder(s)  ${r.deck}`);
}
await store.close();
