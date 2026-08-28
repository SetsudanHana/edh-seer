/** WHICH CARDS ARE "THE THING THIS DECK DOES"? Three candidate answers, diffed. Free: Mongo reads
 *  only, no model. Roadmap K1, and it goes BEFORE any probability is printed.
 *
 *  The product question (owner, 2026-08-22) is "does the deck do its thing", and Fable's review
 *  refused the phrase "most impactful turn" for having no unit — what survives is a COUNT of the
 *  cards that do the thing, and a fixed-turn probability over that count. Neither is computable
 *  until "the thing" names a card set. Three sets already exist in the engine:
 *
 *    (a) COHESION's on-theme cards — the distinct nonlands carrying the primary theme tag or a tag
 *        that folds to it. Already the cohesion numerator, so it is the only candidate that puts no
 *        second "on theme" number on the same screen (the MDFC-lands defect).
 *    (b) `themeMembership(primary).members` — the surplus/payoff/baseline split's membership.
 *    (c) COMBO PIECES, when the deck's dominant archetype is combo. Externally sourced and binary.
 *
 *  REGISTERED BEFORE THE FIRST RUN (roadmap K1): if (a) and (b) agree on >= 80% of members in >= 60
 *  of 71 decks, take (a). FALSIFIER: if both sets fail hand-checking, the membership predicate is
 *  the real work and no probability should be printed at all.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/matcher/src/bin/thing-set-diff.ts [--verbose] */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags, type CardTagsLookup } from "../index.js";
import { cardThemeTags } from "../edges.js";
import { themeMembership, themeCandidates } from "../themes.js";
import { loadHierarchy } from "../hierarchy.js";
import { foldThemeTag } from "../theme-fold.js";

const DIR = "packages/cli/decks/calibration";
const VERBOSE = process.argv.includes("--verbose");
const AGREEMENT_FLOOR = 0.8;

const hierarchy = loadHierarchy();
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
const tokenTags = await loadTokenTags(store.db);

interface Row {
  deck: string; primary: string | null; theme: string | null;
  a: string[]; b: string[]; combo: string[];
  agreement: number | null; dominant: string | null; bTokens: number; bLands: number;
  thingCount: number | null; thingP: number | null; identityOk: boolean;
}
const rows: Row[] = [];

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const index = new ComboIndex(combos);
  const report = analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, index, undefined, tokenTags);

  const primary = report.cohesion?.tag ?? null;

  // (a) THE COHESION NUMERATOR, recomputed by name. `computeCohesion` counts these cards and never
  // names them, so the predicate is reproduced here rather than the count re-derived — the same
  // `tag === primary || fold(tag) === primary` A10 settled on.
  const isLand = (n: string): boolean =>
    (deckCards.find((d) => d.card.name === n)?.card.typeLine ?? "").toLowerCase().includes("land");
  const a: string[] = [];
  if (primary) {
    for (const dc of deckCards) {
      if (!dc.tags || isLand(dc.card.name)) continue;
      for (const t of cardThemeTags(dc.tags)) {
        if (t === primary || foldThemeTag(t, hierarchy) === primary) { a.push(dc.card.name); break; }
      }
    }
  }
  // (b) the membership split's own answer for the same tag.
  // `report.themeMembership` carries COUNTS, not names (analyze.ts:750 maps them), so the split is
  // recomputed here against the report's own reasons rather than re-deriving a number.
  const allReasons = report.edges.flatMap((e) => e.reasons);
  const b = primary
    ? (themeMembership(deckCards, allReasons, [primary])[0]?.members ?? [])
    : [];
  // (c) combo pieces, only where the deck's dominant archetype is combo.
  const dominant = report.strategies?.[0]?.name ?? null;
  const present = new Set(deckCards.map((d) => d.card.name));
  const combo = [...new Set(index.combosContainedIn(present).flatMap((c) => c.cards))];

  // IS (b) EVEN A SET OF CARDS? A token node and a land both carry a name, and `themeMembership`
  // walks REASONS, which include both. "N cards do this deck's thing" cannot count a Beast token.
  const deckNames = new Set(deckCards.map((d) => d.card.name));
  const bTokens = b.filter((n) => !deckNames.has(n)).length;
  const bLands = b.filter((n) => deckNames.has(n) && isLand(n)).length;
  // K2's readout, and the identity check that keeps `thing.count` and `cohesion.score` from
  // becoming two different answers to one question.
  const thing = report.thing ?? null;
  const nonlandCount = deckCards.filter((d) => !isLand(d.card.name)).length;
  const identityOk = !thing || !report.cohesion
    || thing.count + thing.fromCommandZone.length === Math.round(report.cohesion.score * nonlandCount);
  const setA = new Set(a); const setB = new Set(b);
  const inter = [...setA].filter((n) => setB.has(n)).length;
  const union = new Set([...setA, ...setB]).size;
  rows.push({
    deck: file.replace(".txt", ""),
    // ABSTENTION IS `dominant`, NOT A NULL COHESION (A15). The theme layer still reports a
    // strongest tag and withdraws the CLAIM; reading null here counted 0 abstentions against a
    // measured 10 of 71.
    primary: report.cohesion?.dominant === false ? null : primary, theme: report.cohesion?.theme ?? null,
    a: [...setA], b: [...setB], combo,
    agreement: union === 0 ? null : inter / union,
    dominant, bTokens, bLands,
    thingCount: thing?.count ?? null, thingP: thing?.probability ?? null, identityOk,
  });
  process.stderr.write(".");
}
process.stderr.write("\n");

const withBoth = rows.filter((r) => r.agreement !== null);
const agreeing = withBoth.filter((r) => (r.agreement ?? 0) >= AGREEMENT_FLOOR);
const abstained = rows.filter((r) => r.primary === null);
const med = (xs: number[]): number => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;

console.log(`decks ${rows.length} | theme ABSTAINS on ${abstained.length} | both sets non-empty on ${withBoth.length}`);
console.log(`(a) cohesion on-theme: median ${med(rows.map((r) => r.a.length))} cards, min ${Math.min(...rows.map((r) => r.a.length))}, max ${Math.max(...rows.map((r) => r.a.length))}`);
console.log(`(b) themeMembership:   median ${med(rows.map((r) => r.b.length))} cards, min ${Math.min(...rows.map((r) => r.b.length))}, max ${Math.max(...rows.map((r) => r.b.length))}`);
console.log(`(c) combo pieces:      decks with any ${rows.filter((r) => r.combo.length > 0).length}, median ${med(rows.filter((r) => r.combo.length > 0).map((r) => r.combo.length))}`);
const bEmpty = rows.filter((r) => r.primary !== null && r.b.length === 0);
const bothLive = withBoth.filter((r) => r.b.length > 0 && r.a.length > 0);
const agreeingLive = bothLive.filter((r) => (r.agreement ?? 0) >= AGREEMENT_FLOOR);
console.log(`\n(b) IS EMPTY ON ${bEmpty.length} DECKS WITH A NAMED THEME, and that is STRUCTURAL:`);
console.log(`  themeMembership is keyed on REASON tags and cohesion on CARD theme tags, so a primary`);
console.log(`  no edge ever carries has no members at all. Their primaries: ${[...new Set(bEmpty.map((r) => r.primary))].slice(0, 8).join(" · ")}`);
console.log(`  where BOTH are non-empty (${bothLive.length} decks): agreeing ${agreeingLive.length}, Jaccard median ${med(bothLive.map((r) => r.agreement!)).toFixed(2)}`);
const contaminated = rows.filter((r) => r.bTokens + r.bLands > 0);
console.log(`\n(b) IS NOT A SET OF DECK CARDS. Across the 71 decks its members include`);
console.log(`  ${rows.reduce((n, r) => n + r.bTokens, 0)} TOKEN NODES and ${rows.reduce((n, r) => n + r.bLands, 0)} LANDS, on ${contaminated.length} decks.`);
console.log(`  A count answering "N cards do this deck's thing" cannot include a Beast token or a fetchland.`);
console.log(`\nREGISTERED TEST: (a) vs (b) Jaccard >= ${AGREEMENT_FLOOR} on >= 60 of 71 decks`);
console.log(`  agreeing ${agreeing.length} of ${rows.length}  ->  ${agreeing.length >= 60 ? "PASS, take (a)" : "FAIL"}`);
console.log(`  Jaccard median ${med(withBoth.map((r) => r.agreement!)).toFixed(2)}`);

const abst = rows.filter((r) => r.thingCount === null);
const live = rows.filter((r) => r.thingCount !== null);
console.log(`\nK2 report.thing: ABSTAINS on ${abst.length} of 71 | count median ${med(live.map((r) => r.thingCount!))}, min ${Math.min(...live.map((r) => r.thingCount!))}, max ${Math.max(...live.map((r) => r.thingCount!))}`);
console.log(`  P(>=2 by T3) median ${(med(live.map((r) => r.thingP!)) * 100).toFixed(1)}%, min ${(Math.min(...live.map((r) => r.thingP!)) * 100).toFixed(1)}%, max ${(Math.max(...live.map((r) => r.thingP!)) * 100).toFixed(1)}%`);
console.log(`  count + commander == round(cohesion.score x nonlands) on ${rows.filter((r) => r.identityOk).length} of 71  ${rows.every((r) => r.identityOk) ? "OK" : "MISMATCH"}`);
console.log(`  decks under 50%: ${live.filter((r) => r.thingP! < 0.5).length} | abstaining decks: ${abst.map((r) => r.deck).join(", ")}`);
console.log(`\nWITNESSES (registered: voltron-mill, acererak-combo, and a control deck must abstain):`);
for (const name of ["voltron-mill", "acererak-combo", "fandaniel-mono-black-control", "zenos", "inalla-wizard-tribal", "braids-mono-black-enchantress", "naya-spellslinger", "smooth-criminal"]) {
  const r = rows.find((x) => x.deck.includes(name.split("-")[0]));
  if (!r) continue;
  console.log(`  ${r.deck.padEnd(38)} theme ${String(r.theme).padEnd(26)} (a) ${String(r.a.length).padStart(3)}  (b) ${String(r.b.length).padStart(3)}  J ${r.agreement === null ? " -- " : r.agreement.toFixed(2)}  N ${r.thingCount === null ? "--" : String(r.thingCount).padStart(2)}  P ${r.thingP === null ? " -- " : (r.thingP * 100).toFixed(0).padStart(3) + "%"}`);
}
if (VERBOSE) {
  console.log(`\nPER DECK:`);
  for (const r of rows.sort((x, y) => (x.agreement ?? 2) - (y.agreement ?? 2))) {
    console.log(`  ${r.deck.padEnd(38)} ${String(r.primary).padEnd(28)} a=${String(r.a.length).padStart(3)} b=${String(r.b.length).padStart(3)} J=${r.agreement === null ? "--" : r.agreement.toFixed(2)}`);
    if (r.agreement !== null && r.agreement < AGREEMENT_FLOOR) {
      const onlyA = r.a.filter((n) => !r.b.includes(n)).slice(0, 6);
      const onlyB = r.b.filter((n) => !r.a.includes(n)).slice(0, 6);
      if (onlyA.length) console.log(`      only in (a): ${onlyA.join(", ")}`);
      if (onlyB.length) console.log(`      only in (b): ${onlyB.join(", ")}`);
    }
  }
}
await store.close();
