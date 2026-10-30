/** Rewrites every mana / derive fixture from Mongo, WHOLE (#1192): for the cards each fixture already holds (the card set never changes here),
 *  the full `cardTagsDerived` row - every field, `deriveVersion` included - beside the card document. Keys are written in sorted order, so a run
 *  against an unchanged Mongo reproduces the files byte for byte.
 *
 *  Replaces dump-goldfish-fixtures, dump-colour-fixtures, refresh-ramp-colour-fixture, add-fixture-cards and dump-same-job-label-cards (a slim `manaLines` subset of the
 *  row was the defect: isOneShot / suspendOnly / abilities / characteristics read as empty). To ADD a card, put its name in the fixture file
 *  as `"Name": {"card": {"name": "Name"}, "tags": null}` and re-run (same-job.labels.cards.json: one per name in same-job.labels.json). `fixture-derive-version.test.ts` (CI, Mongo-free) fails when a committed row is not at DERIVE_VERSION.
 *
 *    npx tsx research/mana/refresh-fixtures.mts            write the fixtures
 *    npx tsx research/mana/refresh-fixtures.mts --check    exit 1 listing each fixture that differs from what Mongo would write now
 *
 *  Run from the repo root, sandbox off, env sourced (`set -a && source packages/tagger/.env && set +a`). Mongo-only: not a CI gate.
 *  NOT covered: packages/tagger/src/derive/mana-lines.fixtures.json holds a card and its CLAUSES (derive's INPUT, re-derived by the test with
 *  current code, so it has no row to go stale); it is still written by dump-mana-fixtures.mts. */
import { readFileSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const { connect, loadConfig, mongoLookup, resolveNames, docToCard } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const check = process.argv.includes("--check");

type Entry = { card: Record<string, any>; tags: Record<string, any> | null };
const M = "packages/matcher/src";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Recursively sorted keys; arrays keep their order. */
const canon = (v: any): any => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;

/** Whole Card documents + whole rows, via the same path the product takes. Same names in, same names out. */
async function whole(names: string[]): Promise<Entry[]> {
  const { cards, missing } = await resolveNames(names, lookup);
  if (missing.length) throw new Error(`MISSING ${missing.join(", ")}`);
  const dcs = await m.buildDeckCards(cards, lookup, tags);
  const out = dcs.map((dc: any) => ({ card: dc.card, tags: dc.tags ?? null }));
  const got = out.map((e: Entry) => e.card.name);
  if (got.length !== names.length || got.some((n: string, i: number) => n !== names[i])) throw new Error(`card set changed: ${names.filter((n) => !got.includes(n)).join(", ")}`);
  // A card with no derived row (Mana Crypt, Horizon Boughs, Emissary's Ploy: no cardClauses) stays `tags: null`; the pin test allows a null row only for a card that is not commander-legal (derive never runs on one).
  const noRow = out.filter((e: Entry) => !e.tags).map((e: Entry) => e.card.name);
  if (noRow.length) console.warn(`no cardTagsDerived row, written as tags: null: ${noRow.join(", ")}`);
  return out;
}

/** A name-keyed fixture: the card as the product builds it (`docToCard`, so `commanderLegality` etc. are there), plus any stub key the Card
 *  type does not carry (`_id`, `releasedAt`, `reserved`) taken from the raw document, and the whole row. */
async function keyed(file: string): Promise<Record<string, Entry>> {
  const fx = JSON.parse(readFileSync(file, "utf8")) as Record<string, Entry>;
  const out: Record<string, Entry> = {};
  for (const [key, e] of Object.entries(fx)) {
    const doc: any = e.card._id ? await store.db.collection("cards").findOne({ _id: e.card._id } as never)
      : await store.db.collection("cards").findOne({ name: new RegExp("^" + esc(e.card.name ?? key) + "( //|$)") });
    if (!doc) throw new Error(`NO CARD ${key}`);
    const row = await tags.findOne(String(doc._id));
    if (!row) console.warn(`no cardTagsDerived row, written as tags: null: ${key}`);
    const card: Record<string, any> = { ...docToCard(doc) };
    for (const k of Object.keys(e.card)) if (card[k] === undefined && doc[k] !== undefined) card[k] = doc[k];
    out[key] = { card, tags: (row ?? null) as never };
  }
  return out;
}

const goldfishFile = `${M}/fixtures/goldfish-cards.json`;
const colourFile = `${M}/fixtures/mana-colour-sources.json`;
const colourOld = JSON.parse(readFileSync(colourFile, "utf8"));
const names = (es: Entry[]) => es.map((e) => e.card.name as string);

const files: { file: string; value: unknown; indent: number }[] = [
  { file: goldfishFile, value: await whole(names(JSON.parse(readFileSync(goldfishFile, "utf8")))), indent: 0 },
  { file: colourFile, indent: 0, value: { cards: await whole(names(colourOld.cards)), gisa: { commanders: colourOld.gisa.commanders, deck: await whole(names(colourOld.gisa.deck)) } } },
  ...await Promise.all(["ramp-colour.fixtures", "same-job.fixtures", "similar.fixtures", "quality.fixtures", "same-job.labels.cards", "redundancy.fixtures"].map(async (n) => ({ file: `${M}/${n}.json`, value: await keyed(`${M}/${n}.json`), indent: 1 }))),
];

const stale: string[] = [];
for (const { file, value, indent } of files) {
  const text = JSON.stringify(canon(JSON.parse(JSON.stringify(value))), null, indent || undefined) + "\n";
  const same = readFileSync(file, "utf8") === text;
  if (check) { if (!same) stale.push(file); continue; }
  writeFileSync(file, text);
  console.log(same ? "unchanged" : "wrote", file, text.length, "bytes");
}
await store.close();
if (check) {
  if (stale.length) { console.error(`STALE (DERIVE_VERSION ${tagger.DERIVE_VERSION}), run npx tsx research/mana/refresh-fixtures.mts:\n  ${stale.join("\n  ")}`); process.exit(1); }
  console.log("fixtures match Mongo");
}
