import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { StaticLookup } from "./static-lookup.js";
import { shardOf } from "./bin/build-static-core.js";

const CARD = {
  card: { _id: "id-krenko", name: "Krenko", typeLine: "Legendary Creature — Goblin", oracleText: "",
    keywords: [], colors: ["R"], manaValue: 4, colorIdentity: ["R"], power: "3", toughness: "3",
    tags: { produces: [], cares: [] }, searchNames: ["krenko"] },
  tags: { oracleId: "id-krenko", abilities: [] },
  combos: [{ cards: ["Krenko", "Ashnod's Altar"], result: "Infinite" }],
};

/** The version directory a build writes under. Any string does; the client learns it from the
 *  manifest and never parses it. */
const VERSION = "v-abc123def456";

/** Shard files as `build-static.ts` writes them, addressed the way the client asks for them: the
 *  test states the CARDS it is serving and both the manifest and the shard layout are derived, so
 *  a change to `shardOf` or to the version path cannot leave these fixtures quietly serving 404s. */
function shardsOf(cards: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, entry] of Object.entries(cards)) {
    const path = `/static/${VERSION}/cards/${shardOf(name)}.json`;
    out[path] = { ...(out[path] ?? {}), [name]: entry };
  }
  return { "/static/manifest.json": { version: VERSION }, ...out };
}

function fetchOf(files: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const body = files[String(url)];
    return body === undefined
      ? ({ ok: false, status: 404, json: async () => ({}) } as Response)
      : ({ ok: true, status: 200, json: async () => body } as Response);
  }) as unknown as typeof fetch;
}

test("a prefetched card resolves, and an absent one is null rather than an error", async () => {
  const l = new StaticLookup("/static", fetchOf(shardsOf({ krenko: CARD })));
  await l.prefetch(["krenko", "not a card"]);
  expect((await l.findByName("krenko"))?.name).toBe("Krenko");
  expect(await l.findByName("not a card")).toBeNull();
});

/** A 404 IS `findByName` RETURNING NULL, which `resolveNames` already turns into `missing`. That is
 *  why there is no name -> id index: it measured 996 KB gz to avoid exactly this. */
test("tags come from the same file as the card, so no second request is made", async () => {
  let calls = 0;
  const f = fetchOf(shardsOf({ krenko: CARD }));
  // The manifest is one fixed request per instance and is not what this test is about; count the
  // CARD requests, which is the number a second name in the same shard must not increase.
  const counting = (async (u: string) => { if (String(u).includes("/cards/")) calls++; return f(u as never); }) as unknown as typeof fetch;
  const l = new StaticLookup("/static", counting);
  await l.prefetch(["krenko"]);
  expect((await l.findOne("id-krenko"))?.oracleId).toBe("id-krenko");
  expect(calls).toBe(1);
});

/** EXACT, NOT APPROXIMATE, and this is the test that pins the order dependency. A combo can only
 *  be contained in the deck if its ANCHOR is in the deck, and `prefetch` has by then seen every
 *  deck name — so accumulating combos from the fetched files loses nothing. */
test("allCombos returns the union of the fetched cards' anchored combos", async () => {
  const l = new StaticLookup("/static", fetchOf(shardsOf({ krenko: CARD })));
  await l.prefetch(["krenko"]);
  expect(await l.allCombos()).toEqual([{ cards: ["Krenko", "Ashnod's Altar"], result: "Infinite" }]);
});

/** A SHARD CARRIES CARDS THE DECK DID NOT ASK FOR — 2.2 names each, corpus-wide — and reading them
 *  out with the ones it did would put combos in `allCombos()` for cards that are not in the deck.
 *  The name is forced into the same shard here rather than hoped into it, so this cannot decay
 *  into a test that passes because the two names happened to hash apart. */
test("a shard-mate the deck did not ask for contributes nothing", async () => {
  const shard = shardOf("krenko");
  const stranger = {
    card: { ...CARD.card, _id: "id-stranger", name: "Stranger", searchNames: ["stranger"] },
    tags: { oracleId: "id-stranger", abilities: [] },
    combos: [{ cards: ["Stranger", "Ashnod's Altar"], result: "Infinite strangers" }],
  };
  const l = new StaticLookup("/static", fetchOf({
    "/static/manifest.json": { version: VERSION },
    [`/static/${VERSION}/cards/${shard}.json`]: { krenko: CARD, stranger },
  }));
  await l.prefetch(["krenko"]);
  expect(await l.allCombos()).toEqual([{ cards: ["Krenko", "Ashnod's Altar"], result: "Infinite" }]);
  expect(await l.findByName("stranger")).toBeNull();
  expect(await l.findOne("id-stranger")).toBeNull();
});

/** ONE REQUEST PER SHARD, NOT PER NAME. Two names in one shard were two fetches before; the whole
 *  point of the layout is that they are one. */
test("two names in the same shard cost one request", async () => {
  // A REAL COLLISION, SEARCHED FOR RATHER THAN ASSERTED. Forcing two names into one fixture file
  // proves nothing if the client asks for them by their own shards -- the first draft of this test
  // did exactly that and failed, which is the useful kind of failure.
  const shard = shardOf("krenko");
  let mate = "";
  for (let i = 0; !mate && i < 200_000; i++) if (shardOf(`mate ${i}`) === shard) mate = `mate ${i}`;
  expect(mate).not.toBe("");

  const twin = { ...CARD, card: { ...CARD.card, _id: "id-twin", name: "Twin", searchNames: [mate] } };
  let calls = 0;
  const f = fetchOf({
    "/static/manifest.json": { version: VERSION },
    [`/static/${VERSION}/cards/${shard}.json`]: { krenko: CARD, [mate]: twin },
  });
  const counting = (async (u: string) => { if (String(u).includes("/cards/")) calls++; return f(u as never); }) as unknown as typeof fetch;
  const l = new StaticLookup("/static", counting);
  await l.prefetch(["krenko", mate]);
  expect((await l.findByName("krenko"))?.name).toBe("Krenko");
  expect((await l.findByName(mate))?.name).toBe("Twin");
  expect(calls).toBe(1);
});

test("allCombos before prefetch is empty, not stale", async () => {
  const l = new StaticLookup("/static", fetchOf({}));
  expect(await l.allCombos()).toEqual([]);
});

/** THE JODAH DEFECT. A decklist line can name an alternate printing -- the corpus maps
 *  `spongebob squarepants` to Jodah, the Unifier and six names to Command Tower -- and
 *  `buildDeckCards` then re-looks the resolved card up by its CANONICAL name to recover its oracle
 *  id. That name was never prefetched, so the map missed and the card came back UNTAGGED: it
 *  resolved, it counted as a matched line, and it silently formed no edges. Reported from a real
 *  deck as "98 of 100 cards read" with the commander among the unread.
 *
 *  Mongo re-queries and never had the problem, and every calibration deck is written in canonical
 *  names, so 71/71 parity is silent on it. This test is the instrument that was missing. */
test("a card fetched under one of its names answers to its canonical name too", async () => {
  const jodah = {
    card: { ...CARD.card, _id: "id-jodah", name: "Jodah, the Unifier",
      searchNames: ["jodah the unifier", "spongebob squarepants", "warrior of light"] },
    tags: { oracleId: "id-jodah", abilities: [] },
    combos: [],
  };
  const l = new StaticLookup("/static", fetchOf(shardsOf({ "spongebob squarepants": jodah })));
  await l.prefetch(["spongebob squarepants"]);

  // The line the reader wrote resolves, as it always did.
  expect((await l.findByName("spongebob squarepants"))?.name).toBe("Jodah, the Unifier");
  // And so does the name `buildDeckCards` asks for, WITHOUT a second request -- which is what
  // carries the tags through to the report.
  expect((await l.findByName("jodah the unifier"))?._id).toBe("id-jodah");
  expect((await l.findOne("id-jodah"))?.oracleId).toBe("id-jodah");
});

/** AN ALIAS MUST NOT PRE-EMPT THE BUILD'S OWN ANSWER. 53 names in the corpus resolve to more than
 *  one card, and `build-static.ts` re-queries each of them through the live `findOne` so the file
 *  holds the same winner the Mongo path picks. A card learned incidentally must never shadow that.
 */
test("an explicitly fetched name wins over an alias learned from another card", async () => {
  const claimant = {
    card: { ...CARD.card, _id: "id-claimant", name: "Claimant", searchNames: ["claimant", "smelt"] },
    tags: null, combos: [],
  };
  const winner = {
    card: { ...CARD.card, _id: "id-winner", name: "Smelt", searchNames: ["smelt"] },
    tags: null, combos: [],
  };
  const l = new StaticLookup("/static", fetchOf(shardsOf({ claimant, smelt: winner })));
  await l.prefetch(["claimant"]);
  expect((await l.findByName("smelt"))?._id).toBe("id-claimant"); // only the alias is known so far
  await l.prefetch(["smelt"]);
  expect((await l.findByName("smelt"))?._id).toBe("id-winner"); // the build's own answer replaces it
});

/** A DEPLOY IS NOT ATOMIC, and a bundle can outlive the artifacts beside it. With no manifest to
 *  read, the client asks for the flat paths the previous build wrote rather than 404ing on every
 *  card — the version is an optimisation for caching, and losing it must cost freshness, not the
 *  deck. */
test("with no manifest, the flat layout still answers", async () => {
  const l = new StaticLookup("/static", fetchOf({ [`/static/cards/${shardOf("krenko")}.json`]: { krenko: CARD } }));
  await l.prefetch(["krenko"]);
  expect((await l.findByName("krenko"))?.name).toBe("Krenko");
});

/** The manifest is read ONCE per instance, not once per shard: a 100-card deck touches ~90 shards
 *  and each of those calls `fetchCached`. */
test("the manifest is fetched once however many shards a deck touches", async () => {
  let manifests = 0;
  const f = fetchOf(shardsOf({ krenko: CARD, mountain: CARD, forest: CARD }));
  const counting = (async (u: string) => {
    if (String(u).endsWith("manifest.json")) manifests++;
    return f(u as never);
  }) as unknown as typeof fetch;
  const l = new StaticLookup("/static", counting);
  await l.prefetch(["krenko", "mountain", "forest"]);
  await l.tokenTags();
  expect(manifests).toBe(1);
});

/** A CACHE IS ONLY SAFE TO DROP WHEN WE KNOW WHAT REPLACED IT. Found offline: a manifest read that
 *  failed put this on the flat fallback, and evicting from there deleted a correctly-cached corpus
 *  on the strength of a request that never answered — 91 shards thrown away over one 30-byte file.
 *  The eviction is a `caches` operation, so this test only asserts the guard that precedes it. */
test("an unknown version evicts nothing", async () => {
  const src = readFileSync(new URL("./static-lookup.ts", import.meta.url), "utf8");
  expect(src).toContain("if (version) void this.evictOtherVersions(cacheName);");
});

/** Pins the wiring against silently regressing to the empty Map `tokenArt` returned before
 *  `build-static.ts` grew `token-art.json` — a known id must resolve to its real crop, and an
 *  unknown id must be OMITTED rather than present with `undefined`. */
test("tokenArt reads token-art.json, filtered to the requested ids", async () => {
  const l = new StaticLookup("/static", fetchOf({
    "/static/manifest.json": { version: VERSION },
    [`/static/${VERSION}/token-art.json`]: { "oracle-goblin": "https://example/goblin.jpg" },
  }));
  const art = await l.tokenArt(["oracle-goblin", "oracle-unknown"]);
  expect(art.get("oracle-goblin")).toBe("https://example/goblin.jpg");
  expect(art.has("oracle-unknown")).toBe(false);
});

/** THE DEFECT THIS PINS: a real browser's `fetch` brand-checks its receiver, so calling it as
 *  `this.fetchImpl(url)` (a property access) with the BARE global assigned throws
 *  `Illegal invocation` -- Node's global `fetch` does not enforce this, which is why every earlier
 *  test above passed against the bug and none of them could have caught it. This stub simulates
 *  the real browser's check by throwing unless invoked with `this === globalThis`, and constructs
 *  `StaticLookup` with the ZERO-ARGUMENT default -- `new StaticLookup(baseUrl)`, the exact call the
 *  type signature invites and the one that broke in `api.static.ts`'s live-browser check. */
test("the default fetchImpl survives a native receiver brand-check", async () => {
  const original = globalThis.fetch;
  const brandChecked = function (this: unknown, url: string) {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith("manifest.json") ? { version: VERSION } : { krenko: CARD }),
    } as Response);
  } as unknown as typeof fetch;
  globalThis.fetch = brandChecked;
  try {
    const l = new StaticLookup("/static"); // no fetchImpl argument -- the constructor default
    await l.prefetch(["krenko"]);
    expect((await l.findByName("krenko"))?.name).toBe("Krenko");
  } finally {
    globalThis.fetch = original;
  }
});
