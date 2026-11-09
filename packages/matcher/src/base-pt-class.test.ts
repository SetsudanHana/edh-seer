import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons, pairReasonsAcrossFaces } from "./index.js";
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

test("a set over creatures with a +1/+1 counter pairs with the counter placers through the counter-presence pass: Sigarda's Summons x Cathars' Crusade, Walking Ballista (#1572 review; Hardened Scales only modifies a placement and supplies no counter)", () => {
  for (const c of ["Cathars' Crusade", "Walking Ballista"]) {
    const rs = pairReasons(dc("Sigarda's Summons"), dc(c), loadHierarchy()).filter((r) => r.effectKind === "base-pt-set" && r.producer === c && r.consumer === "Sigarda's Summons");
    expect(rs, c).not.toEqual([]);
    expect(rs.every((r) => r.tag.startsWith("counter-added:")), c).toBe(true);
  }
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

// ---- #1572, owner ruling 2026-11-09: the pair's STRENGTH falls as the creature's own power rises ----
import { analyzeDecklist } from "./orchestrate.js";
import { normalizeName } from "@edh-seer/data/names";
import { baseSetStrength } from "./base-pt-set.js";
import { SEED_IMPACT_WEIGHTS, impactEdgeWeight, impactWeightOf, loadImpactWeights } from "@edh-seer/engine";
import type { CardLookup } from "@edh-seer/data/resolve";

const strengthOf = (p: string, c: string): number | undefined => base(p, c)[0]?.strength;
/** A token maker that is `dc("Master of the Hunt")` with its token's stats rewritten to `p`/`t`. */
const makerOf = (name: string, p: number, t: number): DeckCard => {
  const m = dc("Master of the Hunt");
  const tags = JSON.parse(JSON.stringify(m.tags)) as CardTags;
  // not a creature itself, so only the token side of the pair is read
  tags.characteristics.power = null; tags.characteristics.toughness = null; tags.characteristics.types = ["enchantment"];
  for (const a of tags.abilities) for (const e of a.emits ?? []) for (const s of e.subject.stats ?? []) {
    if (s.metric === "power") s.value = p;
    if (s.metric === "toughness") s.value = t;
  }
  return { card: { ...(m.card as object), name } as DeckCard["card"], tags };
};

test("the curve: max(0.15, (set power - power) / set power), 6/6: 1/1 0.83, 3/3 0.5, 5/5 0.17", () => {
  expect([1, 3, 5, 6, 9].map((p) => baseSetStrength(6, p))).toEqual([0.833, 0.5, 0.167, 0.15, 0.15]);
});

test("March x a 1/1 creature has a higher strength and edge weight than March x a 5/5", () => {
  const small = strengthOf("March of the World Ooze", "Llanowar Elves"), big = strengthOf("March of the World Ooze", "Spearbreaker Behemoth");
  expect(small).toBe(0.833);
  expect(big).toBe(0.167);
  expect(strengthOf("March of the World Ooze", "Grizzly Bears")).toBe(0.667);
  const w = loadImpactWeights();
  const weight = (c: string) => impactEdgeWeight(base("March of the World Ooze", c), w);
  expect(weight("Llanowar Elves")).toBeGreaterThan(weight("Spearbreaker Behemoth"));
  expect(weight("Llanowar Elves")).toBeCloseTo(0.833, 3);
  const priors = { ...SEED_IMPACT_WEIGHTS, edgeModel: "priors" as const };
  expect(impactWeightOf(base("March of the World Ooze", "Llanowar Elves")[0]!, priors)).toBeGreaterThan(impactWeightOf(base("March of the World Ooze", "Spearbreaker Behemoth")[0]!, priors));
});

test("token makers use the curve at the token's power: Master of the Hunt (1/1) beats a 4/4 maker; toughness-only shortfall takes the floor; a power reader stays at 1", () => {
  const march = dc("March of the World Ooze");
  const of = (c: DeckCard) => pairReasons(march, c, loadHierarchy()).filter((r) => r.tag === "static:base-pt-set")[0]?.strength;
  expect(of(dc("Master of the Hunt"))).toBe(0.833);
  expect(of(makerOf("Four-Four Maker", 4, 4))).toBe(0.333);
  expect(of(makerOf("Six-Two Maker", 6, 2))).toBe(0.15);
  expect(of(dc("Master of the Hunt"))!).toBeGreaterThan(of(makerOf("Four-Four Maker", 4, 4))!);
  // a power reader carries no strength at all
  const reader = base("March of the World Ooze", "Molten Monstrosity");
  expect(reader).not.toEqual([]);
  expect(reader[0]!.strength).toBeUndefined();
});

test("through analyzeDecklist, March's contribution to a 1/1 is larger than to a 5/5", async () => {
  const byName = new Map(Object.entries(F).map(([n, f]) => [normalizeName(n), { ...f.source, searchNames: [normalizeName(n)], tags: { produces: [], cares: [] } }]));
  const tagsById = new Map(Object.keys(F).map((n) => [F[n]!.source._id, dc(n).tags]));
  const lookup: CardLookup = { async findByName(n: string) { return (byName.get(n) ?? null) as never; }, async allCombos() { return []; } };
  const sources = { lookup, tagsLookup: { findOne: async (id: string) => tagsById.get(id) ?? null }, tokenTags: () => null, tokenArt: async () => new Map<string, string>() } as never;
  const { report } = await analyzeDecklist(["March of the World Ooze", "Llanowar Elves", "Spearbreaker Behemoth"].map((n) => `1 ${n}`).join("\n"), undefined, async () => sources);
  const card = (n: string) => report.cards.find((c) => c.name === n)!;
  const pair = (c: string) => report.edges.find((e) => (e.a === "March of the World Ooze" && e.b === c) || (e.b === "March of the World Ooze" && e.a === c));
  expect(pair("Llanowar Elves")).toBeDefined();
  expect(pair("Spearbreaker Behemoth")).toBeDefined();
  // each is fed by March alone, so the payoff authority (the square root of its support) is the pair's contribution
  expect(card("Llanowar Elves").authority!).toBeGreaterThan(card("Spearbreaker Behemoth").authority!);
});


// ---- #1572 review round: five corrections ----
const faced = (p: string, c: string) => pairReasonsAcrossFaces(dc(p), dc(c), loadHierarchy()).filter((r) => r.effectKind === "base-pt-set" && r.tag === "static:base-pt-set" && r.producer === p);

test("a power reader reads the BATTLEFIELD: a cast trigger on creature spells (Monstrous Vortex, Sarkhan's Unsealing, Gwenna), creature spells in the text (Spellbreaker Behemoth) and a blocker's power (Delney) are no reader", () => {
  for (const c of ["Monstrous Vortex", "Sarkhan's Unsealing", "Gwenna, Eyes of Gaea", "Spellbreaker Behemoth", "Delney, Streetwise Lookout"]) {
    const rs = base("March of the World Ooze", c);
    // a creature below the set power still pairs as one that is upgraded, on the curve, never as a reader at strength 1
    expect(rs.every((r) => r.strength !== undefined && !r.text.endsWith("reads the power of your creatures")), c).toBe(true);
  }
  expect(base("March of the World Ooze", "Monstrous Vortex")).toEqual([]);
  expect(base("March of the World Ooze", "Sarkhan's Unsealing")).toEqual([]);
  expect(base("March of the World Ooze", "Spellbreaker Behemoth")[0]?.strength).toBe(0.167);
});

test("a reader is intersected with the set's class: Dreadhorde Invasion's Zombie token pairs with March (your creatures) and not with Raised by Giants (your commander)", () => {
  expect(base("March of the World Ooze", "Dreadhorde Invasion")).not.toEqual([]);
  expect(base("Raised by Giants", "Dreadhorde Invasion")).toEqual([]);
});


test("a set that turns your own creature tokens into vanilla tokens is an upgrade, not removal: Poppet Factory x Hordeling Outburst", () => {
  expect(faced("Poppet Stitcher // Poppet Factory", "Hordeling Outburst")).not.toEqual([]);
});

test("a creature whose power is printed on a face pairs: March x Delver of Secrets (a transform card), at the curve for its front face", () => {
  const rs = faced("March of the World Ooze", "Delver of Secrets // Insectile Aberration");
  expect(rs.some((r) => r.strength === 0.833 || r.strength === 0.5), JSON.stringify(rs)).toBe(true);
});

test("a toughness-only shortfall counts only when the token's power is not above the set power: Graaz x Elemental Appeal (7/1) and Kudo x Rebellion of the Flamekin (3/1) lose power; Harmonious Archon x Feral Lightning still pairs", () => {
  expect(base("Graaz, Unstoppable Juggernaut", "Elemental Appeal")).toEqual([]);
  expect(base("Kudo, King Among Bears", "Rebellion of the Flamekin")).toEqual([]);
  expect(base("Harmonious Archon", "Feral Lightning")).not.toEqual([]);
});
