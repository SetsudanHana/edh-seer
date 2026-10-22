// LOCAL RESEARCH ONLY: ADD real derived rows to packages/matcher/src/fixtures/removal-derived.json (the fixture `realCard()` reads). FREE: reads Mongo, writes the one file.
// Existing rows are left byte-for-byte alone (they are tied to the derive they were captured at); only names not yet in the file are added, in the order given.
//   set -a && source packages/tagger/.env && set +a
//   npx tsx research/matcher/extend-removal-fixture.ts "Lightning Bolt" "Flame Slash" ...
import { readFileSync, writeFileSync } from "node:fs";
import { connect, docToCard, loadConfig } from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";

const FILE = "packages/matcher/src/fixtures/removal-derived.json";
const rows = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
const store = await connect(loadConfig());
const tags = createTagsLookup(store.db, "derived");
for (const name of process.argv.slice(2)) {
  if (name in rows) { console.log(`${name}: already in the fixture`); continue; }
  const doc = await store.db.collection("cards").findOne({ name }) as never as { _id: never } | null;
  if (!doc) throw new Error(`no card "${name}"`);
  const t = await tags.findOne((doc as { _id: never })._id);
  if (!t) throw new Error(`no derived row for "${name}"`);
  const c = docToCard(doc as never);
  rows[name] = { oracleText: c.oracleText, typeLine: c.typeLine, manaValue: c.manaValue, abilities: t.abilities };
  console.log(`${name}: added`);
}
writeFileSync(FILE, `${JSON.stringify(rows, null, 1)}\n`);
await store.close();
