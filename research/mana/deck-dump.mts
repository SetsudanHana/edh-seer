/** WHOLE-REPORT DUMP OF THE CENSUS DECKS (#1169): for every calibration deck (and the three named ones) the full structured report as JSON, plus the Ramp-role
 *  members and the goldfish accelerant classification of every card, so a derive or matcher change is measured as a diff of two files.
 *  `npx tsx research/mana/deck-dump.mts out.json` (env sourced, sandbox off); compare with `npx tsx research/mana/deck-dump.mts --diff a.json b.json`. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
if (process.argv[2] === "--diff") {
  const a = JSON.parse(readFileSync(process.argv[3]!, "utf8")), b = JSON.parse(readFileSync(process.argv[4]!, "utf8"));
  const walk = (x: any, y: any, path: string, out: string[]): void => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x) && !Array.isArray(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${path}.${k}`, out);
    } else out.push(`${path}: ${JSON.stringify(x)?.slice(0, 160)} -> ${JSON.stringify(y)?.slice(0, 160)}`);
  };
  let decks = 0;
  for (const d of Object.keys(a)) {
    const out: string[] = []; walk(a[d], b[d], d, out);
    if (out.length) { decks++; console.log(`## ${d}: ${out.length} differences`); out.slice(0, 40).forEach((l) => console.log("  " + l)); }
  }
  console.log(`${decks} of ${Object.keys(a).length} decks differ`);
  process.exit(0);
}
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const eng = await import(`${R}/engine/src/index.ts`);
const { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const files = [...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).map((f: string) => `${CALIBRATION_DECKS}/${f}`),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `${DECKS_DIR}/${n}.txt`)];
const out: Record<string, any> = {};
for (const f of files) {
  const s = parseDecklistSections(readFileSync(f, "utf8"));
  const { cards, combos } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const cmd = new Set(s.commanders.map(normalizeName));
  const dcs = await m.buildDeckCards(cards, lookup, tags);
  const cn = cards.filter((c: any) => cmd.has(normalizeName(c.name))).map((c: any) => c.name);
  const rep: any = m.analyzeDeckStructured(dcs, cn, undefined, undefined, new eng.ComboIndex(combos));
  const ramp = [...(m.detectBuildCategories(dcs).get("ramp") ?? [])].sort();
  const accel: Record<string, any> = {};
  for (const dc of dcs) { const a = m.classifyAccelerant?.(dc); if (a) accel[dc.card.name] = a.kind; }
  out[f.split("/").pop()!.replace(".txt", "")] = { rep, ramp, accel };
}
writeFileSync(process.argv[2]!, JSON.stringify(out));
console.log(Object.keys(out).length, "decks");
await store.close();
