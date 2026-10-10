import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const ml = await import(`${R}/matcher/src/mana-lines.ts`);
const leg = await import(`${R}/matcher/src/legacy-mana-lines.ts`); // the regex reader: kept for the ramp side (task 2b)
const ma = await import(`${R}/matcher/src/mana-audit.ts`);
const mb = await import(`${R}/matcher/src/mana-base.ts`);
const ls = await import(`${R}/matcher/src/land-score.ts`);
const gf = await import(`${R}/matcher/src/goldfish.ts`);
const sj = await import(`${R}/matcher/src/same-job.ts`);
const sf = await import(`${R}/matcher/src/static-fixers.ts`);
const bd = await import(`${R}/matcher/src/build.ts`);
const { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames, CALIBRATION_DECKS, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const files = [...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).map((f: string) => `${CALIBRATION_DECKS}/${f}`),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `${DECKS_DIR}/${n}.txt`)];
const all = new Map<string, any>(); const deckOf = new Map<string, string[]>();
const decks: Record<string, any> = {};
for (const f of files) {
  const s = parseDecklistSections(readFileSync(f, "utf8"));
  const { cards } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const dcs = await m.buildDeckCards(cards, lookup, tags);
  const name = f.split("/").pop()!.replace(".txt", "");
  decks[name] = { dcs, cmd: s.commanders };
  for (const dc of dcs) { if (!all.has(dc.card.name)) all.set(dc.card.name, dc); (deckOf.get(dc.card.name) ?? deckOf.set(dc.card.name, []).get(dc.card.name)!).push(name); }
}
const rows: any[] = [];
const ALLC = new Set(["W","U","B","R","G"]);
for (const [name, dc] of all) {
  const abil = (dc.tags?.abilities ?? []).filter((a: any) => ["mana-generation","fast-mana","ritual"].includes(a.effect?.kind));
  const isLand = /\bland\b/i.test(dc.card.typeLine ?? "");
  const lines = leg.manaLines(dc);
  const legacyFx = [...leg.fixedColours(dc)];
  // D1 (task 2a): the derived colour-source lines. D2: the colour audit's own `supplied` for a deck of this card and five one-pip spells.
  const fx = ml.colourSourceColours(dc);
  const demand = ["W", "U", "B", "R", "G"].map((c) => ({ card: { name: `demand ${c}`, typeLine: "Instant", manaCost: `{${c}}`, manaValue: 1, oracleText: "", keywords: [], colors: [] }, tags: null }));
  const audit = ma.manaAuditFull([dc, ...demand] as any).rows.filter((r: any) => r.supplied > 0).map((r: any) => r.color);
  let cs: string[] = []; try { cs = [...mb.colourSources([dc]).entries()].filter(([, n]: any) => n > 0).map(([c]: any) => c); } catch {}
  let lf: string[] | null = null; if (isLand) { try { lf = ls.landFacts(dc, ALLC as any, [dc]).colours; } catch {} }
  const acc = gf.classifyAccelerant(dc);
  const li = m.landInputs([dc]);
  const ramp = m.detectBuildCategories([dc]).get("ramp")?.has(name) ?? false;
  rows.push({
    name, type: dc.card.typeLine, mv: dc.card.manaValue, produced: [...(dc.card.producedMana ?? [])].join(""),
    tag: abil.map((a: any) => `${a.effect.kind}/${a.repeats ?? "-"}/${a.cost ?? ""}`).join("|"),
    ml: lines.map((l: any) => `${l.colours.join("")}${l.qualifies ? "" : "!q"}n${l.net}`).join("|"),
    legacyFixed: legacyFx.join(""), fixed: fx.join(""), audit: audit.join(""), cs: cs.join(""), lf: lf === null ? null : lf.join(""),
    acc: acc?.kind ?? null, out: acc ? gf.manaOutput(dc.card.oracleText).amount : null, ritual: gf.ritualAdds(dc),
    fast: li.fastMana, cheap: li.rampPlusDraw, ramp, grade: bd.rampGrade(dc),
    ny: sj.netYield(dc), dork: sj.isPlainDork(dc), sfix: sf.staticFixer(dc)?.covers ?? null, land: isLand,
    decks: deckOf.get(name)!.length, text: (dc.card.oracleText ?? "").replace(/\n/g, " / "),
  });
}
writeFileSync(process.argv[2]!, JSON.stringify({ rows, nDecks: Object.keys(decks).length }));
console.log(rows.length, "cards", Object.keys(decks).length, "decks");
await store.close();
