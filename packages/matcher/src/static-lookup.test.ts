import { expect, test } from "vitest";
import { StaticLookup } from "./static-lookup.js";

const CARD = {
  card: { _id: "id-krenko", name: "Krenko", typeLine: "Legendary Creature — Goblin", oracleText: "",
    keywords: [], colors: ["R"], manaValue: 4, colorIdentity: ["R"], power: "3", toughness: "3",
    tags: { produces: [], cares: [] }, searchNames: ["krenko"] },
  tags: { oracleId: "id-krenko", abilities: [] },
  combos: [{ cards: ["Krenko", "Ashnod's Altar"], result: "Infinite" }],
};

function fetchOf(files: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const body = files[String(url)];
    return body === undefined
      ? ({ ok: false, status: 404, json: async () => ({}) } as Response)
      : ({ ok: true, status: 200, json: async () => body } as Response);
  }) as unknown as typeof fetch;
}

test("a prefetched card resolves, and an absent one is null rather than an error", async () => {
  const l = new StaticLookup("/static", fetchOf({ "/static/cards/krenko.json": CARD }));
  await l.prefetch(["krenko", "not a card"]);
  expect((await l.findByName("krenko"))?.name).toBe("Krenko");
  expect(await l.findByName("not a card")).toBeNull();
});

/** A 404 IS `findByName` RETURNING NULL, which `resolveNames` already turns into `missing`. That is
 *  why there is no name -> id index: it measured 996 KB gz to avoid exactly this. */
test("tags come from the same file as the card, so no second request is made", async () => {
  let calls = 0;
  const f = fetchOf({ "/static/cards/krenko.json": CARD });
  const counting = (async (u: string) => { calls++; return f(u as never); }) as unknown as typeof fetch;
  const l = new StaticLookup("/static", counting);
  await l.prefetch(["krenko"]);
  expect((await l.findOne("id-krenko"))?.oracleId).toBe("id-krenko");
  expect(calls).toBe(1);
});

/** EXACT, NOT APPROXIMATE, and this is the test that pins the order dependency. A combo can only
 *  be contained in the deck if its ANCHOR is in the deck, and `prefetch` has by then seen every
 *  deck name — so accumulating combos from the fetched files loses nothing. */
test("allCombos returns the union of the fetched cards' anchored combos", async () => {
  const l = new StaticLookup("/static", fetchOf({ "/static/cards/krenko.json": CARD }));
  await l.prefetch(["krenko"]);
  expect(await l.allCombos()).toEqual([{ cards: ["Krenko", "Ashnod's Altar"], result: "Infinite" }]);
});

test("allCombos before prefetch is empty, not stale", async () => {
  const l = new StaticLookup("/static", fetchOf({}));
  expect(await l.allCombos()).toEqual([]);
});

/** Pins the wiring against silently regressing to the empty Map `tokenArt` returned before
 *  `build-static.ts` grew `token-art.json` — a known id must resolve to its real crop, and an
 *  unknown id must be OMITTED rather than present with `undefined`. */
test("tokenArt reads token-art.json, filtered to the requested ids", async () => {
  const l = new StaticLookup("/static", fetchOf({
    "/static/token-art.json": { "oracle-goblin": "https://example/goblin.jpg" },
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
    return Promise.resolve({ ok: true, status: 200, json: async () => CARD } as Response);
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
