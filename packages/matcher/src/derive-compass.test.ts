import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { deriveCardTags } from "@mtg/tagger";
import type { Characteristics } from "@mtg/tagger";
import type { ClauseRecord } from "@mtg/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { classifyPair, type GoldPair } from "./bin/eval-pairs-core.js";
import type { DeckCard } from "./types.js";

interface Fixture {
  name: string;
  oracleId: string;
  clauses: ClauseRecord[];
  characteristics: Characteristics;
}

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/gold-clauses.json", import.meta.url), "utf8"),
) as Fixture[];
const GOLD = JSON.parse(
  readFileSync(new URL("./goldpairs.json", import.meta.url), "utf8"),
) as GoldPair[];

const byName = new Map(FIXTURE.map((f) => [f.name, f]));

function deckCard(name: string): DeckCard {
  const f = byName.get(name);
  if (!f) throw new Error(`fixture missing card: ${name} — regenerate with build-gold-fixture.ts`);
  return {
    card: {
      name: f.name,
      typeLine: [...f.characteristics.types, ...f.characteristics.subtypes].join(" "),
      oracleText: "",
      keywords: f.characteristics.keywords,
      colors: f.characteristics.colors,
      manaValue: f.characteristics.cmc,
      colorIdentity: f.characteristics.identity,
      power: f.characteristics.power,
      toughness: f.characteristics.toughness,
    },
    tags: deriveCardTags({
      oracleId: f.oracleId, clauses: f.clauses, characteristics: f.characteristics,
    }),
  };
}

test("the fixture covers every card the verified gold pairs reference", () => {
  const needed = [...new Set(GOLD.filter((p) => p.verified).flatMap((p) => [p.a, p.b]))];
  const missing = needed.filter((n) => !byName.has(n));
  expect(missing).toEqual([]);
});

test("derived tags keep compass at 55/55", () => {
  const hierarchy = loadHierarchy();
  const failures: string[] = [];
  let pass = 0, total = 0;
  for (const pair of GOLD) {
    if (!pair.verified) continue;
    total++;
    const a = deckCard(pair.a), b = deckCard(pair.b);
    const outcome = classifyPair(pair, pairReasons(a, b, hierarchy), a, b);
    if (outcome.status === "PASS") pass++;
    else failures.push(`[${pair.category}] ${pair.a} / ${pair.b}: ${outcome.status}`);
  }
  // Print every miss so a failure names the pairs rather than just a number.
  if (failures.length) console.log(failures.join("\n"));
  expect(pass).toBe(total);
});
