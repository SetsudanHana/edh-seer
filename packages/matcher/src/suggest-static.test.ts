import { expect, test, vi } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckReport } from "@edh-seer/engine";
import { normalizeName } from "@edh-seer/data/names";
import { shardOf } from "./bin/build-static-core.js";
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

interface Spec { name: string; identity: string[]; types: string[]; abilities: unknown[] | null; tokenParts?: true; typeLine?: string }
const entry = (s: Spec, pi?: [number, number][]) => ({
  card: {
    _id: `id-${s.name}`, name: s.name, typeLine: s.typeLine ?? s.types.join(" "), oracleText: "", keywords: [], colors: s.identity,
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
