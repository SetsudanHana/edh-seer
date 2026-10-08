/** ONE-SHOT (#966 part 1): the cohesion theme label of every precon in packages/data/precons.json,
 *  one line each, so a theme change can be diffed before/after without a 16-minute build-precons.
 *
 *    npx tsx research/matcher/precon-themes.ts > themes.txt */
import { readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, resolveNames } from "../../packages/data/src/index.js";
import { ComboIndex } from "../../packages/engine/src/index.js";
import { createTagsLookup } from "../../packages/tagger/src/index.js";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../../packages/matcher/src/index.js";

type Precon = { name: string; setCode: string; commanders: string[]; cards: { name: string; count: number }[] };
const precons = JSON.parse(readFileSync("packages/data/precons.json", "utf8")) as Precon[];
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db);
const tokenTags = await loadTokenTags(store.db);

for (const p of precons) {
  const names = [...p.commanders, ...p.cards.filter((c) => !p.commanders.includes(c.name)).map((c) => c.name)];
  const { cards, combos } = await resolveNames(names, lookup);
  const commanders = cards.filter((c) => p.commanders.includes(c.name)).map((c) => c.name);
  const report = analyzeDeckStructured(await buildDeckCards(cards, lookup, tags), commanders, undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
  const c = report.cohesion;
  console.log(`${p.setCode}\t${p.name}\t${c ? `${c.theme}${c.dominant ? "" : " (not dominant)"}` : "-"}`);
}
await store.close();
