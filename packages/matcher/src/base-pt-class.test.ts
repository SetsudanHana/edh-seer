import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/base-pt-class.json" with { type: "json" };

/** #1572, owner ruling 2026-11-08: a whole-class BASE POWER AND TOUGHNESS set ("other creatures you control have base power and toughness 5/3": Graaz; March of the World Ooze 6/6) pairs with the token makers and small creatures it
 *  upgrades and with the "power matters" payoffs, and not with every creature the way an anthem does. Stored documents and clauses dumped from Mongo 2026-11-08. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] }>;
// Read as derive-corpus reads a card the grammar reads completely (Kudo's "Other creatures have base power and toughness 2/2 and are Bears" is stored by the model as the verb `other`; the grammar reads it).
const dc = (name: string): DeckCard => {
  const g = grammarClauseRecords(F[name]!.source as never);
  return {
    card: F[name]!.source as unknown as DeckCard["card"],
    tags: deriveCardTags(g.complete ? deriveInputOf(F[name]!.source as never, name, name, g.records, undefined, g.readings) : deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
  };
};
const base = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.tag === "static:base-pt-set" && r.producer === p && r.consumer === c);

test("the base-P/T half of the sentence is its own ability beside the type-grant, with the set values", () => {
  for (const [n, v] of [["March of the World Ooze", "6/6"], ["Graaz, Unstoppable Juggernaut", "5/3"], ["Raised by Giants", "10/10"], ["Kudo, King Among Bears", "2/2"]] as const) {
    const a = dc(n).tags!.abilities.find((x) => x.effect.kind === "base-pt-set");
    expect(a?.amount, n).toBe(v);
    expect(a?.effect.subject?.scope, n).toBe("all");
    expect(dc(n).tags!.abilities.some((x) => x.effect.kind === "type-grant"), n).toBe(true);
  }
});

test("single-target and until-end-of-turn base sets stay unread: Turn to Frog", () => {
  expect(dc("Turn to Frog").tags!.abilities.some((x) => x.effect.kind === "base-pt-set")).toBe(false);
});

test("the small creatures and token makers it upgrades pair: March x Master of the Hunt, Dwarven Castle Guard, Hordeling Outburst; Graaz x Llanowar Elves", () => {
  for (const c of ["Master of the Hunt", "Dwarven Castle Guard", "Hordeling Outburst", "Grizzly Bears"]) expect(base("March of the World Ooze", c), c).not.toEqual([]);
  expect(base("Graaz, Unstoppable Juggernaut", "Llanowar Elves")).not.toEqual([]);
  expect(base("Graaz, Unstoppable Juggernaut", "Hordeling Outburst")).not.toEqual([]);
});

test("a power-matters payoff pairs: March x Molten Monstrosity, Garruk's Packleader (power 4 or greater), Selvala; Raised by Giants x Temur Battle Rage", () => {
  for (const c of ["Molten Monstrosity", "Garruk's Packleader", "Selvala, Heart of the Wilds", "Heir of the Wilds"]) expect(base("March of the World Ooze", c), c).not.toEqual([]);
  expect(base("Raised by Giants", "Temur Battle Rage")).not.toEqual([]);
});

test("a creature already at or above the set value, a non-creature that is no maker or payoff, and a token the set does not raise do not pair", () => {
  expect(base("Graaz, Unstoppable Juggernaut", "Gigantosaurus")).toEqual([]);
  expect(base("Graaz, Unstoppable Juggernaut", "Sol Ring")).toEqual([]);
  expect(base("March of the World Ooze", "Sol Ring")).toEqual([]);
  expect(base("March of the World Ooze", "Gigantosaurus")).toEqual([]);
  expect(base("Kudo, King Among Bears", "Beast Within")).toEqual([]);
  // a power threshold the set value does not reach is no payoff
  expect(base("Kudo, King Among Bears", "Garruk's Packleader")).toEqual([]);
});

test("a set to 1/1 (Humility, Godhead of Awe) is a hose, and an anthem is no base set", () => {
  for (const p of ["Humility", "Godhead of Awe"]) expect(base(p, "Hordeling Outburst"), p).toEqual([]);
  expect(base("Glorious Anthem", "Grizzly Bears")).toEqual([]);
});

test("a set beside 'lose all abilities' is removal, and an Aura's class set lands on the enchanted player: Sludge Monster, Curse of Conformity pair with no small creature", () => {
  for (const p of ["Sludge Monster", "Curse of Conformity"]) for (const c of ["Hordeling Outburst", "Grizzly Bears"]) expect(base(p, c), `${p} x ${c}`).toEqual([]);
});

test("the type half keeps #1568's gate: March still has no type-grant pair with Grizzly Bears", () => {
  expect(pairReasons(dc("March of the World Ooze"), dc("Grizzly Bears"), loadHierarchy()).filter((r) => r.tag === "static:type-grant")).toEqual([]);
});

test("a set over creatures with a +1/+1 counter pairs with no counter placer: Sigarda's Summons x Cathars' Crusade", () => {
  const all = pairReasons(dc("Sigarda's Summons"), dc("Cathars' Crusade"), loadHierarchy()).filter((r) => r.effectKind === "base-pt-set");
  expect(all).toEqual([]);
});

test("Kudo derives the same from the model's `other` as from the grammar: base-pt-set 2/2 and a type-grant", () => {
  const model = deriveCardTags(deriveInputOf(F["Kudo, King Among Bears"]!.source as never, "Kudo", "Kudo, King Among Bears", F["Kudo, King Among Bears"]!.canonical)) as CardTags;
  expect(model.abilities.map((a) => `${a.effect.kind}:${a.amount ?? ""}`).sort()).toEqual(["base-pt-set:2/2", "type-grant:"]);
});

test("a class a board state narrows pairs with nothing (Sigarda's Summons, Archon of the Wild Rose), and a crew cost is no power payoff (Sleek Schooner)", () => {
  for (const p of ["Sigarda's Summons", "Archon of the Wild Rose"]) for (const c of ["Hordeling Outburst", "Grizzly Bears", "Temur Battle Rage"]) expect(base(p, c), `${p} x ${c}`).toEqual([]);
  expect(base("March of the World Ooze", "Sleek Schooner")).toEqual([]);
});

test("a reading without a threshold needs a set power of 4: Kudo's 2/2 and Harmonious Archon's 3/3 shrink what Miming Slime, Ghalta and Baru read; March's 6/6 raises it", () => {
  expect(base("March of the World Ooze", "Molten Monstrosity")).not.toEqual([]);
  expect(base("Kudo, King Among Bears", "Molten Monstrosity")).toEqual([]);
  expect(base("Harmonious Archon", "Molten Monstrosity")).toEqual([]);
});
