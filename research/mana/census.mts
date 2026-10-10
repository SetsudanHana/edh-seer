import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const eng = await import(`${R}/engine/src/index.ts`);
const { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const only = process.argv[3];
const files = [...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).map((f: string) => `${CALIBRATION_DECKS}/${f}`),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `${DECKS_DIR}/${n}.txt`)].filter((f) => !only || f.includes(only));
const out: Record<string, any> = {};
for (const f of files) {
  const s = parseDecklistSections(readFileSync(f, "utf8"));
  const { cards, combos } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const cmd = new Set(s.commanders.map(normalizeName));
  const dcs = await m.buildDeckCards(cards, lookup, tags);
  const cn = cards.filter((c: any) => cmd.has(normalizeName(c.name))).map((c: any) => c.name);
  const rep: any = m.analyzeDeckStructured(dcs, cn, undefined, undefined, new eng.ComboIndex(combos));
  const dm = rep.deckMath;
  const name = f.split("/").pop()!.replace(".txt", "");
  out[name] = {
    colourSources: Object.fromEntries(m.colourSources(dcs, cn)),
    audit: dm?.colors?.map((c: any) => [c.color, c.supplied]),
    lands: dm?.lands && { actual: dm.lands.actual, target: dm.lands.target, rawTarget: dm.lands.rawTarget, accelerants: dm.lands.accelerants, drawPieces: dm.lands.drawPieces, mb: dm.lands.manaBase },
    rampPlusDraw: dm?.lands?.rampPlusDraw, fastMana: dm?.lands?.fastMana,
    roles: Object.fromEntries((rep.buildCategories ?? []).map((c: any) => [c.key ?? c.category, c.count])),
    resilience: rep.rampResilience,
    cast: dm?.castability && { n: dm.castability.cards.length, refused: dm.castability.refused,
      meanLow: dm.castability.cards.reduce((a: number, c: any) => a + c.castable.low, 0) / Math.max(1, dm.castability.cards.length),
      meanHigh: dm.castability.cards.reduce((a: number, c: any) => a + c.castable.high, 0) / Math.max(1, dm.castability.cards.length),
      commander: (dm.castability.commanders ?? []).map((c: any) => [c.name, c.castable?.low, c.castable?.high]) },
    colorsRows: dm?.colors?.map((c: any) => ({ c: c.color, supplied: c.supplied, worst: c.worst && [c.worst.pips, c.worst.turn, c.worst.required, c.worst.available] })),
    fetchShortfalls: dm?.fetchShortfalls?.length,
  };
}
writeFileSync(process.argv[2]!, JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, "decks");
await store.close();
