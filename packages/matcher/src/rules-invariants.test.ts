/** WHAT THE MATCHER KNOWS ABOUT THE RULES, EXECUTABLE (roadmap AC10, 2026-09-09). The tagger twin
 *  is `packages/tagger/src/derive/rules-invariants.test.ts`; same shape, same ratchet: every rule
 *  cited in this package's source is ASSERTED here, TESTED elsewhere (named), or PROSE. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { impliedEvents } from "./implied.js";
import { markCommander } from "./commander.js";
import { pairReasonsAcrossFaces } from "./edges.js";
import type { DeckCard, Hierarchy } from "./types.js";

const ASSERTED = new Set(["111.7", "114.1", "903.3", "712.8d"]);
const TESTED: Record<string, string> = {
  "113.6": "implied.test.ts — a creature only under a condition enters, attacks and connects as no creature; its cast stays a creature spell (#797)",
  "118.6": "castability.test.ts — a card with no mana cost is refused; a {0} card and a multi-face card are not (#978)",
  "702.37": "edges.test.ts — a card with morph can be face down: it meets 'a face-down creature you control' (#896 task 3)",
  "702.168": "edges.test.ts — a card with disguise can be face down, as morph (#896 task 3)",
  "702.74a": "implied.test.ts — evoke sacrifices the creature as it enters",
  "702.66": "implied.test.ts — delve is a graveyard demand (the descend tags, no edge)",
  "704.5m": "edges.test.ts — a producer removing what an Aura enchants supplies the Aura's own dies trigger",
  "614": "edges.test.ts — CR 614 multiplier still edges the maker, never the token",
  "601.2f": "edges.test.ts — keeps it when the consumer has an ADDITIONAL COST",
  "704.5j": "edges.test.ts — copy: a token copy of a legend fires its entry trigger AND its death trigger",
  "707.2": "edges.test.ts — copy: a NONLEGENDARY consumer gets the entry and never the legend rule",
  "700.4": "zones.test.ts — dies stays dies (CR 700.4)",
  "701.17a": "partners-core.test.ts — a mill also supplies the general graveyard put, one way only",
  "400.1": "partners-core.test.ts — a graveyard leave keys apart from a battlefield leave (AK6)",
  "700.12": "implied.test.ts — isOutlaw is the five CR 700.12 creature types",
  "722.3": "prepared: implied.ts preparedAbilities", "722.3a": "only a card with a prepare spell takes the designation", "722.3d": "a prepare spell's cast is a prepared spell (SubjectFilter.prepared)",
  "111.10u": "resource tokens: Lander, Mutagen, Vibranium, Heartwood (archetypes.ts RESOURCE_TOKENS)",
  "111.1": "edges.test.ts — a token is never cast (CR 111.1), so it is never reduced",
  "903.5b": "legality.test.ts — 903.5b flags a repeated nonbasic",
  "903.4b": "legality.test.ts — 903.4b a card that chooses its colour",
  "702.124": "partners.test.ts — 702.124a/c",
  "702.124m": "legality.test.ts — Doctor's companion needs a Time Lord Doctor and nothing else",
  "614.1c": "edges.test.ts — an UNTYPED enters emit does not reach a clone (a clone replaces its own entry)",
  "702.90b": "deck-math.test.ts — infect damage to a player is poison, not life: the whole-table combat speed leaves infect out (#1056)",
  "702.164c": "wincon.test.ts — toxic gives N poison counters in addition to the damage: N read off the text (#1056 poison)",
  "122.1": "wincon.test.ts — a counter stays on the player, so poison adds up across turns (#1056 poison)",
  "701.34a": "wincon.test.ts — proliferate adds one to each player who already has poison (#1056 poison)",
  "704.5c": "wincon.test.ts — ten poison counters and a player loses: the poison route's threshold (#1056)",
  "103.5c": "goldfish.test.ts — the first mulligan in multiplayer is free: every simulated game takes a fresh seven before going to six",
  "103.8c": "wincon.test.ts — no first-turn draw skip in multiplayer, so an opponent's library on our turn t is 92 - t (#1056 mill)",
  "704.5b": "wincon.test.ts — a player loses on the draw from an empty library, so a library at 0 is the mill kill (#1056)",
  "508.1a": "commander-damage.test.ts, zones.test.ts — a creature attacks only with haste or controlled since the turn began, so the commander-damage turn assumes haste and says so (#1056); only a creature attacks, so no tag is attacks:any (#1088)",
  "802.2": "deck-math.test.ts — attackers split across opponents, so three opponents' 40 is a floor for the board's combat speed (#1056)",
  "702.9c": "edges.test.ts — a redundant keyword (flying) the card already prints is not granted again; dethrone stacks",
  "702.108a": "edges.test.ts — prowess reads as the creature getting +1/+1, and only a noncreature spell feeds it",
  "118.12a": "rate.test.ts — the payment that stops an effect is the rate's fallback, floor 0 (Rhystic Study)",
  "606.5": "rate.test.ts — a loyalty cost is not mana; the ability has no rate (Teferi, Temporal Pilgrim)",
  "714.3": "edges.test.ts — a Saga carries lore counters, so it can satisfy a counter-presence condition (AL4)",
  "714.3a": "edges.test.ts — a Saga enters with a lore counter, so it feeds a remove-a-counter cost (issue #511)",
  "702.24": "edges.test.ts — cumulative upkeep carries age counters, same (AL4)",
  "702.139": "legality.test.ts — 702.139a: one companion only, and a card with no Companion ability cannot be one",
  "702.139a": "legality.test.ts — 702.139a: one companion only",
  "702.139b": "legality.test.ts — 702.139b: a companion's condition counts the COMMANDER as part of the starting deck",
  "903.11a": "legality.test.ts — 903.11a: a companion may not share a name with the deck nor leave the commander's identity",
  "903.5a": "legality.test.ts — 903.5a counts COPIES; Yorion can never be met in a 100-card format",
  "702.73a": "legality.test.ts — 702.73a: Kaheera accepts a changeling as every creature type",
  "712.8a": "legality.test.ts — 712.8a: Umori reads a double-faced card by its FRONT face",
  "603.2c": "edge-magnitude.test.ts — a batched ('one or more') consumer hears the whole batch once, so the magnitude caps at one",
  "202.3": "stats.test.ts — mana value is a whole number, so a mana-value parity test holds and 0 is even (#713)",
  "712.14": "faces.test.ts — a card putting itself back onto the battlefield enters FRONT face up unless transformed (#715)",
  "305.6": "land-score.test.ts — a basic land type is a mana ability: a shock land printed with reminder text only makes both its colours (#767)",
};
const PROSE: Record<string, string> = {
  "106.1b": "mana colours", "107.4c": "hybrid mana", "107.14": "energy symbol is a counter on a player (subject.test asserts the player-counter gate)", "114.2": "emblem recipient (tagger asserts it)", "118.7": "costs paid once",
  "120.3": "damage to a player", "202.3b": "mana value of a split card", "205.2a": "type line", "205.3": "subtypes", "205.4a": "supertypes",
  "302.6": "a creature's summoning sickness", "305.1": "land play", "500.5": "unspent mana empties as a step ends", "715.3": "an adventurer card is played as either half", "722.3c": "a prepare spell is cast from a copy in exile", "501": "beginning phase",
  "603.4": "intervening if", "603.6c": "leaves the battlefield", "613": "layers: OPEN", "613.1f": "P/T layer", "700.6": "historic",
  "700.8": "party", "700.9": "modified", "701.17": "mill", "701.22": "scry", "701.23a": "search", "701.25": "surveil",
  "701.34": "proliferate", "701.5": "cast (tagger asserts the emit)", "702": "keyword abilities", "702.179": "speed", "702.62": "suspend (goldfish.ts: a suspended card is never cast from hand for its printed cost)", "704.5d": "a token in a graveyard ceases to exist",
  "704.5s": "Saga sacrifice", "708.2": "face-down 2/2", "709.5i": "a Room fully unlocked", "702.124k": "Choose a Background",
  "903": "Commander", "903.10a": "commander damage", "903.2": "a Commander deck", "903.4": "colour identity", "903.6": "singleton",
  "903.8": "commander tax is a caveat, not a number",
  "113.3": "edges: the copy-ability pass reads the other card's ability kinds (AC12; edges.test asserts Strionic, Gogo, Tawnos)",
  "605.3b": "edges: 'activated' excludes mana abilities in the copy-ability pass (AC12)",
  "306.5b": "edges: a planeswalker's loyalty is a counter (canCarryCounters, AL4)",
  "310.6": "edges: a battle's defence is a counter (canCarryCounters, AL4)",
  "702.63": "edges: vanishing puts time counters on (canCarryCounters, AL4)",
  "702.32": "edges: fading puts fade counters on (canCarryCounters, AL4)",
  "606.3": "partners-core effectOrder: a loyalty ability is once a round, so it ranks with the taps (AN3)",
  "301.7a": "partners-core: a Vehicle prints power and toughness without being a creature, so it carries `pow`/`tou` in the index and answers a Power range -- printed, not \"is a creature\"",
};

const SRC = fileURLToPath(new URL(".", import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
});
const cited = new Set(walk(SRC).flatMap((p) => [...readFileSync(p, "utf8").matchAll(/\bCR (\d{3}(?:\.\d+[a-z]?)?)/g)].map((m) => m[1]!)));

test("every CR rule the matcher cites is asserted, tested elsewhere, or marked prose — and nothing is listed that nothing cites", () => {
  const known = new Set([...ASSERTED, ...Object.keys(TESTED), ...Object.keys(PROSE)]);
  expect([...cited].filter((r) => !known.has(r)).sort(), "cited in source, missing from the ledger").toEqual([]);
  expect([...known].filter((r) => !cited.has(r)).sort(), "in the ledger, cited nowhere").toEqual([]);
});

const chars = (over: Partial<CardTags["characteristics"]>): CardTags["characteristics"] => ({
  types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 2, power: "2", toughness: "2", token: false, keywords: [], ...over,
});

test("CR 111.7: a token is neither a card nor a spell, so it is never cast", () => {
  const verbs = impliedEvents(chars({ token: true })).map((e) => e.verb);
  expect(verbs).not.toContain("cast");
  expect(verbs).toContain("enters");
});

test("CR 114.1: an emblem is not a card and not a permanent — no cast, no enters", () => {
  const verbs = impliedEvents(chars({ types: ["emblem"], emblem: true, power: null, toughness: null } as never)).map((e) => e.verb);
  expect(verbs).not.toContain("cast");
  expect(verbs).not.toContain("enters");
});

test("CR 903.3: the commander designation is a deck fact — stamped on the card, and only on its SELF emits", () => {
  const tags: CardTags = {
    oracleId: "kediss", schemaVersion: 1, promptVersion: 1, model: "t", characteristics: chars({}),
    abilities: [{ kind: "triggered", effect: { kind: "token-generation" }, emits: [
      { verb: "dies", subject: { control: "you", token: null, self: true } },
      { verb: "create-token", subject: { control: "you", token: true, type: "creature" } },
    ] }],
  } as CardTags;
  const marked = markCommander(tags);
  expect(marked.characteristics.commander).toBe(true);
  const [selfEmit, tokenEmit] = marked.abilities[0]!.emits!;
  expect(selfEmit!.subject.commander).toBe(true);
  expect(tokenEmit!.subject.commander).toBeUndefined();
  expect(tags.characteristics.commander).toBeUndefined();
});

test("CR 712.8d-f: a permanent shows one face at a time, so a card-wide static relates to it ONCE", () => {
  const H: Hierarchy = {};
  const reducer: DeckCard = {
    card: { name: "Etherium Sculptor", typeLine: "Artifact Creature", oracleText: "Artifact spells you cast cost {1} less to cast.", keywords: [], colors: [], manaValue: 2 } as unknown as DeckCard["card"],
    tags: { oracleId: "sculptor", schemaVersion: 1, promptVersion: 1, model: "t", characteristics: chars({ types: ["artifact", "creature"] }),
      abilities: [{ kind: "static", effect: { kind: "cost-reduction", subject: { control: "you", token: null, type: ["artifact"], scope: "all" } }, amount: "-1", repeats: "continuous" }] } as CardTags,
  };
  // An artifact on BOTH faces: the reduction is true of each, and it is one claim about one card.
  const twoFaced: DeckCard = {
    card: { name: "Mirrex // Mirrex", typeLine: "Artifact // Artifact", oracleText: "", keywords: [], colors: [], manaValue: 3,
      faces: [{ name: "Front", typeLine: "Artifact", oracleText: "", colors: [] }, { name: "Back", typeLine: "Artifact", oracleText: "", colors: [] }] } as unknown as DeckCard["card"],
    tags: { oracleId: "mirrex", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: chars({ types: ["artifact"], power: null, toughness: null, faces: [{ types: ["artifact"], subtypes: [] }, { types: ["artifact"], subtypes: [] }] } as never),
      abilities: [] } as CardTags,
  };
  const reasons = pairReasonsAcrossFaces(reducer, twoFaced, H).filter((r) => r.tag.startsWith("static:cost-reduction"));
  expect(reasons).toHaveLength(1);
});
