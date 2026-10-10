/** Per deck and colour: the cards that were a colour source under the regex reader (legacy `fixedColours`) and are not now, and the reverse
 *  (#1169 task 2a). `npx tsx research/mana/source-diff.mts <deck-name-substring> [colour]` */
import { readFileSync, readdirSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const legacy = await import(`${R}/matcher/src/legacy-mana-lines.ts`);
const cs = await import(`${R}/matcher/src/colour-sources.ts`);
const ml = await import(`${R}/matcher/src/mana-lines.ts`);
const ma = await import(`${R}/matcher/src/mana-audit.ts`);
const { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames, CALIBRATION_DECKS, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const only = process.argv[2] ?? ""; const col = process.argv[3];
const files = [...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).map((f: string) => `${CALIBRATION_DECKS}/${f}`),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `${DECKS_DIR}/${n}.txt`)].filter((f) => f.includes(only));
for (const f of files) {
  const s = parseDecklistSections(readFileSync(f, "utf8"));
  const { cards } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const dcs = await m.buildDeckCards(cards, lookup, tags);
  const cmd = new Set(cards.filter((c: any) => s.commanders.some((x: string) => x.toLowerCase() === c.name.toLowerCase())).map((c: any) => c.name));
  const lib = dcs.filter((d: any) => !cmd.has(d.card.name));
  const id = ml.deckIdentity(dcs, [...cmd]);
  const now = cs.colourSourceCards(lib, id);
  for (const c of col ? [col] : ["W", "U", "B", "R", "G"]) {
    const was = new Set(lib.filter((d: any) => ma.isManaSource(d) && legacy.fixedColours(d).includes(c)).map((d: any) => d.card.name));
    const is = new Set(now.get(c)!.map((d: any) => d.card.name));
    const lost = [...was].filter((n) => !is.has(n)), gained = [...is].filter((n) => !was.has(n));
    console.log(f.split("/").pop(), c, "legacy-direct", was.size, "now", is.size, "\n  LOST", lost.join("; "), "\n  GAINED", gained.join("; "));
  }
}
await store.close();
