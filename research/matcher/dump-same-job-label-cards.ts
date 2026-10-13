/** The labelled same-job pairs' cards, resolved from Mongo (the card doc and its DERIVED tags), written beside the labels so the
 *  G1 gate runs in the unit suite without Mongo or a static build:
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx research/matcher/dump-same-job-label-cards.ts     # reads Mongo (read-only), writes the fixture
 *
 *  Only the fields `groupKey` and `sameJob` read are kept: the card's text and types, the grammar's `abilities` and `characteristics`, and
 *  the DERIVED MANA KEYS the ramp key reads since #1169 (`manaLines`, `staticFixer`, `landFetch`, `isOneShot`, `suspendOnly`). Without them
 *  every ramp card keys on nothing and G1 cannot see the ramp key at all (whole-branch review 2026-10-13: the fixture had no mana keys, so every
 *  ramp card keyed `"", "~"`). No `producedMana`: nothing reads it from the card any more. It used to read `static-out/`, which is a build artefact
 *  and was stale; the derived rows are the source. Re-run after a corpus or derive change that should move the gate, and say so in the PR. */
import { readFileSync, writeFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, resolveNames } from "../../packages/data/src/index.js";
import { buildDeckCards } from "../../packages/matcher/src/index.js";
import { createTagsLookup } from "../../packages/tagger/src/index.js";

const labels = JSON.parse(readFileSync("packages/matcher/src/same-job.labels.json", "utf8")) as { pairs: { out: string; in: string }[] };
const names = [...new Set(labels.pairs.flatMap((p) => [p.out, p.in]))].sort();
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const { cards } = await resolveNames(names, lookup);
const dcs = await buildDeckCards(cards, lookup, createTagsLookup(store.db, "derived"));
const byName = new Map(dcs.map((d) => [normalizeName(d.card.name), d]));
const KEYS = ["manaLines", "staticFixer", "landFetch", "isOneShot", "suspendOnly"] as const;
const out: Record<string, unknown> = {};
for (const n of names) {
  const d = byName.get(normalizeName(n));
  if (!d) throw new Error(`not in the corpus: ${n}`);
  const tags = d.tags as unknown as Record<string, unknown> | null;
  const { name, typeLine, manaValue, manaCost, oracleText, keywords, layout, colors, colorIdentity } = d.card as unknown as Record<string, unknown>;
  const mana = Object.fromEntries(KEYS.filter((k) => tags?.[k] !== undefined).map((k) => [k, tags![k]]));
  out[n] = { card: { name, typeLine, manaValue, manaCost, oracleText, keywords, layout, colors, colorIdentity },
    tags: { oracleId: tags?.oracleId, characteristics: tags?.characteristics, abilities: tags?.abilities, ...mana } };
}
writeFileSync("packages/matcher/src/same-job.labels.cards.json", `${JSON.stringify(out, null, 1)}\n`);
console.log(`${names.length} cards -> packages/matcher/src/same-job.labels.cards.json`);
await store.close();
