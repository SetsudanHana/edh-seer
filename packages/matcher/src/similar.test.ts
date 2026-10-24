import { describe, expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import fixtures from "./similar.fixtures.json" with { type: "json" };
import { compareCards, signatureOf, similarIndex, type SimilarCard } from "./similar.js";

/** Cards as the corpus derives them (read from Mongo at DERIVE_VERSION 388; text checked against the oracle text beside each tag row). */
const names = Object.keys(fixtures) as (keyof typeof fixtures)[];
const cards: SimilarCard[] = names.map((n, i) => ({ id: i + 1, name: n, tags: (fixtures[n] as unknown as { tags: CardTags }).tags }));
const card = (n: keyof typeof fixtures) => cards.find((c) => c.name === n)!;

describe("Soul Warden as the seed", () => {
  const ranked = similarIndex(cards).similarTo(card("Soul Warden").id);
  const of = (n: keyof typeof fixtures) => ranked.find((r) => r.name === n);

  test("the full ranking, tier and chips", () => {
    expect(ranked.map((r) => [r.tier, r.name, r.chips])).toEqual([
      ["same", "Essence Warden", []],
      ["same", "Soul's Attendant", []],
      ["close", "Auriok Champion", [{ dim: "extra", label: "+ protection" }]],
      ["close", "Impassioned Orator", [{ dim: "trigger", label: "your creatures" }]],
      ["close", "Ajani's Welcome", [{ dim: "trigger", label: "your creatures" }, { dim: "type", label: "enchantment" }]],
      ["close", "Suture Priest", [{ dim: "trigger", label: "your creatures" }, { dim: "extra", label: "+ opponent life loss" }]],
      ["output", "Blood Artist", [{ dim: "trigger", label: "when a creature dies" }, { dim: "extra", label: "+ life loss" }]],
      ["output", "Zulaport Cutthroat", [{ dim: "trigger", label: "when a creature you control dies" }, { dim: "extra", label: "+ opponent life loss" }]],
    ]);
  });

  test("grouped same -> close -> output, never the seed itself", () => {
    const tiers = ranked.map((r) => r.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => ["same", "close", "output"].indexOf(a) - ["same", "close", "output"].indexOf(b)));
    expect(of("Soul Warden")).toBeUndefined();
  });

  test("limit is honoured and the order is deterministic", () => {
    const idx = similarIndex(cards);
    expect(idx.similarTo(card("Soul Warden").id, { limit: 2 }).map((r) => r.name)).toEqual(ranked.slice(0, 2).map((r) => r.name));
    expect(idx.similarTo(card("Soul Warden").id, { limit: 0 })).toEqual([]);
  });

  test("identityWithin keeps only cards whose colour identity fits", () => {
    const white = similarIndex(cards).similarTo(card("Soul Warden").id, { identityWithin: ["W"] });
    expect(white.some((r) => r.name === "Essence Warden")).toBe(false); // green
    expect(white.some((r) => r.name === "Soul's Attendant")).toBe(true);
  });
});

describe("the card's tier is the worst of its abilities, not the luckiest pair", () => {
  test("Zulaport Cutthroat against Blood Artist is close: yours only versus any creature", () => {
    const r = compareCards(card("Zulaport Cutthroat"), card("Blood Artist"))!;
    expect(r.tier).toBe("close");
    expect(r.chips).toContainEqual({ dim: "trigger", label: "any creature" });
  });
  test("Blood Artist against Zulaport says so the other way", () => {
    const r = compareCards(card("Blood Artist"), card("Zulaport Cutthroat"))!;
    expect(r.tier).toBe("close");
    expect(r.chips).toContainEqual({ dim: "trigger", label: "your creatures" });
  });
  test("an opponent versus any target is a recipient chip, and not the same job", () => {
    const r = compareCards(card("Zulaport Cutthroat"), card("Blood Artist"))!;
    expect(r.chips).toContainEqual({ dim: "recipient", label: "any player or target" });
  });
});

describe("who receives it is part of the output", () => {
  test("damage to you is not damage to a target (Ancient Tomb against Lightning Bolt)", () => {
    expect(compareCards(card("Ancient Tomb"), card("Lightning Bolt"))).toBeNull();
    expect(compareCards(card("Lightning Bolt"), card("Ancient Tomb"))).toBeNull();
  });
  test("you losing life is not an opponent losing life (Phyrexian Arena against Zulaport)", () => {
    const r = compareCards(card("Phyrexian Arena"), card("Zulaport Cutthroat"));
    expect(r).toBeNull();
  });
});

describe("the output is the gate", () => {
  test("an ability with identical trigger and a different output is not similar", () => {
    const warden = card("Soul Warden");
    // Soul Warden's trigger, but it loses an opponent life instead: same trigger verbs and subject, different output.
    const tags = structuredClone(warden.tags!) as CardTags;
    tags.abilities[0]!.emits = [{ verb: "lose-life", subject: { control: "opp", token: null } }];
    const loser: SimilarCard = { id: 99, name: "Hypothetical Drainer", tags };
    expect(compareCards(warden, loser)).toBeNull();
  });

  test("a real card with emits and a similar trigger but a different output (Cathars' Crusade: counters)", () => {
    expect(compareCards(card("Soul Warden"), card("Cathars' Crusade"))).toBeNull();
    expect(compareCards(card("Soul Warden"), card("Lightning Bolt"))).toBeNull();
  });

  test("signatures hold one entry per ability that has emits", () => {
    expect(signatureOf(card("Soul Warden"))).toHaveLength(1);
    expect(signatureOf(card("Sol Ring"))).toHaveLength(0);
  });
});

describe("amount and repeats", () => {
  const warden = card("Soul Warden");
  const withAbility = (patch: Record<string, unknown>): SimilarCard => {
    const tags = structuredClone(warden.tags!) as CardTags;
    Object.assign(tags.abilities[0]!, patch);
    return { id: 98, name: "Variant", tags };
  };
  test("a numerically closer amount ranks first, and fixed to variable is farther than any numeric step", () => {
    const two = compareCards(warden, withAbility({ amount: "2" }))!;
    const four = compareCards(warden, withAbility({ amount: "4" }))!;
    const x = compareCards(warden, withAbility({ amount: "X" }))!;
    expect(two.chips).toContainEqual({ dim: "amount", label: "2 life" });
    expect(x.chips).toContainEqual({ dim: "amount", label: "X" });
    expect(two.score).toBeLessThan(four.score);
    expect(four.score).toBeLessThan(x.score);
  });
  test("repeats distance is the steps on the ladder", () => {
    const perTurn = compareCards(warden, withAbility({ repeats: "per-turn" }))!;
    const once = compareCards(warden, withAbility({ repeats: "once" }))!;
    expect(perTurn.tier).toBe("close");
    expect(perTurn.chips.map((c) => c.dim)).toEqual(["repeats"]);
    expect(perTurn.score).toBeLessThan(once.score);
  });
});

describe("scope, token recipient and chip wording", () => {
  test("a token made for an opponent is not a token made for you (Forbidden Orchard against Clarion Spirit)", () => {
    expect(compareCards(card("Clarion Spirit"), card("Forbidden Orchard"))).toBeNull();
    expect(compareCards(card("Forbidden Orchard"), card("Clarion Spirit"))).toBeNull();
  });

  test("spot removal and a sweeper are different jobs (Doom Blade against Wrath of God)", () => {
    const r = compareCards(card("Doom Blade"), card("Wrath of God"))!;
    expect(r.tier).toBe("output");
    expect(r.chips).toContainEqual({ dim: "scope", label: "each creature" });
    expect(compareCards(card("Wrath of God"), card("Doom Blade"))!.chips).toContainEqual({ dim: "scope", label: "one target" });
  });

  test("Swords to Plowshares and Path to Exile stay close, and the extras read as nouns", () => {
    const r = compareCards(card("Swords to Plowshares"), card("Path to Exile"))!;
    expect(r.tier).toBe("close");
    expect(r.chips.filter((c) => c.dim !== "type").map((c) => c.label).sort()).toEqual(["+ library search", "+ shuffling", "no life gain"]);
  });
});

describe("limit keeps the best and evicts the worst", () => {
  test("limit 3 over a longer list is the first three of the full ranking", () => {
    const warden = card("Soul Warden");
    const clones: SimilarCard[] = Array.from({ length: 9 }, (_, i) => {
      const tags = structuredClone(warden.tags!) as CardTags;
      tags.abilities[0]!.amount = String(i + 2);
      return { id: 1000 + i, name: `Clone ${9 - i}`, tags };
    });
    const idx = similarIndex([...cards, ...clones]);
    const all = idx.similarTo(warden.id, { limit: 100 });
    expect(all.length).toBeGreaterThanOrEqual(8);
    const top = idx.similarTo(warden.id, { limit: 3 });
    expect(top).toEqual(all.slice(0, 3));
    for (const dropped of all.slice(3)) expect(dropped.score).toBeGreaterThanOrEqual(top[2]!.score);
  });
});
