/** Flat tags vs derived tags across ALL 71 calibration decks. Free: no API, no writes.
 *
 *  The persistence work was validated on ONE deck, which is not enough to judge a corpus that cost
 *  ~$9.6 — a sacrifice deck cannot move on card-selection effects, so a null result there says
 *  nothing about card selection. These 71 decks are the same ones the calibration corpus was drawn
 *  from, so coverage is near-total rather than the ~50% an arbitrary new deck gets, and any
 *  difference is the tag population rather than a coverage artifact.
 *
 *  Reports per deck and in aggregate: edges, reasons, and whether the deck's named theme changed.
 *  A theme flip is the loudest signal available — it means the two populations disagree about what
 *  the deck IS, which matters far more than a few edges either way.
 *
 *  Usage: tsx src/bin/population-compare.ts [--verbose] */
import { readFileSync, readdirSync } from "node:fs";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";

const DIR = process.argv[2]?.startsWith("--") ? "packages/cli/decks/calibration" : (process.argv[2] ?? "packages/cli/decks/calibration");
const VERBOSE = process.argv.includes("--verbose");

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const flat: CardTagsLookup = createTagsLookup(store.db, "flat");
const derived: CardTagsLookup = createTagsLookup(store.db, "derived-first");

interface Row { deck: string; edges: [number, number]; reasons: [number, number]; theme: [string, string]; covered: number; total: number }
const rows: Row[] = [];

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);

  const run = async (tags: CardTagsLookup) => {
    const deckCards = await buildDeckCards(cards, lookup, tags);
    const report = analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, new ComboIndex(combos));
    return { report, deckCards };
  };
  const a = await run(flat);
  const b = await run(derived);

  // How much of this deck the derived population actually covers, so a null delta can be told apart
  // from a deck the corpus simply does not reach.
  const derivedCol = store.db.collection("cardTagsDerived");
  let covered = 0;
  for (const dc of b.deckCards) {
    const t = dc.tags as { oracleId?: string } | null;
    if (t?.oracleId && await derivedCol.countDocuments({ oracleId: t.oracleId }, { limit: 1 })) covered++;
  }

  const themeOf = (r: ReturnType<typeof analyzeDeckStructured>): string =>
    (r.axis ?? []).slice(0, 1).map((x: { tag: string }) => x.tag).join(",") || "(none)";
  const reasons = (r: ReturnType<typeof analyzeDeckStructured>): number =>
    r.edges.reduce((n: number, e: { reasons: unknown[] }) => n + e.reasons.length, 0);

  rows.push({
    deck: file.replace(/\.txt$/, ""),
    edges: [a.report.edges.length, b.report.edges.length],
    reasons: [reasons(a.report), reasons(b.report)],
    theme: [themeOf(a.report), themeOf(b.report)],
    covered, total: b.deckCards.length,
  });
  process.stdout.write(".");
}
await store.close();

const sum = (f: (r: Row) => number): number => rows.reduce((n, r) => n + f(r), 0);
const flips = rows.filter((r) => r.theme[0] !== r.theme[1]);
const lostReasons = rows.filter((r) => r.reasons[1] < r.reasons[0]);

console.log(`\n\n${rows.length} decks\n`);
console.log(`  coverage by the derived corpus: ${(100 * sum((r) => r.covered) / sum((r) => r.total)).toFixed(1)}%`);
console.log(`  edges    flat ${sum((r) => r.edges[0])}  ->  derived ${sum((r) => r.edges[1])}`);
console.log(`  reasons  flat ${sum((r) => r.reasons[0])}  ->  derived ${sum((r) => r.reasons[1])}`);
console.log(`  decks where derived finds FEWER reasons: ${lostReasons.length}/${rows.length}`);
console.log(`  decks whose top theme CHANGED: ${flips.length}/${rows.length}`);
for (const f of flips.slice(0, 15)) console.log(`      ${f.deck.padEnd(38)} ${f.theme[0]} -> ${f.theme[1]}`);

if (VERBOSE) {
  console.log(`\nper deck (reasons flat -> derived):`);
  for (const r of [...rows].sort((x, y) => (x.reasons[1] - x.reasons[0]) - (y.reasons[1] - y.reasons[0]))) {
    const d = r.reasons[1] - r.reasons[0];
    console.log(`  ${r.deck.padEnd(38)} ${String(r.reasons[0]).padStart(4)} -> ${String(r.reasons[1]).padStart(4)}  ${d >= 0 ? "+" : ""}${d}`);
  }
}
