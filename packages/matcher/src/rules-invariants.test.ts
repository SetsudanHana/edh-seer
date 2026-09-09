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

const ASSERTED = new Set(["111.7", "114.1", "903.3", "712.3a"]);
const TESTED: Record<string, string> = {
  "614": "edges.test.ts — CR 614 multiplier still edges the maker, never the token",
  "601.2f": "edges.test.ts — keeps it when the consumer has an ADDITIONAL COST",
  "704.5j": "edges.test.ts — copy: a token copy of a legend fires its entry trigger AND its death trigger",
  "707.2": "edges.test.ts — copy: a NONLEGENDARY consumer gets the entry and never the legend rule",
  "700.4": "zones.test.ts — dies stays dies (CR 700.4)",
  "700.12": "implied.test.ts — isOutlaw is the five CR 700.12 creature types",
  "111.1": "edges.test.ts — a token is never cast (CR 111.1), so it is never reduced",
  "903.5b": "legality.test.ts — 903.5b flags a repeated nonbasic",
  "903.4b": "legality.test.ts — 903.4b a card that chooses its colour",
  "702.124": "partners.test.ts — 702.124a/c",
  "614.1c": "edges.test.ts — an UNTYPED enters emit does not reach a clone (a clone replaces its own entry)",
};
const PROSE: Record<string, string> = {
  "106.1b": "mana colours", "107.4c": "hybrid mana", "114.2": "emblem recipient (tagger asserts it)", "118.7": "costs paid once",
  "120.3": "damage to a player", "202.3b": "mana value of a split card", "205.2a": "type line", "205.3": "subtypes", "205.4a": "supertypes",
  "302.6": "a creature's summoning sickness", "305.1": "land play", "500.4": "effects expire as a step begins", "501": "beginning phase",
  "603.4": "intervening if", "603.6c": "leaves the battlefield", "613": "layers: OPEN", "613.1f": "P/T layer", "700.6": "leaves",
  "700.7": "colours", "700.9": "historic", "701.17": "sacrifice", "701.22": "scry", "701.23a": "search", "701.25": "surveil",
  "701.29": "fateseal", "701.5": "counter (tagger asserts the emit)", "702": "keyword abilities", "702.179": "speed", "702.62": "changeling",
  "704.5s": "Saga sacrifice", "708.2": "face-down 2/2", "712.4a": "a DFC's back face", "717.4": "Attractions excluded",
  "903": "Commander", "903.10a": "commander damage", "903.2": "a Commander deck", "903.4": "colour identity", "903.6": "singleton",
  "903.8": "commander tax is a caveat, not a number",
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

test("CR 712.3a: a permanent shows one face at a time, so a card-wide static relates to it ONCE", () => {
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
