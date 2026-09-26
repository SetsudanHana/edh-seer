import { describe, expect, test } from "vitest";
import { nodeId as matcherNodeId } from "@edh-seer/matcher/graph-projection";
import { engineDeck } from "./engine-model.fixture.js";
import { buildEngineModel, groupName, listNames, nodeId, plural } from "./engine-model.js";
import type { CardGraph, DeckReport } from "../types.js";

describe("nodeId", () => {
  test("matches the projection's node identity, so reasons land on the board's nodes", () => {
    for (const args of [["Sol Ring"], ["Treasure", true], ["Fell the Profane", false, 1], ["Monarch", false, undefined, true]] as const) {
      expect(nodeId(...(args as [string]))).toBe(matcherNodeId(...(args as [string])));
    }
  });
});

describe("groupName", () => {
  test("says what the sentences say, in a player's words", () => {
    expect(groupName("scales:cleric")).toBe("Counts your Clerics");
    expect(groupName("cast:-creature")).toBe("Casting noncreature spells");
    expect(groupName("fodder:goblin")).toBe("Goblins to sacrifice");
    expect(groupName("static:pump")).toBe("Lords: bigger stats");
    expect(groupName("enters:any")).toBe("Cards entering");
  });
  test("plurals", () => {
    expect(plural("sorcery")).toBe("sorceries");
    expect(plural("elf")).toBe("Elves");
    expect(plural("fairy")).toBe("Fairies");
    expect(plural("-land")).toBe("nonland cards");
    expect(plural("party")).toBe("party members");
    expect(groupName("scales:party")).toBe("Counts your party members");
  });
});

describe("buildEngineModel", () => {
  const { report, graph } = engineDeck();
  const m = buildEngineModel(report, graph);

  test("draws a many-to-few block once, with the few as the cards that do something extra", () => {
    const g = m.groups.find((x) => x.tag === "scales:cleric")!;
    expect(g.name).toBe("Counts your Clerics");
    expect(g.hubsConsume).toBe(true);
    expect(g.hubs.sort()).toEqual(["Payoff A", "Payoff B"]);
    expect(g.members).toHaveLength(8);
    expect(g.repeating).toBe(16);
  });

  test("a group whose members repeat one above it says so", () => {
    expect(m.groups.find((g) => g.tag === "attacks:cleric")!.sameAs).toEqual({ name: "Counts your Clerics", extra: [], missing: [] });
    expect(m.groups.find((g) => g.tag === "scales:cleric")!.sameAs).toBeUndefined();
  });

  test("carries the printed mana cost", () => {
    expect(m.cards.get("Doom Blade")!.manaCost).toBe("{1}{B}");
    expect(m.cards.get("token:Treasure")!.manaCost).toBe("");
  });

  test("lists helpers after the deck's own groups", () => {
    const helperAt = m.groups.findIndex((g) => g.helper);
    expect(helperAt).toBeGreaterThan(-1);
    expect(m.groups.slice(helperAt).every((g) => g.helper)).toBe(true);
    expect(m.groups.find((g) => g.tag === "static:cost-reduction")!.hubs).toEqual(["Reducer"]);
  });

  test("counts once-only links and places tokens on their own nodes", () => {
    expect(m.onceLinks).toBe(4);
    expect(m.partners.get("token:Treasure")?.has("Payoff A")).toBe(true);
    expect(m.tokens).toBe(1);
    expect(m.deckCards).toBe(17);
  });

  test("a card that drives one of the deck's groups is not a cut candidate", () => {
    expect(m.cuts.map((c) => c.card.name)).not.toContain("Payoff A");
    expect(m.cuts.map((c) => c.card.name)).not.toContain("Payoff B");
  });

  test("a card that helps many in the background is not a cut candidate", () => {
    expect(m.cuts.map((c) => c.card.name)).not.toContain("Reducer");
  });

  test("a card nothing touches leads the cut list, and removal is judged with its own kind", () => {
    expect(m.cuts[0]!.card.name).toBe("Vanilla");
    expect(m.cuts[0]!.why).toBe("Works with nothing else in this deck.");
    expect(m.cuts.map((c) => c.card.name)).not.toContain("Doom Blade");
    expect(m.jobs).toEqual([["Removal", [expect.objectContaining({ card: expect.objectContaining({ name: "Doom Blade" }) })]]]);
  });

  test("a card whose only help works once says so, and counts it at half weight", () => {
    const raise = m.cuts.find((c) => c.card.name === "Raise Once")!;
    expect(raise.why).toBe("All it does here is help 1 card once, by finding them or bringing them back.");
    expect(raise.keep?.text).toBe("Raise Once can bring back Cleric 1");
    const digger = m.cuts.find((c) => c.card.name === "Digger")!;
    expect(digger.givesOnce).toBe(3);
    expect(m.cuts.indexOf(digger)).toBeGreaterThan(m.cuts.indexOf(raise));
  });

  test("the reason to keep a card is one where its own text acts, and never an unread effect", () => {
    const side = m.cuts.find((c) => c.card.name === "Sidekick")!;
    expect(side.real).toBe(2);
    expect(side.keep?.text).toBe("When Cleric 3 gains you life, Sidekick grows");
    expect(side.keepActs).toBe(true);
    expect(m.cuts.find((c) => c.card.name.startsWith("Cleric"))!.keepActs).toBe(false);
    // Clerics used by exactly the same cards fold into one row instead of repeating it.
    const clerics = m.cuts.filter((c) => c.card.name.startsWith("Cleric") && !c.keepActs);
    expect(clerics).toHaveLength(1);
    expect(clerics[0]!.twins.length).toBeGreaterThan(0);
    expect(clerics[0]!.twins.every((n) => n.startsWith("Cleric"))).toBe(true);
  });

  test("a pair that helps both ways shows both directions, and no card fills the strip", () => {
    const top = m.strongest.find((p) => p.pair.a === "Payoff A" && p.pair.b === "Payoff B")!;
    expect(top.both).toBe(true);
    expect(new Set(top.lines.map((l) => l.from))).toEqual(new Set(["Payoff A", "Payoff B"]));
    expect(top.lines.length).toBeLessThanOrEqual(Math.max(top.ways.length, 2));
    const count = new Map<string, number>();
    for (const p of m.strongest) for (const id of [p.pair.a, p.pair.b]) count.set(id, (count.get(id) ?? 0) + 1);
    expect(Math.max(...count.values())).toBeLessThanOrEqual(2);
  });
});

test("a pair helps both ways only when each card acts in a line, whichever side produced the link", () => {
  // A recursion link's producer is the card in the graveyard: B -> A, yet A does the work.
  const reasons = [
    { producer: "B", consumer: "A", tag: "graveyard-recursion:creature", text: "When B is in the graveyard, A can bring it back" },
    { producer: "A", consumer: "B", tag: "static:keyword-grant", text: "A gives B an extra ability", repeatability: "static" },
  ];
  const report = {
    commanders: [], cards: ["A", "B"].map((name) => ({ name, score: 1 })),
    edges: reasons.map((r) => ({ a: r.producer, b: r.consumer, score: 1, reasons: [r] })),
  } as unknown as DeckReport;
  const graph = {
    nodes: ["A", "B"].map((n) => ({ id: n, label: n, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 2, roles: [] })),
    edges: [], undirectedReasons: 0, offDeckReasons: 0,
  } as unknown as CardGraph;
  const [pair] = buildEngineModel(report, graph).strongest;
  expect(pair!.both).toBe(false);
});

function tiny(names: string[], reasons: { producer: string; consumer: string; tag: string; text: string; repeatability?: string }[]) {
  const report = {
    commanders: [], cards: names.map((name) => ({ name, score: 1 })),
    edges: reasons.map((r) => ({ a: r.producer, b: r.consumer, score: 1, reasons: [r] })),
  } as unknown as DeckReport;
  const graph = {
    nodes: names.map((n) => ({ id: n, label: n, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 2, roles: [] })),
    edges: [], undirectedReasons: 0, offDeckReasons: 0,
  } as unknown as CardGraph;
  return buildEngineModel(report, graph);
}

test("a copy link is the copier helping, so a pair whose every line runs one way is one-way", () => {
  // Sythis acts in the cast line, but Weaver helped; Weaver copying Sythis helps Sythis too.
  const [pair] = tiny(["Sythis", "Weaver"], [
    { producer: "Weaver", consumer: "Sythis", tag: "cast:enchantment", text: "When Weaver is cast, Sythis gains you life" },
    { producer: "Sythis", consumer: "Weaver", tag: "copies:triggered", text: "Weaver copies Sythis's triggered ability", repeatability: "activated" },
  ]).strongest;
  expect(pair!.both).toBe(false);
});

test("a doubled card is not what acts in the doubler's line", () => {
  const m = tiny(["Doubler", "Wizard", "Payoff"], [
    { producer: "Doubler", consumer: "Wizard", tag: "doubles:shaman", text: "Wizard's triggered abilities trigger an additional time thanks to Doubler", repeatability: "static" },
    { producer: "Wizard", consumer: "Payoff", tag: "enters:wizard", text: "When Wizard enters, Payoff draws you 1 card" },
  ]);
  const wizard = m.cuts.find((c) => c.card.name === "Wizard")!;
  expect(wizard.keepActs).toBe(false);
});

test("one-time links are named, count a little, and a card that can be brought back says so", () => {
  const m = tiny(["Flicker", "A", "B", "C", "Lone", "Digger"], [
    ...["A", "B", "C"].map((x) => ({ producer: "Flicker", consumer: x, tag: "enters:creature", text: `When ${x} enters thanks to Flicker, ${x} triggers again`, repeatability: "oneshot" })),
    { producer: "Digger", consumer: "Flicker", tag: "recursion-target:instant", text: "Digger can bring back Flicker" },
    { producer: "Lone", consumer: "A", tag: "attacks:any", text: "When Lone attacks, A grows" },
  ]);
  const flicker = m.cuts.find((c) => c.card.name === "Flicker")!;
  expect(flicker.why).toMatch(/happens only once: with A, B and C\. Digger can bring it back to do it again\./);
  expect(flicker.broughtBackBy).toBe("Digger");
  // Rows show in the order of the number they print: no repeating link comes before one.
  expect(m.cuts.indexOf(flicker)).toBeLessThan(m.cuts.findIndex((c) => c.card.name === "Lone"));
});

test("names with commas are separated so they cannot be misread", () => {
  expect(listNames(["Falco Spara, Pactweaver", "Sol Ring"])).toBe("Falco Spara, Pactweaver and Sol Ring");
  expect(listNames(["Falco Spara, Pactweaver", "Sol Ring", "Mox"])).toBe("Falco Spara, Pactweaver; Sol Ring and Mox");
  expect(listNames(["A", "B", "C", "D"], 2)).toBe("A, B and 2 others");
});

test("an effect the engine has not read does not rank a pair", () => {
  const m = tiny(["A", "B"], [
    { producer: "A", consumer: "B", tag: "counter-added:creature", text: "When A gets a counter, B triggers" },
  ]);
  expect(m.strongest).toHaveLength(0);
});

test("a card's back face says whose back it is", () => {
  const report = {
    commanders: [], cards: [{ name: "Front // Back", score: 1 }, { name: "Payoff", score: 1 }],
    edges: [{ a: "Back", b: "Payoff", score: 1, reasons: [{ producer: "Front // Back", producerFace: 1, consumer: "Payoff", tag: "enters:creature", text: "When Back enters, Payoff draws you 1 card" }] }],
  } as unknown as DeckReport;
  const graph = {
    nodes: [
      { id: "Front // Back", label: "Front", cardName: "Front // Back", copies: 1, types: ["creature"], roles: [] },
      { id: "face:1:Front // Back", label: "Back", cardName: "Front // Back", copies: 1, types: ["creature"], roles: [] },
      { id: "Payoff", label: "Payoff", copies: 1, types: ["creature"], roles: [] },
    ],
    edges: [], undirectedReasons: 0, offDeckReasons: 0,
  } as unknown as CardGraph;
  const m = buildEngineModel(report, graph);
  expect(m.cards.get("face:1:Front // Back")!.faceOf).toBe("Front");
  expect(m.cards.get("Front // Back")!.faceOf).toBeUndefined();
});
