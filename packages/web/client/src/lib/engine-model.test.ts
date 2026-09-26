import { describe, expect, test } from "vitest";
import { nodeId as matcherNodeId } from "@edh-seer/matcher/graph-projection";
import { engineDeck } from "./engine-model.fixture.js";
import { buildEngineModel, groupName, nodeId, plural } from "./engine-model.js";
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
    // Clerics are used by the same two payoffs, so the second says so instead of listing them again.
    const clerics = m.cuts.filter((c) => c.card.name.startsWith("Cleric") && !c.keepActs);
    expect(clerics[0]!.sameUsersAs).toBeUndefined();
    expect(clerics.slice(1).every((c) => c.sameUsersAs === clerics[0]!.card.name)).toBe(true);
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
