/** The labelled same-job pairs' cards, as the site resolves them, written beside the labels so the
 *  G1 gate runs in the unit suite without Mongo or a static build:
 *
 *    npx tsx research/matcher/dump-same-job-label-cards.ts     # reads static-out/, writes the fixture
 *
 *  Only the fields `groupKey` and `sameJob` read are kept. Re-run after a corpus or derive change that
 *  should move the gate, and say so in the PR. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeName } from "../../packages/data/src/names.js";
import { StaticLookup } from "../../packages/matcher/src/static-lookup.js";
import { deckCards } from "../../packages/matcher/src/suggest-static.js";
import { STATIC_BASE, staticFetch } from "../../packages/instruments/src/static-deck.js";

const labels = JSON.parse(readFileSync("packages/matcher/src/same-job.labels.json", "utf8")) as { pairs: { out: string; in: string }[] };
const names = [...new Set(labels.pairs.flatMap((p) => [p.out, p.in]))].sort();
const lookup = new StaticLookup(STATIC_BASE, staticFetch(join(process.cwd(), "static-out")));
await lookup.prefetch(names.map(normalizeName));
const dc = deckCards(lookup);
const out: Record<string, unknown> = {};
for (const n of names) {
  const d = await dc(n);
  if (!d) throw new Error(`not in the static build: ${n}`);
  const { name, typeLine, manaValue, manaCost, oracleText, keywords, producedMana, layout, colors, colorIdentity } = d.card as unknown as Record<string, unknown>;
  out[n] = { card: { name, typeLine, manaValue, manaCost, oracleText, keywords, producedMana, layout, colors, colorIdentity }, tags: { oracleId: d.tags?.oracleId, characteristics: d.tags?.characteristics, abilities: d.tags?.abilities } };
}
writeFileSync("packages/matcher/src/same-job.labels.cards.json", `${JSON.stringify(out, null, 1)}\n`);
console.log(`${names.length} cards -> packages/matcher/src/same-job.labels.cards.json`);
