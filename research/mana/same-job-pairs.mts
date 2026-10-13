/** SAME-JOB PAIRS AMONG THE RAMP-ROLE CARDS OF THE CENSUS DECKS (#1169): every ordered (cut, add) pair under each swap predicate, and each card's yield, as JSON, so a derive or
 *  matcher change is a diff of two files. `npx tsx research/mana/same-job-pairs.mts out.json` (env sourced, sandbox off); `--diff a.json b.json` lists what moved. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
if (process.argv[2] === "--diff") {
  const a = JSON.parse(readFileSync(process.argv[3]!, "utf8")), b = JSON.parse(readFileSync(process.argv[4]!, "utf8"));
  for (const k of Object.keys(a.pairs)) {
    const A = new Set<string>(a.pairs[k]), B = new Set<string>(b.pairs[k]);
    const lost = [...A].filter((x) => !B.has(x)), gained = [...B].filter((x) => !A.has(x));
    console.log(`${k}: ${A.size} -> ${B.size} (+${gained.length} -${lost.length})`);
    for (const x of gained.slice(0, 12)) console.log("   +", x);
    for (const x of lost.slice(0, 12)) console.log("   -", x);
  }
  const moved = Object.keys({ ...a.yield, ...b.yield }).filter((n) => JSON.stringify(a.yield[n]) !== JSON.stringify(b.yield[n]));
  console.log(`yield differs on ${moved.length} cards`);
  for (const n of moved.slice(0, 40)) console.log(`   ${n}: ${JSON.stringify(a.yield[n])} -> ${JSON.stringify(b.yield[n])}`);
  process.exit(0);
}
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const sj = await import(`${R}/matcher/src/same-job.ts`);
const { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames, CALIBRATION_DECKS, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const files = [...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).map((f: string) => `${CALIBRATION_DECKS}/${f}`),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `${DECKS_DIR}/${n}.txt`)];
const byName = new Map<string, any>();
for (const f of files) {
  const s = parseDecklistSections(readFileSync(f, "utf8"));
  const { cards } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const dcs = await m.buildDeckCards(cards, lookup, tags);
  const ramp = m.detectBuildCategories(dcs).get("ramp") ?? new Set();
  for (const dc of dcs) if (ramp.has(dc.card.name) && !/\bland\b/i.test(dc.card.typeLine ?? "")) byName.set(dc.card.name, dc);
}
const dcs = [...byName.values()].sort((x, y) => x.card.name.localeCompare(y.card.name));
const pairs: Record<string, string[]> = { sameJob: [], fetch: [], rock: [], dork: [], sameGroup: [] };
for (const c of dcs) for (const a of dcs) {
  if (c === a) continue;
  const id = `${c.card.name} > ${a.card.name}`;
  if (sj.sameJob(c, a, "ramp")) pairs.sameJob.push(id);
  if (sj.sameFetchAnyColour(c, a)) pairs.fetch.push(id);
  if (sj.sameRockAnyColour(c, a)) pairs.rock.push(id);
  if (sj.sameDorkAnyColour(c, a)) pairs.dork.push(id);
  if (sj.sameGroup(c, a, "ramp") && c.card.name < a.card.name) pairs.sameGroup.push(id);
}
const yields: Record<string, unknown> = {};
for (const dc of dcs) yields[dc.card.name] = [sj.netYield(dc), sj.colouredNetYield(dc), sj.netPositiveMana(dc)];
writeFileSync(process.argv[2]!, JSON.stringify({ n: dcs.length, pairs, yield: yields }));
console.log(dcs.length, "ramp-role cards", Object.entries(pairs).map(([k, v]) => `${k} ${v.length}`).join(", "));
await store.close();
