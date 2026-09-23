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

interface Spec { name: string; identity: string[]; types: string[]; abilities: unknown[] }
const entry = (s: Spec, pi?: [number, number][]) => ({
  card: {
    _id: `id-${s.name}`, name: s.name, typeLine: s.types.join(" "), oracleText: "", keywords: [], colors: s.identity,
    manaValue: 3, colorIdentity: s.identity, power: null, toughness: null, searchNames: [normalizeName(s.name)],
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

function files(): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const s of SPECS) {
    const key = normalizeName(s.name);
    const path = `/static/${VERSION}/cards/${shardOf(key)}.json`;
    out[path] = { ...(out[path] ?? {}), [key]: entry(s, PI[s.name]) };
  }
  return {
    "/static/manifest.json": { version: VERSION },
    [`/static/${VERSION}/name-index.json`]: { types: TYPES, subtypes: [], keywords: [], cards: SPECS.map(indexRow) },
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
