import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { demandKeysOf, fodderDemandsOf } from "./partners-core.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/disjunct-sacrifice-1805.json" with { type: "json" };

/** #1805, owner ruling 2026-11-24: "it is not an answer it is part of the cost of the spell". "Sacrifice an artifact or creature" (Deadly Dispute, Defiant Salvager) and "sacrifice an artifact or land" (Destructive Digger) is a COST of your own,
 *  so it asks for fodder of each type it names, as a lone "sacrifice an artifact" outlet does: an artifact is fodder (a lone artifact outlet reaches it), and a creature or a land is fodder only as it is for a lone "sacrifice a creature" / "sacrifice a land" outlet
 *  (a token, a card that comes back) -- nothing wider. An edict ("target player sacrifices an artifact or creature of their choice", Hit // Run) is an answer, not your cost. Stored documents and clauses of the production corpus, 2026-11-25. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const treasure = (): DeckCard => ({ card: { name: "Treasure", typeLine: "Token Artifact — Treasure", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: F["__treasure"] as unknown as CardTags, isToken: true });
const fodder = (p: DeckCard, c: DeckCard) => pairReasons(p, c, loadHierarchy()).filter((r) => r.tag.startsWith("fodder:") && r.consumer === c.card.name && r.producer === p.card.name);
const keys = (n: string) => fodderDemandsOf(dc(n)).map((k) => k.key).sort();

test("the cost names its types, and each is a fodder demand", () => {
  expect(F["Deadly Dispute"]!.source.oracleText).toContain("As an additional cost to cast this spell, sacrifice an artifact or creature.");
  expect(keys("Deadly Dispute")).toEqual(["fodder|-|artifact|-", "fodder|-|creature|-"]);
  expect(F["Defiant Salvager"]!.source.oracleText).toContain("Sacrifice an artifact or creature: Put a +1/+1 counter on this creature.");
  expect(keys("Defiant Salvager")).toEqual(["fodder|-|artifact|-", "fodder|-|creature|-"]);
  expect(F["Destructive Digger"]!.source.oracleText).toContain("Sacrifice an artifact or land: Draw a card.");
  expect(keys("Destructive Digger")).toEqual(["fodder|-|artifact|-", "fodder|-|land|-"]);
  expect(demandKeysOf(dc("Deadly Dispute"))).toEqual(expect.arrayContaining(["fodder|-|artifact|-", "fodder|-|creature|-"]));
});

test("an edict is an answer, not your cost: Hit // Run (target player sacrifices an artifact or creature) asks for no fodder", () => {
  expect(F["Hit // Run"]!.source.oracleText).toContain("Target player sacrifices an artifact or creature of their choice.");
  expect(keys("Hit // Run")).toEqual([]);
  expect(fodder(dc("Sol Ring"), dc("Hit // Run"))).toEqual([]);
});

test.each(["Deadly Dispute", "Defiant Salvager", "Destructive Digger"])("an artifact is fodder for %s, and so is a Treasure; a plain creature is not (it is the whole deck)", (c) => {
  expect(fodder(dc("Sol Ring"), dc(c)).map((r) => r.tag), "Sol Ring").toEqual(["fodder:artifact"]);
  expect(fodder(dc("Ornithopter"), dc(c)).map((r) => r.tag), "Ornithopter").toEqual(["fodder:artifact"]);
  expect(fodder(treasure(), dc(c)).map((r) => r.tag), "Treasure").toEqual(["fodder:artifact"]);
  expect(fodder(dc("Llanowar Elves"), dc(c)), "Llanowar Elves").toEqual([]);
});

// OWNER VERDICT 2026-10-16 (Aether Spellbomb), unchanged: a card spent through its own "sacrifice this" for the same payoff is no fodder for an outlet that pays the same. Mind Stone draws a card; Destructive Digger draws a card.
test("the Spellbomb verdict still holds: Mind Stone (sacrifice this: draw a card) is no fodder for Destructive Digger, and is for Deadly Dispute", () => {
  expect(fodder(dc("Mind Stone"), dc("Destructive Digger"))).toEqual([]);
  expect(fodder(dc("Mind Stone"), dc("Deadly Dispute")).map((r) => r.tag)).toEqual(["fodder:artifact"]);
});

test("an artifact creature is fodder as an artifact (Ornithopter), never as the wider creature", () => {
  expect(fodder(dc("Ornithopter"), dc("Deadly Dispute")).map((r) => r.tag)).toEqual(["fodder:artifact"]);
});

test("the sentence says the card is fodder, with no 'counts it and' and no empty tail", () => {
  const [r] = fodder(dc("Sol Ring"), dc("Deadly Dispute"));
  expect(r!.text).toBe("Sol Ring is fodder for Deadly Dispute");
});

test("a lone-type outlet is unchanged: Lobelia (sacrifice an artifact) still takes Sol Ring, and Viscera Seer (sacrifice a creature) still refuses Llanowar Elves", () => {
  expect(fodder(dc("Sol Ring"), dc("Lobelia, Defender of Bag End")).map((r) => r.tag)).toEqual(["fodder:artifact"]);
  expect(fodder(dc("Llanowar Elves"), dc("Viscera Seer"))).toEqual([]);
});

// THE REVIEW'S PROBES (#1805): derive files these as `control: "you"`, but none is your own cost.
test.each([
  ["Pir's Whim", "Each foe sacrifices an artifact or enchantment of their choice."],
  ["Torment of Venom", "Its controller loses 3 life unless they sacrifice another nonland permanent of their choice or discard a card."],
  ["Maarika, Brutal Gladiator", "that creature's controller sacrifices a noncreature, nonland permanent."],
  ["Devastating Onslaught", "Sacrifice them at the beginning of the next end step."],
])("%s: not your own cost (an edict, a victim's choice, your own tokens), so it asks for no fodder and no artifact is fodder for it", (c, printed) => {
  expect(F[c]!.source.oracleText).toContain(printed);
  expect(keys(c), c).toEqual([]);
  expect(fodder(dc("Sol Ring"), dc(c)), c).toEqual([]);
});
test("an optional sacrifice of your own is still a cost: Undercity Eliminator (you may sacrifice an artifact or creature)", () => {
  expect(F["Undercity Eliminator"]!.source.oracleText).toContain("you may sacrifice an artifact or creature");
  expect(keys("Undercity Eliminator")).toEqual(["fodder|-|artifact|-", "fodder|-|creature|-"]);
  expect(fodder(dc("Sol Ring"), dc("Undercity Eliminator")).map((r) => r.tag)).toEqual(["fodder:artifact"]);
});

// "nonland permanent" (`notType: ["land"]`, five types derive expands it to) is no ruled "X or Y" list: Gluttonous Troll and Claws of Gix ("a permanent") agree.
test("a 'nonland permanent' cost reads as a permanent cost does: Gluttonous Troll and Claws of Gix both refuse Sol Ring", () => {
  expect(F["Gluttonous Troll"]!.source.oracleText).toContain("Sacrifice another nonland permanent:");
  expect(F["Claws of Gix"]!.source.oracleText).toContain("Sacrifice a permanent:");
  expect(fodder(dc("Sol Ring"), dc("Claws of Gix"))).toEqual([]);
  expect(fodder(dc("Sol Ring"), dc("Gluttonous Troll"))).toEqual([]);
  expect(keys("Gluttonous Troll")).toEqual(["fodder|-|permanent|-"]); // #1814: asks for the permanent key, as Claws of Gix does
});

// THE MAKER STANDS IN FOR ITS TOKEN on a card page (`tokensMediate: false`): its tag is the TOKEN's type (a Treasure is an artifact), or the page, which matches by the demand's tags, drops it.
test("Pitiless Plunderer (makes a Treasure) is on Deadly Dispute's page under the artifact key", () => {
  expect(F["Pitiless Plunderer"]!.source.oracleText).toContain("create a Treasure token");
  const rs = pairReasons(dc("Pitiless Plunderer"), dc("Deadly Dispute"), loadHierarchy(), { tokensMediate: false }).filter((r) => r.tag.startsWith("fodder:") && r.producer === "Pitiless Plunderer");
  expect(rs.map((r) => r.tag)).toEqual(["fodder:artifact"]);
  expect(rs[0]!.text).toBe("Pitiless Plunderer makes fodder for Deadly Dispute");
  expect(fodderDemandsOf(dc("Deadly Dispute")).map((k) => k.tag)).toContain(rs[0]!.tag);
});
