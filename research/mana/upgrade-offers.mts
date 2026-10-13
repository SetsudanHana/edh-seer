/** Dumps the COLOUR SWAP offers of the ramp section per census deck (#1169 task 2a review 3), so a change to what a swap counts as "makes a colour"
 *  (`MADE_COLOURS` in upgrade-sections.ts) can be compared before and after: `npx tsx research/mana/upgrade-offers.mts <out.json>`.
 *  The cuts are the deck's own ramp-role non-creature and creature cards; the pool is every ramp-role card of the 74 decks and the named extras that
 *  is in the deck's identity and not in the deck. A proxy for the static build's pool (which is the whole corpus), the same on both sides of a comparison.
 *  Each offer is `cut -> add [colours]`; run once per variant of MADE_COLOURS and diff the files. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const us = await import(`${R}/matcher/src/upgrade-sections.ts`);
const ma = await import(`${R}/matcher/src/mana-audit.ts`);
const q = await import(`${R}/matcher/src/quality.ts`);
const { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const files = [...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).map((f: string) => `${CALIBRATION_DECKS}/${f}`),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `${DECKS_DIR}/${n}.txt`)];
const EXTRAS = ["Coldsteel Heart", "Sol Grail", "Chrome Mox", "Mox Amber", "Fellwar Stone", "Prismatic Lens", "Arcane Signet", "Talisman of Creativity", "Izzet Signet",
  "Mind Stone", "Fire Diamond", "Commander's Sphere", "Chromatic Lantern", "Star Compass", "Mana Geode", "Orzhov Signet", "Golgari Signet", "Selesnya Signet"];
const parsed = files.map((f) => ({ f, s: parseDecklistSections(readFileSync(f, "utf8")) }));
const all = await resolveNames([...new Set([...parsed.flatMap((p) => [...p.s.commanders, ...p.s.deck]), ...EXTRAS])], lookup);
const dcs: any[] = await m.buildDeckCards(all.cards, lookup, tags);
const byName = new Map(dcs.map((d: any) => [d.card.name, d]));
const ramp = (d: any) => q.rolesOfCard(d).includes("ramp");
const out: Record<string, string[]> = {};
for (const p of parsed) {
  const names = new Set([...p.s.commanders, ...p.s.deck].map(normalizeName));
  const deck = dcs.filter((d: any) => names.has(normalizeName(d.card.name)));
  const cn = deck.filter((d: any) => p.s.commanders.map(normalizeName).includes(normalizeName(d.card.name))).map((d: any) => d.card.name);
  const identity = new Set(deck.filter((d: any) => cn.includes(d.card.name)).flatMap((d: any) => d.card.colorIdentity ?? []));
  const inDeck = new Set(deck.map((d: any) => d.card.name));
  const pool = dcs.filter((d: any) => !inDeck.has(d.card.name) && ramp(d) && (d.card.colorIdentity ?? []).every((c: string) => identity.has(c)))
    .map((d: any) => ({ dc: d, roles: q.rolesOfCard(d), links: 0 }));
  const cuts = deck.filter((d: any) => !cn.includes(d.card.name) && ramp(d));
  const res = us.roleOptions("ramp", cuts, pool, undefined, ma.colourDeficit(deck, cn), us.swapCloser(deck, cn), undefined, undefined, deck);
  out[p.f.split("/").pop()!] = res.flatMap((r: any) => r.options.filter((o: any) => o.colour).map((o: any) => `${r.cut} -> ${o.add} [${o.colour.join("")}]`)).sort();
}
void byName;
writeFileSync(process.argv[2]!, JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, "decks,", Object.values(out).reduce((n, a) => n + a.length, 0), "colour offers");
await store.close();
