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
import { SUBTYPE_TYPES } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../index.js";
import { ALL_CARD_TYPES } from "../hierarchy.js";

interface DeckTheme {
  deck: string; primary: string; label: string; secondary: string | null;
  cohesion: number; breadth: number; synergy: number; top5: string[];
  /** Whether the theme layer would NAME this deck (roadmap A15's `Cohesion.dominant`). In the
   *  snapshot because a RANKING change can silently flip a deck from "no dominant theme" to a
   *  confident headline and back, and this table is the only place that movement would ever be
   *  seen -- every other column can hold still while this one moves. */
  dominant: boolean;
  /** The membership census, [tag, surplus, payoffs, baseline] -- what a loop ranking reads. Nothing
   *  ranks by it at the shipped settings, so it is invisible to every other gate including this
   *  tool's own headline diff (roadmap A2). */
  census: [string, number, number, number][];
  /** Every ranked theme with its deck frequency, so the DOMINATED-HEADLINE criterion (spec
   *  `2026-08-19-theme-family-ranking-design.md` §9) can be computed off a snapshot. */
  themes: [string, number][];
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
    dominant: r.cohesion?.dominant !== false,
    top5: r.themes.slice(0, 5).map((t) => t.tag),
    themes: r.themes.map((t) => [t.tag, t.count] as [string, number]),
    census: (r.themeMembership ?? []).map((t) => [t.tag, t.surplus, t.payoffs, t.baseline] as [string, number, number, number]),
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
  console.log(`  decks the theme layer DECLINES to name (A15): ${rs.filter((r) => !r.dominant).length} of ${rs.length}`);
  console.log(`  subtype-level primaries: ${rs.filter((r) => isSubtypePrimary(r.primary)).length}`);
  console.log("  top headlines: " + sp.slice(0, 6).map(([l, n]) => `${l} ×${n}`).join(" · "));
  const cs = rs.flatMap((r) => r.census ?? []);
  const loops = cs.filter(([, sup, pay]) => sup > 0 && pay > 0);
  console.log(`  census: ${cs.length} deck-tags · payoff credits ${cs.reduce((a, [, , p]) => a + p, 0)} · surplus ${cs.reduce((a, [, s2]) => a + s2, 0)}`);
  console.log(`          tags CLOSING a loop (surplus>0 and payoffs>0): ${loops.length} · of them subtype-level ${loops.filter(([t]) => isSubtypePrimary(t)).length}`);
}

/** A primary whose subject is NOT a bare card type — the tribal/specific case criterion 2 protects. */
function isSubtypePrimary(tag: string): boolean {
  const i = tag.indexOf(":");
  if (i === -1) return false;
  const v = tag.slice(i + 1);
  return v !== "any" && !["creature", "artifact", "enchantment", "land", "planeswalker", "battle", "instant", "sorcery", "permanent", "spell"].includes(v) && !v.startsWith("-");
}

/** THE DOMINATED-HEADLINE CRITERION (spec §9). A headline is DOMINATED when the deck also carries a
 *  strictly MORE SPECIFIC sibling of the same verb -- a subtype of the headline's card type, or any
 *  subject at all when the headline says `any` -- with comparable in-deck support. "Creatures
 *  entering" on a Dragon deck that also carries `enters:dragon` is a true statement that says less
 *  than the deck does.
 *
 *  Reported as a CURVE over the support share rather than at one hand-picked threshold, because no
 *  value of it has been measured and picking one silently would be inventing the criterion. */
const GENERAL = new Set(["any", ...ALL_CARD_TYPES]);
function dominators(row: DeckTheme): { tag: string; count: number; head: number }[] {
  const i = row.primary.indexOf(":");
  if (i === -1) return [];
  const verb = row.primary.slice(0, i), value = row.primary.slice(i + 1);
  if (!GENERAL.has(value)) return []; // already specific -- nothing can generalise it
  const head = (row.themes ?? []).find(([t]) => t === row.primary)?.[1] ?? 0;
  if (head === 0) return [];
  const out: { tag: string; count: number; head: number }[] = [];
  for (const [tag, count] of row.themes ?? []) {
    if (tag === row.primary || !tag.startsWith(verb + ":")) continue;
    const v = tag.slice(verb.length + 1);
    if (GENERAL.has(v) || v.startsWith("-")) continue;
    // Strictly more specific: a subtype OF the headline's card type, or of anything when `any`.
    const types = SUBTYPE_TYPES[v];
    if (!types) continue;
    if (value !== "any" && !types.includes(value)) continue;
    out.push({ tag, count, head });
  }
  return out.sort((a, b) => b.count - a.count);
}

function dominatedReport(rs: DeckTheme[], title: string): void {
  console.log(`\n${title} — DOMINATED HEADLINES (criterion §9)`);
  for (const share of [0.3, 0.5, 0.7, 1.0]) {
    const hit = rs.filter((r) => dominators(r).some((d) => d.count >= share * d.head));
    console.log(`  sibling support >= ${(100 * share).toFixed(0)}% of the headline's: ${hit.length} of ${rs.length} decks dominated`);
  }
  const worst = rs.map((r) => ({ r, d: dominators(r)[0] })).filter((x) => x.d !== undefined)
    .sort((a, b) => (b.d!.count / b.d!.head) - (a.d!.count / a.d!.head)).slice(0, 12);
  console.log("  strongest dominators (deck · headline(count) · best more-specific sibling(count)):");
  for (const { r, d } of worst) {
    console.log(`    ${r.deck.padEnd(34)} ${r.primary}(${d!.head})  <-  ${d!.tag}(${d!.count})`);
  }
}

summarise(rows, "CURRENT");
dominatedReport(rows, "CURRENT");
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
  {
    // A DECK THAT STOPS (OR STARTS) BEING NAMED is a movement no other column shows: cohesion can
    // cross A15's floor while the headline TAG never changes, so the primary-theme diff reads clean.
    const flipped = rows.filter((r) => { const b = byDeck.get(r.deck); return b !== undefined && b.dominant !== r.dominant; });
    console.log(`  decks that started/stopped being NAMED: ${flipped.length}${flipped.length ? ` -> ${flipped.map((f) => `${f.deck} ${f.dominant ? "now named" : "now declines"}`).join(", ")}` : ""}`);
  }
  // THE CENSUS DIFF. Nothing ranks by the census at the shipped settings, so this is the only place
  // a change to it is visible at all -- the headline diff above reads zero by construction.
  const cIdx = (r: DeckTheme): Map<string, [number, number, number]> =>
    new Map((r.census ?? []).map(([t, s2, p, b]) => [t, [s2, p, b]] as const));
  let gainedPayoff = 0, gainedSurplus = 0, newLoops = 0;
  const newLoopRows: string[] = [];
  for (const r of rows) {
    const b = byDeck.get(r.deck); if (!b) continue;
    const before = cIdx(b), after = cIdx(r);
    for (const [tag, [s2, p]] of after) {
      const [bs = 0, bp = 0] = before.get(tag) ?? [0, 0, 0];
      if (p > bp) gainedPayoff += p - bp;
      if (s2 > bs) gainedSurplus += s2 - bs;
      if ((bs > 0 && bp > 0) === false && s2 > 0 && p > 0) {
        newLoops++;
        if (isSubtypePrimary(tag) && newLoopRows.length < 20) newLoopRows.push(`${r.deck} ${tag} (surplus ${bs}->${s2}, payoffs ${bp}->${p})`);
      }
    }
  }
  console.log(`  CENSUS: payoff credits gained ${gainedPayoff} · surplus credits gained ${gainedSurplus} · tags that NEWLY close a loop ${newLoops}`);
  if (newLoopRows.length) console.log("  newly-closing SUBTYPE-level tags:\n    " + newLoopRows.join("\n    "));
  console.log("\n  every changed headline (criterion 6 -- read them all):");
  for (const r of changed) {
    const b = byDeck.get(r.deck)!;
    console.log(`    ${r.deck.padEnd(34)} "${b.label}" (${b.cohesion.toFixed(2)}) -> "${r.label}" (${r.cohesion.toFixed(2)})`);
  }
}
process.exit(0);
