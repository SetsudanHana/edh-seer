/** GOLDFISH / LAND-COUNT PARITY (#1169, task 2b-1): for every card of the 74 census decks (and their commanders), what the goldfish and the
 *  Karsten land inputs read of it, so the move from printed text to the derived mana lines can be diffed card by card.
 *
 *    npx tsx research/mana/goldfish-parity.mts <out.json>
 *
 *  Per card: classifyAccelerant, manaOutput, the colour mask the goldfish gives its slot, landfall mana, the tap-replacement bonus, whether it
 *  fetches (tapped / untaps), ritual adds, and its place in the land-count (fast mana, ramp-or-draw cheap piece, taken one card at a time).
 *  The fetch mask is deck-specific (the lands THIS deck holds), so it is keyed by deck.
 *  The BEFORE run reads printed text; the AFTER run asks the same questions of the new exports. Run from the repo root with the env sourced. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const gf = await import(`${R}/matcher/src/goldfish.ts`);
const fl = await import(`${R}/matcher/src/fetch-land.ts`);
const legacy = await import(`${R}/matcher/src/legacy-mana-lines.ts`);
const { countsAsLand } = await import(`${R}/matcher/src/typeline.ts`);
const { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames, CALIBRATION_DECKS, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const files = [...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).map((f: string) => `${CALIBRATION_DECKS}/${f}`),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `${DECKS_DIR}/${n}.txt`)];

// The BEFORE helpers (printed text), copied from goldfish.ts as it stood. The AFTER run uses the exports that replace them.
const LANDFALL_ADD = /whenever a land (?:you control |)enters(?: the battlefield under your control|)[^.]{0,30}?adds? ((?:\{[^{}]+\}\s*)+|one mana|two mana)/i;
const RESTRICTED = /spend this mana only|can't be spent|this mana can't/i;
const SYMBOLS = /\{[^{}]+\}/g;
const TAP_REPLACEMENT = /is tapped for mana|tap a (?:permanent|creature|land)\b[^.]*\bfor\b/i;
const BONUS_COLORLESS = /tap a permanent for \{c\}|tap a land for \{c\}/i;
const BONUS_CREATURE = /tap a creature for mana/i;
const landfallBefore = (text: string): number => {
  const x = LANDFALL_ADD.exec(text);
  if (!x || RESTRICTED.test(text)) return 0;
  return x[1]!.startsWith("{") ? (x[1]!.match(SYMBOLS) ?? []).length : (x[1]!.startsWith("two") ? 2 : 1);
};
const after = process.argv[3] === "after";

const cards: Record<string, any> = {};
const fetchMasks: Record<string, Record<string, number>> = {};
for (const f of files) {
  const s = parseDecklistSections(readFileSync(f, "utf8"));
  const { cards: resolved } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const dcs = await m.buildDeckCards(resolved, lookup, tags);
  const deckName = f.split("/").pop()!.replace(".txt", "");
  const printed = dcs.map((dc: any) => ({ typeLine: dc.card.typeLine ?? "", producedMana: dc.card.producedMana }));
  for (const dc of dcs) {
    const name = dc.card.name as string;
    const text = dc.card.oracleText ?? "";
    const isLand = countsAsLand(dc.card);
    const fetches = after ? gf.fetchesLand(dc) : fl.isLandFetch(text);
    if (fetches) {
      (fetchMasks[name] ??= {})[deckName] = after ? gf.fetchMaskOf(dc, dcs) : gf.fetchMask(text, printed);
    }
    if (cards[name]) continue;
    const acc = gf.classifyAccelerant(dc);
    const one = m.landInputs([dc]);
    cards[name] = {
      isLand,
      acc: acc ? [acc.kind, acc.fetchTapped ?? null] : null,
      out: isLand || acc ? JSON.stringify(after ? gf.manaOutput(dc) : gf.manaOutput(text)) : null,
      mask: fetches ? "fetch" : (after ? gf.colourMaskOf(dc) : gf.colorMask(legacy.fixedColours(dc))),
      landfall: isLand ? 0 : (after ? gf.landfallOf(dc) : landfallBefore(text)),
      tapBonus: isLand ? null : (after ? gf.tapBonusOf(dc) ?? null
        : (TAP_REPLACEMENT.test(text) && BONUS_COLORLESS.test(text) ? "colorless" : TAP_REPLACEMENT.test(text) && BONUS_CREATURE.test(text) ? "creature" : null)),
      fetches: !!fetches,
      fetchTapped: fetches ? (after ? gf.fetchTappedOf(dc) : fl.FETCHES_TAPPED.test(text)) : null,
      fetchUntaps: fetches ? (after ? gf.fetchUntapsOf(dc) : fl.FETCH_UNTAPS.test(text)) : null,
      ritual: gf.ritualAdds(dc), oppRitual: gf.opponentHandRitual(dc),
      fast: one.fastMana, rpd: one.rampPlusDraw,
      derived: dc.tags !== null,
    };
  }
}
writeFileSync(process.argv[2]!, JSON.stringify({ cards, fetchMasks }, null, 1));
console.log(Object.keys(cards).length, "cards");
await store.close();
