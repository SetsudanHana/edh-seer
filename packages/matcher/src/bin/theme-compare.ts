/** THE THEME INSTRUMENT. Free: no API, no writes outside the snapshot, no spend.
 *
 *  Every other gate watches a different axis -- `population-compare.ts` edges and reasons,
 *  `panel-score.ts` claims, `ratings-compare.ts` per-card ratings, `build-population.ts` category
 *  membership. NONE of them can see a deck's headline theme, which is why the theme line was wrong
 *  for the project's whole life (`0c59087`: seven of eight decks themed "draw") and why a stale IDF
 *  artifact could hand a 3-card tag the top slot for eleven hours' worth of commits without any
 *  gate moving. This is the missing reader.
 *
 *    tsx src/bin/theme-compare.ts --save before.json     snapshot the current tree
 *    tsx src/bin/theme-compare.ts --against before.json  compare the current tree to a snapshot
 *
 *  Prints the label spread (how many decks share a headline) because THAT is the failure mode this
 *  family keeps producing: a theme true of every deck carries no information. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../index.js";

interface DeckTheme {
  deck: string; primary: string; label: string; secondary: string | null;
  cohesion: number; breadth: number; synergy: number; top5: string[];
}

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DIR = args.find((a) => !a.startsWith("--") && a.endsWith("calibration")) ?? "packages/cli/decks/calibration";
const SAVE = flag("--save");
const AGAINST = flag("--against");

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db);
const tokenTags = await loadTokenTags(store.db);

const rows: DeckTheme[] = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const r = analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
  rows.push({
    deck: file.replace(/\.txt$/, ""),
    primary: r.cohesion?.tag ?? "-", label: r.cohesion?.theme ?? "-", secondary: r.cohesion?.secondaryTag ?? null,
    cohesion: r.cohesion?.score ?? 0, breadth: r.positiveCoherence ?? 0, synergy: r.synergyOverall ?? 0,
    top5: r.themes.slice(0, 5).map((t) => t.tag),
  });
  process.stdout.write(".");
}
process.stdout.write("\n");

const spread = (rs: DeckTheme[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const r of rs) m.set(r.label, (m.get(r.label) ?? 0) + 1);
  return m;
};
const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function summarise(rs: DeckTheme[], title: string): void {
  const sp = [...spread(rs).entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n${title}`);
  console.log(`  decks ${rs.length} · distinct headlines ${sp.length} · MODAL "${sp[0][0]}" on ${sp[0][1]} decks (${(100 * sp[0][1] / rs.length).toFixed(0)}%)`);
  console.log(`  cohesion median ${med(rs.map((r) => r.cohesion)).toFixed(2)} · unfocused ${rs.filter((r) => r.cohesion < 0.3).length} · focused ${rs.filter((r) => r.cohesion >= 0.3 && r.cohesion < 0.6).length} · highly ${rs.filter((r) => r.cohesion >= 0.6).length}`);
  console.log(`  subtype-level primaries: ${rs.filter((r) => isSubtypePrimary(r.primary)).length}`);
  console.log("  top headlines: " + sp.slice(0, 6).map(([l, n]) => `${l} ×${n}`).join(" · "));
}

/** A primary whose subject is NOT a bare card type — the tribal/specific case criterion 2 protects. */
function isSubtypePrimary(tag: string): boolean {
  const i = tag.indexOf(":");
  if (i === -1) return false;
  const v = tag.slice(i + 1);
  return v !== "any" && !["creature", "artifact", "enchantment", "land", "planeswalker", "battle", "instant", "sorcery", "permanent", "spell"].includes(v) && !v.startsWith("-");
}

summarise(rows, "CURRENT");
if (SAVE) { writeFileSync(SAVE, JSON.stringify(rows, null, 2)); console.log(`\nsaved ${rows.length} decks to ${SAVE}`); }

if (AGAINST) {
  const before: DeckTheme[] = JSON.parse(readFileSync(AGAINST, "utf8"));
  const byDeck = new Map(before.map((r) => [r.deck, r]));
  summarise(before, "BEFORE (" + AGAINST + ")");
  const changed = rows.filter((r) => byDeck.get(r.deck)?.primary !== r.primary);
  const lostSubtype = rows.filter((r) => { const b = byDeck.get(r.deck); return b && isSubtypePrimary(b.primary) && !isSubtypePrimary(r.primary); });
  const cohMoved = rows.filter((r) => Math.abs((byDeck.get(r.deck)?.cohesion ?? 0) - r.cohesion) > 0.005);
  console.log(`\nDIFF\n  primary theme changed: ${changed.length}/${rows.length}`);
  console.log(`  LOST a subtype-level primary (criterion 2): ${lostSubtype.length}${lostSubtype.length ? " -> " + lostSubtype.map((r) => `${r.deck} ${byDeck.get(r.deck)!.primary}->${r.primary}`).join(", ") : ""}`);
  console.log(`  cohesion moved: ${cohMoved.length}`);
  console.log("\n  every changed headline (criterion 6 -- read them all):");
  for (const r of changed) {
    const b = byDeck.get(r.deck)!;
    console.log(`    ${r.deck.padEnd(34)} "${b.label}" (${b.cohesion.toFixed(2)}) -> "${r.label}" (${r.cohesion.toFixed(2)})`);
  }
}
process.exit(0);
