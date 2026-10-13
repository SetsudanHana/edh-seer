/** EVERY CENSUS CARD WITH A GATED MANA LINE (#1169 2b-2, owner 2026-10-13: a gated source is a source conditioned on the deck), and its verdict per deck.
 *  `npx tsx research/mana/gated-lines.mts [out.json]` (env sourced, sandbox off). Prints card, gate, line shape, then deck -> met/unmet/unknown. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const ml = await import(`${R}/matcher/src/mana-lines.ts`);
const gm = await import(`${R}/matcher/src/gate.ts`);
const sj = await import(`${R}/matcher/src/same-job.ts`);
const { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames, CALIBRATION_DECKS, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const files = [...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).map((f: string) => `${CALIBRATION_DECKS}/${f}`),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `${DECKS_DIR}/${n}.txt`)];
const rows: Record<string, { gates: Set<string>; shapes: Set<string>; decks: Record<string, string>; moved: Set<string> }> = {};
for (const f of files) {
  const s = parseDecklistSections(readFileSync(f, "utf8"));
  const { cards } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const dcs = await m.buildDeckCards(cards, lookup, tags);
  const deck = f.split("/").pop()!.replace(".txt", "");
  for (const dc of dcs) for (const l of ml.cardLines(dc, true)) {
    if (l.gate === null) continue;
    const r = (rows[dc.card.name] ??= { gates: new Set(), shapes: new Set(), decks: {}, moved: new Set() });
    r.gates.add(l.gate); r.shapes.add(`${l.source}${l.trigger ? ":" + l.trigger : ""}${l.cost.tap ? " tap" : ""} net${l.net}${/\bland\b/i.test(dc.card.typeLine ?? "") ? " LAND" : ""}`);
    r.decks[deck] = gm.gateVerdict(l.gate, dcs);
    // what this deck's verdict does to the rock readings, against the deck-free answer (ef13ea04's)
    const a = [sj.netYield(dc), sj.netPositiveMana(dc)], b = [sj.netYield(dc, dcs), sj.netPositiveMana(dc, dcs)];
    if (JSON.stringify(a) !== JSON.stringify(b)) r.moved.add(`netYield ${a[0]} -> ${b[0]}, netPositiveMana ${a[1]} -> ${b[1]} in ${deck}`);
  }
}
for (const [n, r] of Object.entries(rows).sort()) {
  const v = Object.values(r.decks); const c = (x: string) => v.filter((y) => y === x).length;
  console.log(`${n} | ${[...r.gates].join(" ; ")} | ${[...r.shapes].join(" ; ")} | decks ${v.length}: met ${c("met")} unmet ${c("unmet")} unknown ${c("unknown")}${r.moved.size ? " | MOVES: " + [...r.moved].map((x) => x.replace(/ in .*/, "")).filter((x, i, xs) => xs.indexOf(x) === i).join(" ; ") + " (" + r.moved.size + " decks)" : ""}`);
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(Object.fromEntries(Object.entries(rows).map(([n, r]) => [n, { gates: [...r.gates], shapes: [...r.shapes], decks: r.decks, moved: [...r.moved] }])), null, 1));
await store.close();
