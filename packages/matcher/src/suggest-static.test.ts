import { expect, test, vi } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckReport } from "@edh-seer/engine";
import { normalizeName } from "@edh-seer/data/names";
import { shardOf } from "./bin/build-static-core.js";
import { eventShardOf } from "./bin/events-index-core.js";
import { BUILD_CATEGORIES } from "./build.js";
import { POOL_CLASSES } from "./answer-pool.js";
import { suggestForDeck } from "./suggest-static.js";

const VERSION = "v-test";

/** THE DERIVED SHAPES `partners-core.test.ts` pins (read out of `cardTagsDerived` 2026-09-04):
 *  Krenko makes Goblin tokens that enter, Impact Tremors triggers on a creature entering. Real
 *  shapes, so `directedReasons` returns a real reason and the orchestrator's verification step is
 *  exercised rather than stubbed. */
const krenkoAbilities = [{
  kind: "activated", cost: "{T}",
  effect: { kind: "token-generation", subject: { control: "any", token: true, type: "creature", subtype: "goblin" } },
  emits: [
    { verb: "create-token", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } },
    { verb: "enters", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } },
  ],
}];
const tremorsAbilities = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
  effect: { kind: "deal-damage" },
}];

interface Spec { name: string; identity: string[]; types: string[]; abilities: unknown[] | null; tokenParts?: true; typeLine?: string; oracle?: string; r?: string[] }
const entry = (s: Spec, pi?: [number, number][]) => ({
  card: {
    _id: `id-${s.name}`, name: s.name, typeLine: s.typeLine ?? s.types.join(" "), oracleText: s.oracle ?? "", keywords: [], colors: s.identity,
    manaValue: 3, colorIdentity: s.identity, power: null, toughness: null, searchNames: [normalizeName(s.name)],
    ...(s.tokenParts ? { allParts: [{ component: "token", name: "Goblin", typeLine: "Token Creature — Goblin" }] } : {}),
  },
  tags: {
    oracleId: `id-${s.name}`, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: s.types, subtypes: [], colors: s.identity, identity: s.identity, cmc: 3, power: null, toughness: null, token: false, keywords: [] },
    abilities: s.abilities,
  } as unknown as CardTags,
  combos: [],
  ...(pi ? { pi } : {}),
});

// INDEX ORDER IS THE POSITION `pi` POINTS AT.
const TYPES = ["creature", "enchantment", "instant", "land", "artifact"];
const SPECS: Spec[] = [
  { name: "Impact Tremors", identity: ["R"], types: ["enchantment"], abilities: tremorsAbilities },   // 0
  { name: "Swords to Plowshares", identity: ["W"], types: ["instant"], abilities: [] },              // 1 off-colour
  { name: "Mountain", identity: [], types: ["land"], abilities: [] },                                 // 2 land
  { name: "Unrelated Rock", identity: [], types: ["artifact"], abilities: [] },                       // 3 no live reason
  { name: "Black Tremors", identity: ["B"], types: ["enchantment"], abilities: tremorsAbilities },   // 4 fixture: Tremors' shape in black
  { name: "Krenko, Mob Boss", identity: ["R"], types: ["creature"], abilities: krenkoAbilities },    // 5
  { name: "Goblin Maker", identity: ["R"], types: ["creature"], abilities: krenkoAbilities },        // 6 fixture: Krenko's shape
];
const indexRow = (s: Spec) => ({
  slug: s.name.toLowerCase().replace(/[^a-z]+/g, "-"), name: s.name, identity: s.identity, commander: false,
  t: s.types.map((t) => TYPES.indexOf(t)), mv: 3,
  ...(s.r ? { r: s.r.map((x) => BUILD_CATEGORIES.indexOf(x as (typeof BUILD_CATEGORIES)[number])) } : {}),
  ...(s.name === "Swords to Plowshares"
    ? { r: [BUILD_CATEGORIES.indexOf("targetedRemoval")], a: [POOL_CLASSES.indexOf("creature")] } : {}),
});

const PI: Record<string, [number, number][]> = {
  "Krenko, Mob Boss": [[0, 0.3], [1, 0.2], [2, 0.2], [3, 0.1], [4, 0.2]],
  "Goblin Maker": [[0, 0.2], [3, 0.1], [4, 0.1]],
};

function files(specs: Spec[] = SPECS): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const s of specs) {
    const key = normalizeName(s.name);
    const path = `/static/${VERSION}/cards/${shardOf(key)}.json`;
    out[path] = { ...(out[path] ?? {}), [key]: entry(s, PI[s.name]) };
  }
  return {
    "/static/manifest.json": { version: VERSION },
    [`/static/${VERSION}/name-index.json`]: { types: TYPES, subtypes: [], keywords: [], cards: specs.map(indexRow) },
    [`/static/${VERSION}/event-frequency.json`]: { supply: {}, consume: {}, byIdentity: {} },
    ...out,
  };
}
function fetchOf(f: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const body = f[String(url)];
    return body === undefined
      ? ({ ok: false, status: 404, json: async () => ({}) } as Response)
      : ({ ok: true, status: 200, json: async () => body } as Response);
  }) as unknown as typeof fetch;
}

const report = {
  cards: [
    { name: "Krenko, Mob Boss", isCommander: true },
    { name: "Goblin Maker", isCommander: false },
    { name: "Unknown Card", isCommander: false },   // no card shard at all (Review Focus 1)
  ],
  buildParents: [], cutList: [],
} as unknown as DeckReport;

test("plan cards come from the deck's partner lists, verified live, with the engine's own reason", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const s = await suggestForDeck({ report, commanderColorIdentity: ["B", "R"], baseUrl: "/static", fetchImpl: fetchOf(files()) });
  // Both Tremors have 2 connections; Impact Tremors scores 0.5, Black Tremors 0.3. The partner
  // pair's union identity (B+R) admits the black one (Review Focus 4).
  expect(s.plan.map((c) => c.name)).toEqual(["Impact Tremors", "Black Tremors"]);
  const tremors = s.plan[0]!;
  expect(tremors.connections).toEqual(["Krenko, Mob Boss", "Goblin Maker"]);
  expect(tremors.reasons[0]).toContain("Krenko, Mob Boss");
  expect(tremors.reasons[0]).toContain("Impact Tremors");
  warn.mockRestore();
});

test("lands, off-colour cards and pairs the live engine does not draw are nowhere", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const s = await suggestForDeck({ report, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(files()) });
  const everywhere = [...s.plan, ...Object.values(s.build).flat(), ...Object.values(s.answers).flat(),
    ...Object.values(s.synergy).flat(), ...s.pairs.map((p) => p.add)].map((c) => c.name);
  expect(everywhere).not.toContain("Mountain");
  expect(everywhere).not.toContain("Swords to Plowshares");
  expect(everywhere).not.toContain("Black Tremors");        // mono-red commander this time
  expect(everywhere).not.toContain("Unrelated Rock");       // in the pool, but no live reason: a stale pair
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

/** A TOKEN MAKER'S EDGE, AS A CARD PAGE DRAWS IT. The report routes Krenko -> Impact Tremors
 *  through a Goblin token NODE and drops the direct edge (`tokensMediate`); a suggestion has no
 *  token node, exactly like a card page, so verification must ask the way `partners-core` does or
 *  every token maker's partner reads as a stale pair. Found by the A-vs-B run (Ugin, the Ineffable;
 *  Eldrazi Confluence; Woodland Champion). */
test("a token maker's partner is verified the way a card page draws it, not dropped as stale", async () => {
  // GOBLIN MAKER AS AN ENCHANTMENT: a creature maker's own body entering would supply Tremors on its
  // own and hide the dropped token edge.
  const withTokens = SPECS.map((s) => (s.abilities !== krenkoAbilities ? s
    : { ...s, tokenParts: true as const, ...(s.name === "Goblin Maker" ? { types: ["enchantment"] } : {}) }));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const s = await suggestForDeck({ report, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(files(withTokens)) });
  const tremors = s.plan.find((c) => c.name === "Impact Tremors");
  expect(tremors?.connections).toContain("Goblin Maker");
  warn.mockRestore();
});

/** A DOUBLE-FACED CARD IS MATCHED FACE BY FACE, as the report does (`faceDeckCards`): the reason
 *  names the face that does the work, and the other face's abilities are not read as always live. */
test("a double-faced candidate is verified per face, and its reason names the face", async () => {
  const dfc: Spec = {
    name: "Tremor Front // Quiet Back", typeLine: "Enchantment // Enchantment", identity: ["R"], types: ["enchantment"],
    abilities: [{ ...tremorsAbilities[0]!, face: 0 }],
  };
  const specs = [...SPECS.slice(0, 7), dfc];   // position 7
  const pi = { "Krenko, Mob Boss": [[7, 0.3]], "Goblin Maker": [[7, 0.3]] } as Record<string, [number, number][]>;
  const withPi = (f: Record<string, unknown>) => {
    for (const [path, shard] of Object.entries(f)) {
      if (!path.includes("/cards/")) continue;
      for (const [k, e] of Object.entries(shard as Record<string, { card: { name: string }; pi?: unknown }>)) {
        if (pi[e.card.name]) (shard as Record<string, unknown>)[k] = { ...e, pi: pi[e.card.name] };
      }
    }
    return f;
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const s = await suggestForDeck({ report, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(withPi(files(specs))) });
  const card = s.plan.find((c) => c.name === "Tremor Front // Quiet Back");
  expect(card?.reasons[0]).toContain("Tremor Front");
  expect(card?.reasons[0]).not.toContain("//");
  warn.mockRestore();
});

/** ONE CARD WITH DATA THE ENGINE CANNOT READ drops out alone; it does not take every list with it. */
test("a candidate the engine throws on is dropped, and the rest still arrive", async () => {
  const broken = SPECS.map((s) => (s.name === "Unrelated Rock" ? { ...s, abilities: null } : s));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const s = await suggestForDeck({ report, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(files(broken)) });
  expect(s.plan.map((c) => c.name)).toContain("Impact Tremors");
  warn.mockRestore();
});

/** THE DECK'S AXIS ORDERS THE PLAN LIST (measured 2026-09-24: ranked by breadth alone, Prism Ring
 *  led the plan list of 47 of 71 decks). A payoff on the deck's own theme outranks a card the pool
 *  scores higher on a tag the deck is not built around. */
test("the plan list is ordered by the deck's strategy axis, not by pool score", async () => {
  const goblinPayoff: Spec = {
    name: "Goblin Payoff", identity: ["R"], types: ["enchantment"],
    abilities: [{ ...tremorsAbilities[0]!, trigger: { verbs: ["enters"], subject: { type: "creature", subtype: "goblin", control: "you", token: null } } }],
  };
  const specs = [...SPECS.slice(0, 7), goblinPayoff];   // position 7
  const withPayoff = (f: Record<string, unknown>) => {
    for (const [path, shard] of Object.entries(f)) {
      if (!path.includes("/cards/")) continue;
      for (const [k, e] of Object.entries(shard as Record<string, { card: { name: string }; pi?: [number, number][] }>)) {
        if (e.pi) (shard as Record<string, unknown>)[k] = { ...e, pi: [...e.pi, [7, 0.05]] };
      }
    }
    return f;
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const run = (axis: { tag: string; weight: number }[]) => suggestForDeck({
    report: { ...report, axis } as DeckReport, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(withPayoff(files(specs))),
  });
  expect((await run([])).plan.map((c) => c.name)).toEqual(["Impact Tremors", "Goblin Payoff"]);
  expect((await run([{ tag: "enters:goblin", weight: 1 }])).plan.map((c) => c.name)).toEqual(["Goblin Payoff", "Impact Tremors"]);
  warn.mockRestore();
});

/** A ROUTE IS A BRIDGE THE DECK LACKS (2026-09-25, the Ghyrson witness): three token makers and a
 *  commander that wants exactly 1 damage share no edge, and Impact Tremors joins them -- it asks for
 *  what the makers cause and causes what the commander asks. Neither card is in any `pi`; the
 *  shortlist comes from the event index. A 2-damage pinger of the same shape opens no route. */
function ghyrsonWitness() {
  const pinger = (amount: string) => [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "damage" }, amount,
    emits: [{ verb: "non-combat-damage", subject: { control: "opp", token: null, scope: "each" }, dealer: { control: "you", token: null } }],
  }];
  const specs: Spec[] = [
    { name: "Ghyrson Starn", identity: ["R"], types: ["creature"], abilities: [{
      kind: "triggered", effect: { kind: "damage" },
      trigger: { verbs: ["non-combat-damage"], subject: { control: "you", token: null }, amount: { op: "eq", value: 1 } },
    }] },                                                                                            // 0
    { name: "Maker One", identity: ["R"], types: ["creature"], abilities: krenkoAbilities },           // 1
    { name: "Maker Two", identity: ["R"], types: ["creature"], abilities: krenkoAbilities },           // 2
    { name: "Maker Three", identity: ["R"], types: ["creature"], abilities: krenkoAbilities },         // 3
    { name: "Impact Tremors", identity: ["R"], types: ["enchantment"], abilities: pinger("1") },      // 4
    { name: "Two Damage Pinger", identity: ["R"], types: ["enchantment"], abilities: pinger("2") },   // 5
  ];
  const ENTERS = "enters|creature|-|-";
  const DAMAGE = "non-combat-damage|-|-|-";
  const members: Record<string, unknown> = {
    [ENTERS]: { p: [1, 2, 3], c: [4, 5] },
    [DAMAGE]: { p: [4, 5], c: [0], pd: [[1], [2]] },
  };
  const f = files(specs);
  f[`/static/${VERSION}/event-frequency.json`] = { supply: { [ENTERS]: 3, [DAMAGE]: 2 }, consume: { [ENTERS]: 2, [DAMAGE]: 1 }, byIdentity: {} };
  for (const [k, m] of Object.entries(members)) {
    const path = `/static/${VERSION}/events/${eventShardOf(k)}.json`;
    f[path] = { ...(f[path] as Record<string, unknown> ?? {}), [k]: m };
  }
  const deck = {
    cards: specs.slice(0, 4).map((c, i) => ({ name: c.name, isCommander: i === 0 })),
    buildParents: [], cutList: [], edges: [], axis: [{ tag: "non-combat-damage:any", weight: 1 }],
  } as unknown as DeckReport;
  return { f, deck };
}
const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try { return await run(); } finally { warn.mockRestore(); }
};

test("a route names the bridge card, the deck card it reaches and the cards that reach it", async () => {
  const { f, deck } = ghyrsonWitness();
  const s = await quietly(() => suggestForDeck({ report: deck, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(f) }));
  expect(s.routes.map((c) => [c.name, c.route])).toEqual([
    ["Impact Tremors", { to: "Ghyrson Starn", from: ["Maker One", "Maker Two", "Maker Three"] }],
  ]);
});

/** ONE CARD, ONE PLACE, THREE TIERS (spec §3, amended 2026-09-25): finding > route > plan. A card a
 *  finding names is shown there and nowhere else; a route card leaves the plan list. */
test("a card a finding names is not listed again as a route", async () => {
  const { f, deck } = ghyrsonWitness();
  // Ghyrson waits on 1 damage and nothing in the deck causes it: the synergy finding's card IS the bridge.
  const withFinding = { ...deck, deckMath: { demand: [{ key: "non-combat-damage:any", available: 0, suppliers: 0, consumers: 1 }] } } as unknown as DeckReport;
  const s = await quietly(() => suggestForDeck({ report: withFinding, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(f) }));
  expect(s.synergy["non-combat-damage:any"]!.map((c) => c.name)).toEqual(["Impact Tremors"]);
  expect(s.routes.map((c) => c.name)).toEqual([]);
});

test("a route card is not listed again in the plan list", async () => {
  const { f, deck } = ghyrsonWitness();
  // Every maker's partner list names Impact Tremors (position 4), so it is a plan candidate as well.
  for (const [path, shard] of Object.entries(f)) {
    if (!path.includes("/cards/")) continue;
    for (const [k, e] of Object.entries(shard as Record<string, { card: { name: string } }>)) {
      if (e.card.name.startsWith("Maker")) (shard as Record<string, unknown>)[k] = { ...e, pi: [[4, 0.3]] };
    }
  }
  const s = await quietly(() => suggestForDeck({ report: deck, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(f) }));
  expect(s.routes.map((c) => c.name)).toEqual(["Impact Tremors"]);
  expect(s.plan.map((c) => c.name)).not.toContain("Impact Tremors");
});

/** A CHOSEN TYPE IS THE DECK'S TYPE HERE, as in the report (`analyze.ts` resolveChosenTypes). The
 *  2026-09-25 persona round: Inalla's Kindred Discovery "drew a card" for Poisonbelly Ogre, an Ogre in
 *  a Wizard deck, because the suggestion check read "creature of the chosen type" unresolved. */
test("a chosen-type card connects only to candidates of the deck's own type", async () => {
  const chooser = [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, chosenType: true } },
    effect: { kind: "draw" },
  }];
  const specs: Spec[] = [
    { name: "Kindred Chooser", identity: ["U"], types: ["enchantment"], abilities: chooser },                // 0 deck
    { name: "Wizard Spell", identity: ["U"], types: ["instant"], abilities: [] },                              // 1 deck, the tribe
    { name: "Wizard Two", identity: ["U"], types: ["instant"], abilities: [] },                                // 2 deck, the tribe
    { name: "Stray Ogre", identity: ["U"], types: ["creature"], abilities: [] },                               // 3 candidate
    { name: "New Wizard", identity: ["U"], types: ["creature"], abilities: [] },                               // 4 candidate
  ];
  const subtypes: Record<string, string[]> = { "Wizard Spell": ["wizard"], "Wizard Two": ["wizard"], "Stray Ogre": ["ogre"], "New Wizard": ["wizard"] };
  const f = files(specs);
  for (const [path, shard] of Object.entries(f)) {
    if (!path.includes("/cards/")) continue;
    for (const [k, e] of Object.entries(shard as Record<string, { card: { name: string }; tags: { characteristics: { subtypes: string[] } } }>)) {
      e.tags.characteristics.subtypes = subtypes[e.card.name] ?? [];
      if (e.card.name === "Kindred Chooser") (shard as Record<string, unknown>)[k] = { ...e, pi: [[3, 0.3], [4, 0.3]] };
    }
  }
  const ENTERS = "enters|creature|-|-";
  const path = `/static/${VERSION}/events/${eventShardOf(ENTERS)}.json`;
  f[path] = { [ENTERS]: { p: [3, 4], c: [0] } };
  f[`/static/${VERSION}/event-frequency.json`] = { supply: { [ENTERS]: 2 }, consume: { [ENTERS]: 1 }, byIdentity: {} };
  const deck = {
    cards: specs.slice(0, 3).map((c) => ({ name: c.name, isCommander: false })),
    buildParents: [], cutList: [], edges: [], axis: [],
    deckMath: { demand: [{ key: "enters:type:creature", available: 0, suppliers: 0, consumers: 1 }] },
  } as unknown as DeckReport;
  const s = await quietly(() => suggestForDeck({ report: deck, commanderColorIdentity: ["U"], baseUrl: "/static", fetchImpl: fetchOf(f) }));
  expect(s.synergy["enters:type:creature"]!.map((c) => c.name)).toEqual(["New Wizard"]);
});

/** THE CLAIM AND ITS EVIDENCE, ON THE ROW (persona round 2026-09-25, both seats at 2/7): a card under
 *  "You are 10 short on ramp" whose only visible reasons were about Trading Post could not be told
 *  apart from padding, and the reader asked for "each suggested card's text next to the reason". */
test("a build finding's cards say which group they count toward, and carry their own card text", async () => {
  const specs = SPECS.map((s) => s.name === "Impact Tremors"
    ? { ...s, r: ["targetedRemoval"], oracle: "Whenever a creature you control enters, this enchantment deals 1 damage to each opponent." }
    : s);
  const deck = {
    ...report,
    buildParents: [{ name: "Interaction", count: 0, target: 1, leaves: ["targetedRemoval"] }],
  } as unknown as DeckReport;
  const s = await quietly(() => suggestForDeck({ report: deck, commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(files(specs)) }));
  const tremors = s.build["Interaction"]!.find((c) => c.name === "Impact Tremors")!;
  expect(tremors.fills).toBe("Interaction");
  expect(tremors.oracle).toBe("Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.");
});
