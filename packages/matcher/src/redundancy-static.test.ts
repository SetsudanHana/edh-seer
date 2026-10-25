import { describe, expect, test, vi } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckReport } from "@edh-seer/engine";
import { normalizeName } from "@edh-seer/data/names";
import { shardOf } from "./bin/build-static-core.js";
import { partnerShardOf } from "./partner-shard.js";
import { eventShardOf } from "./bin/events-index-core.js";
import { packFact } from "./member-facts.js";
import { eventKey, splitKey } from "./partners-core.js";
import similarFixtures from "./similar.fixtures.json" with { type: "json" };
import extraFixtures from "./redundancy.fixtures.json" with { type: "json" };
import { redundancyFor } from "./redundancy-static.js";

const VERSION = "v-test";
type Fx = { card: { name: string; typeLine: string; oracleText: string; colorIdentity: string[] }; tags: CardTags };
const FX = { ...similarFixtures, ...extraFixtures } as unknown as Record<string, Fx>;

// INDEX ORDER IS THE POSITION `pi` AND `sim` POINT AT.
const ORDER = ["Impact Tremors", "Witty Roastmaster", "Corpse Knight", "Hordeling Outburst", "Fiery Emancipation", "Lightning Bolt", "Swords to Plowshares", "Goblin Instigator", "Warstorm Surge", "Soul Warden"];
const TYPES = ["creature", "enchantment", "instant", "sorcery", "land"];
const slugOf = (n: string) => n.toLowerCase().replace(/[^a-z]+/g, "-");

function staticFiles(opts: { pi?: Record<string, [number, number][]>; pages?: Record<string, unknown>; events?: Record<string, { p: number[]; pf?: number[][] }> } = {}): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const n of ORDER) {
    const fx = FX[n]!;
    const key = normalizeName(n);
    const path = `/static/${VERSION}/cards/${shardOf(key)}.json`;
    out[path] = {
      ...(out[path] ?? {}),
      [key]: {
        card: {
          _id: fx.tags.oracleId, name: n, typeLine: fx.card.typeLine, oracleText: fx.card.oracleText, keywords: [], colors: fx.card.colorIdentity,
          manaValue: fx.tags.characteristics.cmc, colorIdentity: fx.card.colorIdentity, power: null, toughness: null, searchNames: [key],
        },
        tags: fx.tags, combos: [],
        ...(opts.pi?.[n] ? { pi: opts.pi[n] } : {}),
      },
    };
  }
  const pages: Record<string, Record<string, unknown>> = {};
  for (const [slug, rec] of Object.entries(opts.pages ?? {})) {
    const p = `/static/${VERSION}/partners/${partnerShardOf(slug)}.json`;
    pages[p] = { ...(pages[p] ?? {}), [slug]: rec };
  }
  const events: Record<string, Record<string, unknown>> = {};
  for (const [key, m] of Object.entries(opts.events ?? {})) {
    const path = `/static/${VERSION}/events/${eventShardOf(key)}.json`;
    events[path] = { ...(events[path] ?? {}), [key]: { c: [], ...m } };
  }
  return {
    "/static/manifest.json": { version: VERSION },
    [`/static/${VERSION}/name-index.json`]: {
      types: TYPES, subtypes: [], keywords: [], pairTags: [], similarChips: [],
      cards: ORDER.map((n) => ({ slug: slugOf(n), name: n, identity: FX[n]!.card.colorIdentity, commander: false, t: FX[n]!.tags.characteristics.types.map((t) => TYPES.indexOf(t)), mv: FX[n]!.tags.characteristics.cmc })),
    },
    [`/static/${VERSION}/event-frequency.json`]: { supply: {}, consume: {}, byIdentity: {} },
    ...out, ...pages, ...events,
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

// Impact Tremors' buckets (probed with `seedBuckets`): its damage, and the drain counterpart. NO `pi` anywhere: the pool is the event index.
const PING = packFact({ kind: "triggered", repeats: "repeatable", amount: { kind: "fixed", value: 1 } });
const EVENTS = {
  "non-combat-damage|-|-|-": { p: [1, 5], pf: [[PING], [PING]] },   // Witty Roastmaster, Lightning Bolt
  "lose-life|-|-|-": { p: [2], pf: [[PING]] },                       // Corpse Knight
};
const reason = (producer: string, consumer: string, tag: string, extra: object = {}) => ({ tag, text: `${producer} -> ${consumer}`, producer, consumer, ...extra });
const edge = (a: string, b: string, reasons: object[]) => ({ a, b, score: 1, reasons });
const cardRow = (name: string, extra: object = {}) => ({ name, isCommander: false, ...extra });

function deck(withFiery: boolean, extraCards: object[] = [], extraEdges: object[] = []): DeckReport {
  return {
    cards: [cardRow("Impact Tremors"), cardRow("Hordeling Outburst"), ...(withFiery ? [cardRow("Fiery Emancipation")] : []), ...extraCards],
    edges: [
      edge("Hordeling Outburst", "Impact Tremors", [reason("Hordeling Outburst", "Impact Tremors", "creature-enters", { producerAbility: 0, consumerAbility: 0 })]),
      ...(withFiery ? [edge("Fiery Emancipation", "Impact Tremors", [reason("Fiery Emancipation", "Impact Tremors", "non-combat-damage:any", { producerAbility: 0, consumerAbility: 0 })])] : []),
      ...extraEdges,
    ],
    buildParents: [], cutList: [],
  } as unknown as DeckReport;
}
const run = (report: DeckReport, files = staticFiles({ events: EVENTS }), seed = "Impact Tremors", identity = ["R", "B", "W"]) =>
  redundancyFor({ report, seed, commanderColorIdentity: identity, baseUrl: "/static", fetchImpl: fetchOf(files) });

describe("redundancyFor", () => {
  test("pool from the event buckets (no pi, no sim rows), partners shared from engine edges, amplifier chip when Fiery Emancipation is in the deck", async () => {
    const r = await run(deck(true));
    expect(r.seedPartners.sort()).toEqual(["Fiery Emancipation", "Hordeling Outburst"]);
    expect(r.amplifiers).toEqual(["Fiery Emancipation"]);
    expect(r.poolSize).toBe(3);
    expect(r.stats).toMatchObject({ buckets: ["non-combat-damage|-|-|-", "lose-life|-|-|-"], bucketSizes: [2, 1], poolSize: 3, fetched: 3 });
    const witty = r.hits.find((h) => h.name === "Witty Roastmaster")!;
    expect(witty.tier).toBe("close");
    expect(witty.deckChips).toContainEqual({ dim: "shared", label: "shares 2 of 2 partners" }); // Fiery Emancipation triples the 1 damage Witty deals
    const knight = r.hits.find((h) => h.name === "Corpse Knight")!;
    expect(knight.tier).toBe("outcome");
    expect(knight.deckChips).toContainEqual({ dim: "amplifier", label: "loses synergy with Fiery Emancipation" });
  });

  test("every hit carries its page slug from the name index", async () => {
    const r = await run(deck(true));
    expect(r.hits.length).toBeGreaterThan(0);
    for (const h of r.hits) expect(h.slug).toBe(slugOf(h.name));
  });

  test("without Fiery Emancipation there is no amplifier chip", async () => {
    const r = await run(deck(false));
    expect(r.amplifiers).toEqual([]);
    expect(r.seedPartners).toEqual(["Hordeling Outburst"]);
    const knight = r.hits.find((h) => h.name === "Corpse Knight")!;
    expect(knight.deckChips.some((c) => c.dim === "amplifier")).toBe(false);
    expect(knight.deckChips).toContainEqual({ dim: "shared", label: "shares 1 of 1 partners" });
    expect(r.hits.find((h) => h.name === "Witty Roastmaster")!.deckChips).toContainEqual({ dim: "shared", label: "shares 1 of 1 partners" });
  });

  test("a deck card that does the same job is listed in-deck with the partners it shares", async () => {
    const r = await run(deck(false, [cardRow("Witty Roastmaster")], [edge("Hordeling Outburst", "Witty Roastmaster", [reason("Hordeling Outburst", "Witty Roastmaster", "creature-enters")])]), staticFiles({ events: EVENTS }));
    const witty = r.hits.find((h) => h.name === "Witty Roastmaster")!;
    expect(witty.inDeck).toBe(true);
    expect(witty.sharedPartners).toEqual(["Hordeling Outburst"]);
    expect(r.poolSize).toBe(2);
  });

  test("a reason naming a face resolves to its physical card", async () => {
    const report = deck(false, [cardRow("Hordeling Outburst // Back Face", { cardName: "Hordeling Outburst" })]);
    (report.cards as { name: string; cardName?: string }[])[1] = { name: "Hordeling Outburst // Back Face", cardName: "Hordeling Outburst" } as never;
    report.edges = [edge("Hordeling Outburst // Back Face", "Impact Tremors", [reason("Hordeling Outburst // Back Face", "Impact Tremors", "creature-enters")])] as never;
    const r = await run(report);
    expect(r.seedPartners).toEqual(["Hordeling Outburst"]);
  });

  test("a seed with no page record, or no tags at all, is empty and never an error", async () => {
    const r = await run(deck(false), staticFiles({ events: EVENTS }));
    expect(r.hits.length).toBeGreaterThan(0);
    const none = await run(deck(false, [cardRow("Unknown Card")]), staticFiles({ events: EVENTS }), "Unknown Card");
    expect(none).toMatchObject({ hits: [], poolSize: 0, seedPartners: [], amplifiers: [] });
    expect(none.stats.comparable).toBe(false);
    expect(r.stats.comparable).toBe(true);
  });

  test("the seed's own precomputed similar rows join the pool", async () => {
    const files = staticFiles({ pages: { [slugOf("Impact Tremors")]: { sim: [[1, 1]] } } });
    const r = await run(deck(false), files);
    expect(r.hits.map((h) => h.name)).toContain("Witty Roastmaster");
    expect(r.hits.find((h) => h.name === "Witty Roastmaster")!.sharedPartners).toEqual(["Hordeling Outburst"]);
  });

  test("shared partners come from engine edges: a candidate with a real reason to a seed partner shares it, one without does not", async () => {
    const r = await run(deck(false));
    // Lightning Bolt is in the damage bucket but the token maker draws no reason to or from it.
    const bolt = r.hits.find((h) => h.name === "Lightning Bolt");
    expect(bolt).toBeDefined();
    expect(bolt!.sharedPartners).toEqual([]);
    expect(r.hits.find((h) => h.name === "Witty Roastmaster")!.sharedPartners).toEqual(["Hordeling Outburst"]);
  });

  test("a reason that exists only because a card enters is not an edge to the seed", async () => {
    const report = deck(false);
    report.edges = [edge("Hordeling Outburst", "Impact Tremors", [reason("Hordeling Outburst", "Impact Tremors", "creature-enters", { impliedProducer: true })])] as never;
    const r = await run(report);
    expect(r.seedPartners).toEqual([]);
  });

  test("a candidate outside the commander's identity is never fetched", async () => {
    const files = staticFiles({ events: { ...EVENTS, "non-combat-damage|-|-|-": { p: [1, 5, 6], pf: [[PING], [PING], [PING]] } } });
    const log: string[] = [];
    const inner = fetchOf(files);
    const logged = (async (url: string) => { log.push(String(url)); return inner(url); }) as unknown as typeof fetch;
    const swords = `/static/${VERSION}/cards/${shardOf(normalizeName("Swords to Plowshares"))}.json`;
    const others = ORDER.filter((n) => n !== "Swords to Plowshares").map((n) => `/static/${VERSION}/cards/${shardOf(normalizeName(n))}.json`);
    expect(others).not.toContain(swords); // precondition: Swords' shard is its own, so a fetch of it is a fetch of Swords
    const r = await redundancyFor({ report: deck(false), seed: "Impact Tremors", commanderColorIdentity: ["R", "B"], baseUrl: "/static", fetchImpl: logged });
    expect(log).not.toContain(swords);
    expect(r.hits.map((h) => h.name)).not.toContain("Swords to Plowshares");
    expect(r.hits.map((h) => h.name)).not.toContain("Corpse Knight"); // W/B, outside R/B too
    expect(r.stats.fetched).toBe(2);
  });

  test("a token maker is a seed partner through its token node, and the numerator agrees (Witty Roastmaster vs Goblin Instigator)", async () => {
    const report = {
      cards: [cardRow("Impact Tremors"), cardRow("Goblin Instigator"), cardRow("Hordeling Outburst")],
      tokenNodes: [{ name: "Goblin Token", hasPartner: true, madeBy: ["Goblin Instigator", "Hordeling Outburst"] }],
      edges: [
        // The direct reasons are baseline ("a card enters"); the report follows the token node instead.
        edge("Goblin Instigator", "Impact Tremors", [reason("Goblin Instigator", "Impact Tremors", "creature-enters", { impliedProducer: true })]),
        edge("Goblin Token", "Impact Tremors", [reason("Goblin Token", "Impact Tremors", "creature-enters", { impliedProducer: true, producerIsToken: true })]),
        // The makers' own edges to the token must not link the makers to each other.
        edge("Goblin Instigator", "Goblin Token", [reason("Goblin Instigator", "Goblin Token", "creates", { consumerIsToken: true })]),
        edge("Hordeling Outburst", "Goblin Token", [reason("Hordeling Outburst", "Goblin Token", "creates", { consumerIsToken: true })]),
      ],
      buildParents: [], cutList: [],
    } as unknown as DeckReport;
    const r = await run(report);
    expect(r.seedPartners).toEqual(["Goblin Instigator", "Hordeling Outburst"]);
    expect(r.hits.find((h) => h.name === "Witty Roastmaster")!.deckChips).toContainEqual({ dim: "shared", label: "shares 2 of 2 partners" });
  });

  test("a variable-amount enters trigger (Warstorm Surge) is a close hit, and perTier passes through", async () => {
    const VARIABLE = packFact({ kind: "triggered", repeats: "repeatable", amount: { kind: "variable" } });
    const events = { ...EVENTS, "non-combat-damage|-|-|-": { p: [1, 5, 8], pf: [[PING], [PING], [VARIABLE]] } };
    const r = await run(deck(false), staticFiles({ events }));
    expect(r.hits.find((h) => h.name === "Warstorm Surge")!.tier).toBe("close");
    const none = await redundancyFor({ report: deck(false), seed: "Impact Tremors", commanderColorIdentity: ["R", "B", "W"], baseUrl: "/static", fetchImpl: fetchOf(staticFiles({ events })), perTier: { close: 0 } });
    expect(none.hits.some((h) => h.tier === "close")).toBe(false);
  });

  test("a member that asks for the seed's trigger outranks name-order ties when the pool is capped", async () => {
    const t = (FX["Impact Tremors"]!.tags.abilities[0] as unknown as { trigger: { verbs: string[]; subject: never } }).trigger;
    const triggerKey = splitKey(eventKey({ verb: t.verbs[0], subject: t.subject } as never))[0]!;
    // Bolt sorts first by name and ties Witty on pf; only Witty (last by name) asks for "a creature enters".
    const events = {
      "non-combat-damage|-|-|-": { p: [5, 1], pf: [[PING], [PING]] },
      [triggerKey]: { p: [], c: [1] },
    };
    const r = await redundancyFor({ report: deck(false), seed: "Impact Tremors", commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: fetchOf(staticFiles({ events })), poolCap: 1 });
    expect(r.stats.fetched).toBe(1);
    expect(r.hits.map((h) => h.name)).toContain("Witty Roastmaster");
    expect(r.hits.map((h) => h.name)).not.toContain("Lightning Bolt");
  });

  test("a seed partner that is a plain creature is not shared: 'a creature enters' links are dropped (impliedProducer)", async () => {
    const report = {
      cards: [cardRow("Impact Tremors"), cardRow("Soul Warden")],
      edges: [edge("Soul Warden", "Impact Tremors", [reason("Soul Warden", "Impact Tremors", "creature-enters")])],
      buildParents: [], cutList: [],
    } as unknown as DeckReport;
    const r = await run(report);
    expect(r.seedPartners).toEqual(["Soul Warden"]);
    const witty = r.hits.find((h) => h.name === "Witty Roastmaster")!;
    expect(witty.sharedPartners).toEqual([]);
    expect(witty.deckChips.some((c) => c.dim === "shared")).toBe(false);
  });

  const tokenDeck = (): DeckReport => ({
    cards: [cardRow("Goblin Instigator"), cardRow("Hordeling Outburst"), cardRow("Impact Tremors")],
    tokenNodes: [{ name: "Goblin Token", hasPartner: true, madeBy: ["Goblin Instigator", "Hordeling Outburst"] }],
    edges: [
      edge("Goblin Token", "Impact Tremors", [reason("Goblin Token", "Impact Tremors", "creature-enters", { impliedProducer: true, producerIsToken: true })]),
      edge("Goblin Instigator", "Goblin Token", [reason("Goblin Instigator", "Goblin Token", "creates", { consumerIsToken: true })]),
      edge("Hordeling Outburst", "Goblin Token", [reason("Hordeling Outburst", "Goblin Token", "creates", { consumerIsToken: true })]),
    ],
    buildParents: [], cutList: [],
  } as unknown as DeckReport);

  test("makers of one token are not partners of each other: an in-deck maker shares only the payoff", async () => {
    const r = await run(tokenDeck(), staticFiles({ events: {} }), "Goblin Instigator");
    expect(r.seedPartners).toEqual(["Impact Tremors"]);
    const hordeling = r.hits.find((h) => h.name === "Hordeling Outburst")!;
    expect(hordeling.inDeck).toBe(true);
    expect(hordeling.sharedPartners).toEqual(["Impact Tremors"]);
  });

  test("an absent exact key falls back to the nearest coarser key that exists, and stats says so", async () => {
    const GOBLIN = "create-token|creature|goblin|t";
    const files = staticFiles({ events: { "create-token|creature|-|t": { p: [7], pf: [[PING]] } } });
    const r = await run(deck(false), files, "Hordeling Outburst");
    expect(r.stats.fallbacks).toContainEqual({ key: GOBLIN, usedKey: "create-token|creature|-|t" });
    expect(r.stats.bucketSizes[r.stats.buckets.indexOf(GOBLIN)]).toBe(1);
    expect(r.stats.fetched).toBe(1);
    expect(r.hits.map((h) => h.name)).toContain("Goblin Instigator");
    const none = await run(deck(false), staticFiles({ events: {} }), "Hordeling Outburst");
    expect(none.stats.missing).toContain(GOBLIN);
  });

  test("an unreadable events shard and an unreadable candidate shard drop only themselves", async () => {
    const files = staticFiles({ events: EVENTS });
    const lossShard = `/static/${VERSION}/events/${eventShardOf("lose-life|-|-|-")}.json`;
    const boltShard = `/static/${VERSION}/cards/${shardOf(normalizeName("Lightning Bolt"))}.json`;
    expect(Object.keys(files)).toContain(lossShard);
    const inner = fetchOf(files);
    const flaky = (async (url: string) => {
      if (url === lossShard || url === boltShard) throw new Error("network down");
      // The good shards land LATER than the bad one rejects: a Promise.all prefetch would give up before they arrive.
      if (url.includes("/cards/")) await new Promise((r) => setTimeout(r, 20));
      return inner(url);
    }) as unknown as typeof fetch;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await redundancyFor({ report: deck(false), seed: "Impact Tremors", commanderColorIdentity: ["R", "B", "W"], baseUrl: "/static", fetchImpl: flaky });
    warn.mockRestore();
    expect(r.hits.map((h) => h.name)).toContain("Witty Roastmaster");
    expect(r.hits.map((h) => h.name)).not.toContain("Lightning Bolt");
    expect(r.stats.errors).toEqual(["lose-life|-|-|-"]);
    expect(r.stats.comparable).toBe(true);
  });

  test("a sim row outside the commander's identity is never fetched", async () => {
    const files = staticFiles({ pages: { [slugOf("Impact Tremors")]: { sim: [[6, 1]] } } });
    const log: string[] = [];
    const inner = fetchOf(files);
    const logged = (async (url: string) => { log.push(String(url)); return inner(url); }) as unknown as typeof fetch;
    const swords = `/static/${VERSION}/cards/${shardOf(normalizeName("Swords to Plowshares"))}.json`;
    await redundancyFor({ report: deck(false), seed: "Impact Tremors", commanderColorIdentity: ["R"], baseUrl: "/static", fetchImpl: logged });
    expect(log).not.toContain(swords);
  });

  test("a replacement that is not a damage replacement is no amplifier (a token doubler into the seed)", async () => {
    const report = deck(true);
    // The same shape as the engine's reason for Parallel Lives / Anointed Procession: a replacement ability, but on tokens, not damage.
    report.edges = [report.edges[0]!, edge("Fiery Emancipation", "Impact Tremors", [reason("Fiery Emancipation", "Impact Tremors", "create-token:creature", { producerAbility: 0, consumerAbility: 0 })])] as never;
    const r = await run(report);
    expect(r.amplifiers).toEqual([]);
    expect(r.hits.find((h) => h.name === "Corpse Knight")!.deckChips.some((c) => c.dim === "amplifier")).toBe(false);
    // ...and a combat-damage replacement still is one.
    report.edges = [report.edges[0]!, edge("Fiery Emancipation", "Impact Tremors", [reason("Fiery Emancipation", "Impact Tremors", "combat-damage:any", { producerAbility: 0, consumerAbility: 0 })])] as never;
    expect((await run(report)).amplifiers).toEqual(["Fiery Emancipation"]);
  });

  test("every events shard unreadable by ERROR rejects (so the caller can retry); an absent key is not an error", async () => {
    const files = staticFiles({ events: EVENTS });
    const inner = fetchOf(files);
    const down = (async (url: string) => { if (url.includes("/events/")) throw new Error("network down"); return inner(url); }) as unknown as typeof fetch;
    await expect(redundancyFor({ report: deck(false), seed: "Impact Tremors", commanderColorIdentity: ["R", "B", "W"], baseUrl: "/static", fetchImpl: down })).rejects.toThrow(/event index could not be read/);
    // Absent keys (404) are the card's own answer: resolves, uncomparable.
    const none = await run(deck(false), staticFiles({ events: {} }));
    expect(none.stats.comparable).toBe(false);
    expect(none.stats.errors).toEqual([]);
  });
});
