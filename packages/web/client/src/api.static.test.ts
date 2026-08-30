import { expect, test } from "vitest";
import { analyzeDeckStatic } from "./api.static.js";
import { shardOf } from "@edh-seer/matcher/static-lookup";

const card = (id: string, name: string, typeLine: string, colorIdentity: string[]) => ({
  card: { _id: id, name, typeLine, oracleText: "", keywords: [], colors: colorIdentity,
    manaValue: 1, colorIdentity, power: null, toughness: null,
    tags: { produces: [], cares: [] }, searchNames: [name.toLowerCase()] },
  tags: null,
  combos: [],
});

/** Shard files the way `build-static.ts` writes them and `StaticLookup` asks for them. The test
 *  names CARDS and the layout is derived, so this cannot drift from `shardOf` — the first version
 *  hard-coded `/static/cards/krenko.json` and went red the day the layout changed, which is the
 *  right kind of red but only once. */
const VERSION = "v-abc123def456";

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

/** THE WHOLE PATH, IN ONE ASSERTION: parse -> prefetch -> resolve -> analyse -> project, with no
 *  server anywhere. `missing` empty and `resolvedCount` 2 is what says every stage handed its
 *  output to the next one. */
test("a deck analyses end to end against static files alone", async () => {
  const f = fetchOf({
    ...shardsOf({
      krenko: card("id-krenko", "Krenko", "Legendary Creature — Goblin", ["R"]),
      mountain: card("id-mountain", "Mountain", "Basic Land — Mountain", []),
    }),
    [`/static/${VERSION}/token-tags.json`]: {},
  });
  const r = await analyzeDeckStatic("Krenko\n\nMountain", undefined, "/static", f);
  expect(r.missing).toEqual([]);
  expect(r.resolvedCount).toBe(2);
  expect(r.commanderColorIdentity).toEqual(["R"]);
  expect(r.graph.nodes.length).toBeGreaterThan(0);
});

/** AN UNKNOWN CARD IS `missing`, NOT A CRASH — a 404 is the static shape of `findByName` returning
 *  null, and the report still has to render for the rest of the deck. */
test("a card with no file lands in missing and the rest still analyses", async () => {
  const f = fetchOf({
    ...shardsOf({ krenko: card("id-krenko", "Krenko", "Legendary Creature — Goblin", ["R"]) }),
    [`/static/${VERSION}/token-tags.json`]: {},
  });
  const r = await analyzeDeckStatic("Krenko\n\nNot A Real Card", undefined, "/static", f);
  expect(r.missing).toEqual(["Not A Real Card"]);
  expect(r.resolvedCount).toBe(1);
});
