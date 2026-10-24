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

  test("same job: Essence Warden and Soul's Attendant (a 'may' is no difference)", () => {
    expect(of("Essence Warden")).toMatchObject({ tier: "same", chips: [] });
    expect(of("Soul's Attendant")).toMatchObject({ tier: "same", chips: [] });
  });

  test("close: Ajani's Welcome (enchantment, your creatures only) and Impassioned Orator (your creatures only)", () => {
    const ajani = of("Ajani's Welcome")!;
    expect(ajani.tier).toBe("close");
    expect(ajani.chips).toEqual(expect.arrayContaining([{ dim: "type", label: "enchantment" }, { dim: "trigger", label: "your creatures only" }]));
    const orator = of("Impassioned Orator")!;
    expect(orator.tier).toBe("close");
    expect(orator.chips).toEqual([{ dim: "trigger", label: "your creatures only" }]);
  });

  test("close: Auriok Champion carries protection Soul Warden lacks", () => {
    const auriok = of("Auriok Champion")!;
    expect(auriok.tier).toBe("close");
    expect(auriok.chips).toEqual([{ dim: "extra", label: "+ protection" }]);
  });

  test("output tier: Blood Artist gains life when a creature dies, not when one enters", () => {
    const blood = of("Blood Artist")!;
    expect(blood.tier).toBe("output");
    expect(blood.chips.find((c) => c.dim === "trigger")?.label).toBe("when a creature dies");
  });

  test("a different output is absent however it is triggered or sized", () => {
    for (const n of ["Sol Ring", "Llanowar Elves", "Lightning Bolt"] as const) expect(of(n)).toBeUndefined();
  });

  test("grouped same -> close -> output, never the seed itself", () => {
    const order = ranked.map((r) => r.tier);
    expect(order).toEqual([...order].sort((a, b) => ["same", "close", "output"].indexOf(a) - ["same", "close", "output"].indexOf(b)));
    expect(ranked.some((r) => r.name === "Soul Warden")).toBe(false);
  });

  test("limit is honoured and the order is deterministic", () => {
    const idx = similarIndex(cards);
    expect(idx.similarTo(card("Soul Warden").id, { limit: 2 }).map((r) => r.name)).toEqual(ranked.slice(0, 2).map((r) => r.name));
  });

  test("identityWithin keeps only cards whose colour identity fits", () => {
    const white = similarIndex(cards).similarTo(card("Soul Warden").id, { identityWithin: ["W"] });
    expect(white.some((r) => r.name === "Essence Warden")).toBe(false); // green
    expect(white.some((r) => r.name === "Soul's Attendant")).toBe(true);
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
