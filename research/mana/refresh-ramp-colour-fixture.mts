/** Adds the CURRENT derived mana keys (manaLines, staticFixer, landFetch, isOneShot, suspendOnly) from Mongo to every card's `tags` in
 *  packages/matcher/src/ramp-colour.fixtures.json, same-job.fixtures.json and quality.fixtures.json (#1169 task 2a; re-run at DERIVE 307 for the
 *  whole-branch review: most cards had no `trigger` / `triggerSubject` or no mana keys at all). A card is found by its `_id`, else its `oracleId`, else its name, leaving the rest of each fixture untouched: the matcher's colour-source
 *  consumers read those keys now, and the fixture predates them. Run from the repo root (sandbox off, env sourced). */
import { readFileSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const store = await data.connect(data.loadConfig());
const tags = tagger.createTagsLookup(store.db, "derived");
const KEYS = ["manaLines", "staticFixer", "landFetch", "isOneShot", "suspendOnly"];
let n = 0;
for (const FILE of ["packages/matcher/src/ramp-colour.fixtures.json", "packages/matcher/src/same-job.fixtures.json", "packages/matcher/src/quality.fixtures.json"]) {
const fx = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, { card: { _id?: string; name?: string }; tags: Record<string, unknown> | null }>;
for (const [name, e] of Object.entries(fx)) {
  const id = e.card._id ?? (e.tags?.oracleId as string | undefined) ?? String((await store.db.collection("cards").findOne({ name: e.card.name ?? name }))?._id);
  const cur: any = await tags.findOne(id);
  if (!cur) { console.log("NO TAGS", name); continue; }
  e.tags = e.tags ?? {};
  for (const k of KEYS) { delete e.tags[k]; if (cur[k] !== undefined) { e.tags[k] = cur[k]; n++; } }
}
writeFileSync(FILE, JSON.stringify(fx, null, 1) + "\n");
console.log(FILE, Object.keys(fx).length, "cards,", n, "mana keys written so far");
}
await store.close();
