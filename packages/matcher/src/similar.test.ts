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
      ["output", "Apothecary Initiate", [{ dim: "trigger", label: "when a white spell is cast" }]],
      ["output", "Auspicious Ancestor", [{ dim: "trigger", label: "when a white spell is cast" }]],
      ["output", "Dune Diviner", [{ dim: "trigger", label: "an activated ability" }]],
      ["output", "Angel's Feather", [{ dim: "trigger", label: "when a white spell is cast" }, { dim: "type", label: "artifact" }]],
      ["output", "Demon's Horn", [{ dim: "trigger", label: "when a black spell is cast" }, { dim: "type", label: "artifact" }]],
      ["output", "Dragon's Claw", [{ dim: "trigger", label: "when a red spell is cast" }, { dim: "type", label: "artifact" }]],
      ["output", "Kraken's Eye", [{ dim: "trigger", label: "when a blue spell is cast" }, { dim: "type", label: "artifact" }]],
      ["output", "Wurm's Tooth", [{ dim: "trigger", label: "when a green spell is cast" }, { dim: "type", label: "artifact" }]],
      ["output", "Bontu's Monument", [{ dim: "trigger", label: "when you cast a creature spell" }, { dim: "type", label: "artifact" }, { dim: "extra", label: "+ 2 other effects" }]],
      ["output", "Soldier of the Pantheon", [{ dim: "trigger", label: "when an opponent casts a multicoloured spell" }, { dim: "extra", label: "+ protection" }]],
      ["output", "Sythis, Harvest's Hand", [{ dim: "trigger", label: "when you cast an enchantment spell" }, { dim: "type", label: "enchantment" }, { dim: "extra", label: "+ card draw" }]],
      ["output", "Professor Onyx", [{ dim: "trigger", label: "when you cast an instant or sorcery spell" }, { dim: "amount", label: "2 life" }, { dim: "type", label: "planeswalker" }, { dim: "extra", label: "+ 6 other effects" }]],
    ]);
  });

  test("output tier is ordered by trigger distance, not by name (#1341)", () => {
    const out = ranked.filter((r) => r.tier === "output").map((r) => r.name);
    const at = (n: string) => out.indexOf(n);
    // a creature dying is nearer "another creature enters" than any cast trigger, and an activated ability is the farthest.
    for (const near of ["Blood Artist", "Zulaport Cutthroat"]) {
      for (const far of ["Apothecary Initiate", "Auspicious Ancestor", "Soldier of the Pantheon"]) expect(at(near)).toBeLessThan(at(far));
    }
    expect(at("Dune Diviner")).toBeGreaterThan(at("Apothecary Initiate"));
    expect(at("Dune Diviner")).toBeGreaterThan(at("Auspicious Ancestor"));
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
    expect(r.chips.filter((c) => c.dim !== "type").map((c) => c.label).sort()).toEqual(["+ library search", "no life gain"]);
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

describe("per-tier caps (#1341)", () => {
  test("a tier is capped on its own, so a full close tier cannot crowd out output", () => {
    const idx = similarIndex(cards);
    const id = card("Soul Warden").id;
    const r = idx.similarTo(id, { perTier: { same: 1, close: 1, output: 4 } });
    expect(r.map((x) => [x.tier, x.name])).toEqual([
      ["same", "Essence Warden"], ["close", "Auriok Champion"], ["output", "Blood Artist"], ["output", "Zulaport Cutthroat"],
      ["output", "Apothecary Initiate"], ["output", "Auspicious Ancestor"],
    ]);
    expect(idx.similarTo(id, { perTier: { output: 1 } }).map((x) => x.name)).toEqual(["Blood Artist"]);
    expect(idx.similarTo(id, { perTier: {} })).toEqual([]);
  });
});

describe("extra and missing chips are capped at one per row", () => {
  test("several missing outputs collapse to a count; one stays named", () => {
    const warden = card("Soul Warden");
    const rich = structuredClone(warden.tags!) as CardTags;
    rich.abilities.push(
      { ...structuredClone(rich.abilities[0]!), emits: [{ verb: "draw", subject: { control: "you", token: null } }] },
      { ...structuredClone(rich.abilities[0]!), emits: [{ verb: "lose-life", subject: { control: "opp", token: null } }] },
    );
    const seed: SimilarCard = { id: 500, name: "Rich", tags: rich };
    const lacks = compareCards(seed, warden)!.chips.filter((c) => c.dim === "missing");
    expect(lacks).toEqual([{ dim: "missing", label: "lacks 2 other effects" }]);
    const has = compareCards(warden, seed)!.chips.filter((c) => c.dim === "extra");
    expect(has).toEqual([{ dim: "extra", label: "+ 2 other effects" }]);
  });
});

describe("type chip names card types only (#1341)", () => {
  const withTypes = (id: number, name: string, types: string[]): SimilarCard => {
    const tags = structuredClone(card("Soul Warden").tags!) as CardTags;
    tags.characteristics.types = types;
    return { id, name, tags };
  };
  const typeChips = (seed: string[], cand: string[]) =>
    compareCards(withTypes(901, "Seed", seed), withTypes(902, "Cand", cand))!.chips.filter((c) => c.dim === "type");

  test("supertypes are neither a difference nor a label", () => {
    expect(typeChips(["creature"], ["legendary", "creature"])).toEqual([]);
    expect(typeChips(["legendary", "creature"], ["creature"])).toEqual([]);
    expect(typeChips(["creature"], ["legendary", "enchantment"])).toEqual([{ dim: "type", label: "enchantment" }]);
    expect(typeChips(["creature"], ["legendary", "enchantment", "creature"])).toEqual([{ dim: "type", label: "enchantment" }]);
  });
  test("a candidate that lacks a seed type says so", () => {
    expect(typeChips(["enchantment", "creature"], ["creature"])).toEqual([{ dim: "type", label: "not an enchantment" }]);
    expect(typeChips(["legendary", "artifact", "creature"], ["creature"])).toEqual([{ dim: "type", label: "not an artifact" }]);
  });
});

describe("a chip on every row is dropped (#1341)", () => {
  const warden = card("Soul Warden");
  const rich = structuredClone(warden.tags!) as CardTags;
  rich.abilities.push(
    { ...structuredClone(rich.abilities[0]!), emits: [{ verb: "draw", subject: { control: "you", token: null } }] },
    { ...structuredClone(rich.abilities[0]!), emits: [{ verb: "lose-life", subject: { control: "opp", token: null } }] },
  );
  const variant = (id: number, name: string, edit: (t: CardTags) => void): SimilarCard => {
    const tags = structuredClone(warden.tags!) as CardTags;
    edit(tags);
    return { id, name, tags };
  };
  const seed: SimilarCard = { id: 500, name: "Rich", tags: rich };
  const rows = [
    variant(501, "A plain", () => {}),
    variant(502, "B bigger", (t) => { t.abilities[0]!.amount = "2"; }),
    variant(503, "C yours", (t) => { t.abilities[0]!.trigger!.subject.control = "you"; }),
  ];

  test("with three rows, the chip all share goes and the distinguishing ones stay", () => {
    expect(compareCards(seed, rows[0]!)!.chips).toEqual([{ dim: "missing", label: "lacks 2 other effects" }]);
    const r = similarIndex([seed, ...rows]).similarTo(500);
    expect(r).toHaveLength(3);
    for (const h of r) expect(h.chips.some((c) => c.label === "lacks 2 other effects")).toBe(false);
    expect(r.find((h) => h.name === "B bigger")!.chips).toEqual([{ dim: "amount", label: "2 life" }]);
    expect(r.find((h) => h.name === "C yours")!.chips).toEqual([{ dim: "trigger", label: "your creatures" }]);
  });
  test("with fewer than three rows nothing is dropped", () => {
    const r = similarIndex([seed, rows[0]!, rows[1]!]).similarTo(500);
    expect(r).toHaveLength(2);
    for (const h of r) expect(h.chips.some((c) => c.label === "lacks 2 other effects")).toBe(true);
  });
  test("a trigger or type chip all rows share is the list's whole difference and stays", () => {
    const enchantments = [601, 602, 603].map((id) => variant(id, `Enchant ${id}`, (t) => { t.characteristics.types = ["enchantment"]; }));
    const r = similarIndex([warden, ...enchantments]).similarTo(warden.id);
    expect(r).toHaveLength(3);
    for (const h of r) expect(h.chips).toEqual([{ dim: "type", label: "enchantment" }]);
  });
});

describe("player-event triggers read as the player's event (#1341)", () => {
  const warden = card("Soul Warden");
  const label = (verb: string, control: "you" | "opp" | "any"): string | undefined => {
    const tags = structuredClone(warden.tags!) as CardTags;
    tags.abilities[0]!.trigger = { verbs: [verb as never], subject: { control, token: null } };
    return compareCards(warden, { id: 950, name: "V", tags })!.chips.find((c) => c.dim === "trigger")?.label;
  };
  test("draw, scry, gain life and cast name the player", () => {
    expect(label("draw", "you")).toBe("when you draw a card");
    expect(label("draw", "opp")).toBe("when an opponent draws a card");
    expect(label("draw", "any")).toBe("when a player draws a card");
    expect(label("discard", "you")).toBe("when you discard a card");
    expect(label("scry", "you")).toBe("when you scry");
    expect(label("surveil", "you")).toBe("when you surveil");
    expect(label("lose-life", "opp")).toBe("when an opponent loses life");
  });
  test("phase triggers are the beginning of a step, not a permanent reaching one", () => {
    expect(label("upkeep", "you")).toBe("at the beginning of your upkeep");
    expect(label("upkeep", "any")).toBe("at the beginning of each upkeep");
    expect(label("end-step", "you")).toBe("at the beginning of your end step");
    expect(label("begin-combat", "you")).toBe("at the beginning of combat on your turn");
  });
});

describe("ability words are not keywords (#1341, CR 207.2c)", () => {
  test("Witty Roastmaster (Alliance) against Impact Tremors has no keyword chip either way", () => {
    for (const [a, b] of [["Impact Tremors", "Witty Roastmaster"], ["Witty Roastmaster", "Impact Tremors"]] as const) {
      const chips = compareCards(card(a), card(b))!.chips;
      expect(chips.filter((c) => c.dim === "extra" || c.dim === "missing")).toEqual([]);
    }
  });
});

describe("self-subject outputs never open the gate (#1341 review)", () => {
  const of = (seed: keyof typeof fixtures) => similarIndex(cards).similarTo(card(seed).id, { limit: 99 });
  test("Sakura-Tribe Elder is not similar to sacrifice outlets that merely sacrifice themselves", () => {
    const names = of("Sakura-Tribe Elder").map((r) => r.name);
    expect(names).toContain("Evolving Wilds");
    for (const n of ["Cephalid Pathmage", "Boggart Forager", "Accursed Centaur"]) expect(names).not.toContain(n);
  });
  test("returning this Aura to hand is no shared output: Shackles and Agoraphobia get no list", () => {
    expect(of("Shackles")).toEqual([]);
    expect(of("Agoraphobia")).toEqual([]);
    expect(compareCards(card("Shackles"), card("Agoraphobia"))).toBeNull();
  });
  test("Ghost Quarter's destroy-target-land is not Evolving Wilds' sacrifice-itself", () => {
    const r = compareCards(card("Ghost Quarter"), card("Evolving Wilds"));
    expect(r?.tier).not.toBe("same");
    expect(compareCards(card("Evolving Wilds"), card("Ghost Quarter"))?.tier).not.toBe("same");
  });
  test("an edict is not a drawback: Accursed Centaur sacrifices your own creature", () => {
    expect(of("Diabolic Edict").map((r) => r.name)).not.toContain("Accursed Centaur");
  });
});

describe("trigger colour is part of the trigger (#1341 review)", () => {
  const rows = similarIndex(cards).similarTo(card("Angel's Feather").id, { limit: 99 });
  test("a black, red, blue or green spell trigger is close, not same, and names its colour", () => {
    const by = (n: string) => rows.find((r) => r.name === n)!;
    expect([by("Demon's Horn").tier, by("Dragon's Claw").tier, by("Kraken's Eye").tier, by("Wurm's Tooth").tier]).toEqual(["close", "close", "close", "close"]);
    expect(by("Demon's Horn").chips).toEqual([{ dim: "trigger", label: "any black spell" }]);
    expect(by("Wurm's Tooth").chips).toEqual([{ dim: "trigger", label: "any green spell" }]);
  });
  test("a cast trigger label names the colour", () => {
    const o = similarIndex(cards).similarTo(card("Soul Warden").id, { limit: 99 });
    expect(o.find((r) => r.name === "Apothecary Initiate")!.chips).toEqual([{ dim: "trigger", label: "when a white spell is cast" }]);
    expect(o.find((r) => r.name === "Soldier of the Pantheon")!.chips[0]).toEqual({ dim: "trigger", label: "when an opponent casts a multicoloured spell" });
  });
});

describe("self verbs that are effects still gate, against other self outputs only (#1341 review 3)", () => {
  const of = (seed: keyof typeof fixtures) => similarIndex(cards).similarTo(card(seed).id, { limit: 99 });
  test("Ajani's Pridemate: the same +1/+1 counter on itself is the same job as Bloodbond Vampire", () => {
    const r = of("Ajani's Pridemate").find((x) => x.name === "Bloodbond Vampire");
    expect(r?.tier).toBe("same");
  });
});

describe("cast labels keep the spell's type (#1341 review)", () => {
  const chips = (seed: keyof typeof fixtures, cand: keyof typeof fixtures) => compareCards(card(seed), card(cand))!.chips.filter((c) => c.dim === "trigger");
  test("a creature, enchantment, or instant-or-sorcery spell is named as such", () => {
    expect(chips("Soul Warden", "Bontu's Monument")).toEqual([{ dim: "trigger", label: "when you cast a creature spell" }]);
    expect(chips("Soul Warden", "Sythis, Harvest's Hand")).toEqual([{ dim: "trigger", label: "when you cast an enchantment spell" }]);
  });
});

describe("whose creature leaves, whose permanent changes hands (#1341 review)", () => {
  const names = (seed: keyof typeof fixtures) => similarIndex(cards).similarTo(card(seed).id, { limit: 99 }).map((r) => r.name);
  test("returning your own creature is not bounce removal", () => {
    expect(names("Whitemane Lion")).not.toContain("Man-o'-War");
    expect(names("Man-o'-War")).not.toContain("Whitemane Lion");
  });
  test("Cloudshift is not Blade Banish or Swords to Plowshares", () => {
    expect(names("Cloudshift")).not.toContain("Blade Banish");
    expect(names("Cloudshift")).not.toContain("Swords to Plowshares");
  });
  test("stealing and donating are different outputs", () => {
    expect(compareCards(card("Threaten"), card("Donate"))).toBeNull();
  });
});

describe("shuffle is a by-product (#1341 review)", () => {
  test("Sakura-Tribe Elder is not Lantern of Insight, and Myr Mindservant is not Assembly Hall", () => {
    expect(compareCards(card("Sakura-Tribe Elder"), card("Lantern of Insight"))).toBeNull();
    expect(compareCards(card("Myr Mindservant"), card("Assembly Hall"))).toBeNull();
  });
  test("Ghost Quarter against Evolving Wilds is not joined by the shuffle", () => {
    const r = compareCards(card("Ghost Quarter"), card("Evolving Wilds"));
    expect(r === null || r.tier !== "close").toBe(true);
  });
});

describe("a search for the card's own name is its own output (#1341 review)", () => {
  test("Squadron Hawk is not a generic tutor like Rune-Scarred Demon", () => {
    expect(compareCards(card("Squadron Hawk"), card("Rune-Scarred Demon"))).toBeNull();
    expect(compareCards(card("Rune-Scarred Demon"), card("Squadron Hawk"))).toBeNull();
  });
});

describe("an emit-less ability is a visible effect, never a gate (#1341 final review)", () => {
  test("a cantrip's main effect separates it: Befuddle, Stun, Accelerate and Balduvian Rage are not the same", () => {
    for (const [a, b] of [["Befuddle", "Balduvian Rage"], ["Stun", "Accelerate"], ["Rakdos Cluestone", "Basilica Skullbomb"]] as const) {
      const r = compareCards(card(a), card(b))!;
      expect(r.tier, a + " vs " + b).not.toBe("same");
      expect(r.chips.some((c) => c.dim === "extra" || c.dim === "missing"), a + " vs " + b).toBe(true);
    }
    expect(compareCards(card("Befuddle"), card("Balduvian Rage"))!.chips.map((c) => c.label)).toEqual(["+ pump", "no debuff"]);
  });
  test("the shared draw still joins them, one step out, with the effect named", () => {
    const r = compareCards(card("Stun"), card("Accelerate"))!;
    expect(r.tier).toBe("close");
    expect(r.chips.map((c) => c.label)).toEqual(["+ speed boost", "no restriction"]);
  });
});

describe("counter kind is part of the output (#1341 final review)", () => {
  test("+1/+1 and stun counters are different outputs", () => {
    expect(compareCards(card("Ent-Draught Basin"), card("Magnetic Web"))?.tier).not.toBe("same");
    expect(compareCards(card("Spontaneous Flight"), card("Puncture Bolt"))?.tier).not.toBe("close");
  });
});

describe("a cost the player pays never opens the gate (#1341 final review)", () => {
  const names = (seed: keyof typeof fixtures) => similarIndex(cards).similarTo(card(seed).id, { limit: 99 }).filter((r) => r.tier !== "output").map((r) => r.name);
  test("an additional cost to cast is not the spell's effect", () => {
    expect(names("Mind Extraction")).not.toContain("Bone Splinters");
    expect(names("Bone Splinters")).not.toContain("Village Rites");
  });
  test("discarding to activate is not the ability's effect", () => {
    expect(names("Viashino Lashclaw")).not.toContain("Firefright Mage");
  });
});

describe("outcome tier: damage and life loss are one job in a deck (#1342)", () => {
  const drain = { drainIsDamage: true };
  test("without the option, damage and life loss never match", () => {
    expect(compareCards(card("Impact Tremors"), card("Corpse Knight"))).toBeNull();
    expect(compareCards(card("Corpse Knight"), card("Impact Tremors"))).toBeNull();
  });
  test("with the option, both directions are `outcome` and the chip names the swap", () => {
    const fwd = compareCards(card("Impact Tremors"), card("Corpse Knight"), drain);
    expect(fwd?.tier).toBe("outcome");
    expect(fwd?.chips).toContainEqual({ dim: "outcome", label: "life loss, not damage" });
    const back = compareCards(card("Corpse Knight"), card("Impact Tremors"), drain);
    expect(back?.tier).toBe("outcome");
    expect(back?.chips).toContainEqual({ dim: "outcome", label: "damage, not life loss" });
  });
  test("the option changes nothing when the plain comparison already matches", () => {
    const plain = compareCards(card("Impact Tremors"), card("Witty Roastmaster"));
    expect(plain?.tier).toBe("close");
    expect(compareCards(card("Impact Tremors"), card("Witty Roastmaster"), drain)).toEqual(plain);
  });
  test("you losing life is a drawback, not a drain: it never matches by the swap", () => {
    expect(compareCards(card("Impact Tremors"), card("Phyrexian Arena"), drain)).toBeNull();
    expect(compareCards(card("Corpse Knight"), card("Phyrexian Arena"), drain)).toBeNull();
  });
  test("an amount chip names the CANDIDATE's own unit, not the seed's", () => {
    const amount = (x: keyof typeof fixtures, y: keyof typeof fixtures) => compareCards(card(x), card(y), drain)?.chips.filter((c) => c.dim === "amount");
    expect(amount("Corpse Knight", "Lightning Bolt")).toEqual([{ dim: "amount", label: "3 damage" }]);
    expect(amount("Lightning Bolt", "Corpse Knight")).toEqual([{ dim: "amount", label: "1 life" }]);
  });
  test("extra/missing nouns name the candidate's real output", () => {
    const labels = (x: keyof typeof fixtures, y: keyof typeof fixtures) => compareCards(card(x), card(y), drain)?.chips.map((c) => c.label) ?? [];
    for (const [x, y] of [["Corpse Knight", "Lightning Bolt"], ["Lightning Bolt", "Corpse Knight"], ["Impact Tremors", "Professor Onyx"]] as const) {
      const l = labels(x, y);
      const wrong = y === "Lightning Bolt" ? "life loss" : "damage";
      expect(l).not.toContain(`+ ${wrong}`);
    }
  });
  test("the page's index never emits `outcome`", () => {
    const all = cards.flatMap((c) => similarIndex(cards).similarTo(c.id, { limit: 99 }));
    expect(all.some((r) => r.tier === "outcome")).toBe(false);
  });
});
