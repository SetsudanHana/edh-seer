/** One-off: normalize the cards the compass gold pairs reference and commit the result as a test
 *  fixture, so the derivation gate runs forever with no API credits and no database.
 *
 *  Usage: TAGGER_PROVIDER=anthropic tsx src/bin/build-gold-fixture.ts */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { connect, loadConfig } from "@mtg/data";
import { canonicalize, type ClauseRecord } from "../canonicalize.js";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { SYSTEM, listClauses } from "../normalize-prompt.js";
import { segment } from "../segment.js";
import type { Characteristics } from "../schema.js";

const GOLD = JSON.parse(readFileSync(
  new URL("../../../matcher/src/goldpairs.json", import.meta.url), "utf8",
)) as { a: string; b: string; verified: boolean }[];

const OUT = new URL("../../../matcher/src/fixtures/gold-clauses.json", import.meta.url);

const names = [...new Set(GOLD.filter((p) => p.verified).flatMap((p) => [p.a, p.b]))].sort();
const store = await connect(loadConfig());
const provider = createProvider({ ...loadTaggerConfig(), maxTokens: 3000 });
const out: unknown[] = [];

for (const name of names) {
  const doc = await store.db.collection("cards").findOne({ name }) as {
    _id: string; oracleText?: string; keywords?: string[]; typeLine?: string;
    colors?: string[]; colorIdentity?: string[]; manaValue?: number; power?: string | null;
    toughness?: string | null;
  } | null;
  if (!doc) { console.log(`MISSING ${name}`); continue; }

  const clauses = segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "");
  const INERT = new Set(["keyword", "reminder", "level", "modal"]);
  const askable = clauses.filter((c) => !INERT.has(c.kind));
  const synthesized = clauses.filter((c) => INERT.has(c.kind))
    .map((c) => ({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text }] }));

  const raw = await provider.chat([
    { role: "system", content: SYSTEM },
    { role: "user", content: `Card: ${name}\nClauses:\n${listClauses(askable)}` },
  ]);
  const got = JSON.parse(raw) as { clauses?: unknown[] };
  const merged = [...(got.clauses ?? []), ...synthesized]
    .sort((a, b) => (a as { id: number }).id - (b as { id: number }).id) as ClauseRecord[];

  const [types, subtypes] = splitTypeLine(doc.typeLine ?? "");
  const characteristics: Characteristics = {
    types, subtypes,
    colors: doc.colors ?? [], identity: doc.colorIdentity ?? [],
    cmc: doc.manaValue ?? 0, power: doc.power ?? null, toughness: doc.toughness ?? null,
    token: false, keywords: doc.keywords ?? [],
  };
  out.push({ name, oracleId: doc._id, clauses: canonicalize(merged), characteristics });
  process.stdout.write(".");
}

/** "Legendary Creature — Human Warrior" -> [["legendary","creature"], ["human","warrior"]] */
function splitTypeLine(line: string): [string[], string[]] {
  const [left, right] = line.toLowerCase().split("—");
  return [
    (left ?? "").trim().split(/\s+/).filter(Boolean),
    (right ?? "").trim().split(/\s+/).filter(Boolean),
  ];
}

mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`\nwrote ${out.length} cards to ${OUT.pathname}`);
await store.close();
