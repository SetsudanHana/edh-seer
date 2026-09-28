/** THE OFFLINE CARD FIXTURE, read the way production derives (test support). `fixtures/compass-clauses.json`
 *  holds each card's stored canonical clauses and everything `derive-corpus` feeds `deriveCardTags`
 *  (`build-compass-fixture.ts --from-store`), so a check built on it -- the compass ratchet, the role
 *  expectations -- measures production's own derivation with no database. */
import { readFileSync } from "node:fs";
import { deriveCardTags } from "@edh-seer/tagger";
import type { Characteristics, ClauseRecord } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";

export interface FixtureCard {
  name: string;
  oracleId: string;
  clauses: ClauseRecord[];
  characteristics: Characteristics;
  clauseTexts?: Record<number, string>;
  clauseCosts?: Record<number, string>;
  clauseRequires?: Record<number, never>;
  clauseFaces?: Record<number, number>;
  grantedToken?: number[];
  oracleText?: string;
  typeLine?: string;
}

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/compass-clauses.json", import.meta.url), "utf8"),
) as FixtureCard[];
export const fixtureNames: ReadonlySet<string> = new Set(FIXTURE.map((f) => f.name));
const byName = new Map(FIXTURE.map((f) => [f.name, f]));

export function fixtureDeckCard(name: string): DeckCard {
  const f = byName.get(name);
  if (!f) throw new Error(`fixture missing card: ${name} — regenerate with build-compass-fixture.ts --from-store`);
  return {
    card: {
      name: f.name,
      typeLine: f.typeLine ?? [...f.characteristics.types, ...f.characteristics.subtypes].join(" "),
      oracleText: f.oracleText ?? "",
      keywords: f.characteristics.keywords,
      colors: f.characteristics.colors,
      manaValue: f.characteristics.cmc,
      colorIdentity: f.characteristics.identity,
      power: f.characteristics.power,
      toughness: f.characteristics.toughness,
    },
    tags: deriveCardTags({
      oracleId: f.oracleId, name: f.name, clauses: f.clauses, characteristics: f.characteristics,
      clauseTexts: f.clauseTexts, clauseCosts: f.clauseCosts, clauseRequires: f.clauseRequires,
      clauseFaces: f.clauseFaces, oracleText: f.oracleText,
      grantedToken: f.grantedToken ? new Set(f.grantedToken) : undefined,
    }),
  } as DeckCard;
}
