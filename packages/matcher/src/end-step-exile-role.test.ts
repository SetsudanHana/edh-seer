import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { detectBuildCategories } from "./build.js";
import type { DeckCard } from "./types.js";

/** #1502 fix round: Gruesome Encore puts an opponent's creature onto the battlefield under YOUR control and exiles it at the end step. Its exile is of that creature, yours and untargeted, so it is no
 *  `targetedRemoval` (rules.json: a targeted exile of an opponent's permanent). Source document and the stored `cardClauses.canonical` (model) dumped from Mongo 2026-11-04. */
const source = {"name":"Gruesome Encore","typeLine":"Sorcery","oracleText":"Put target creature card from an opponent's graveyard onto the battlefield under your control. It gains haste. Exile it at the beginning of the next end step. If that creature would leave the battlefield, exile it instead of putting it anywhere else.","keywords":[],"colors":["B"],"manaValue":3,"colorIdentity":["B"],"power":null,"toughness":null,"manaCost":"{2}{B}","layout":"normal"};
const canonical = [{"id":1,"abilityType":"spell","actions":[{"verb":"exile","object":"target creature card from an opponent's graveyard","fromZone":"graveyard","toZone":"battlefield","amount":null,"optional":false},{"verb":"grant-ability","object":"haste","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"exile","object":"it","fromZone":"battlefield","toZone":"exile","amount":null,"optional":false}]}] as ClauseRecord[];

test("Gruesome Encore is not targeted removal", () => {
  const tags = deriveCardTags(deriveInputOf(source as never, "gruesome-encore", source.name, canonical)) as CardTags;
  const dc = { card: source as unknown as DeckCard["card"], tags } satisfies DeckCard;
  expect(detectBuildCategories([dc]).get("targetedRemoval")?.has("Gruesome Encore")).toBeUndefined();
});
