import { expect, test, vi } from "vitest";
import { partnerShardOf } from "@edh-seer/matcher/partners-core";
import { loadCardPage, loadNameIndex } from "./partners.js";

const fetchOf = (files: Record<string, unknown>) => vi.fn(async (url: string) =>
  url in files
    ? ({ ok: true, json: async () => files[url] } as Response)
    : ({ ok: false, status: 404, json: async () => ({}) } as Response));

const KRENKO = {
  name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior", manaCost: "{2}{R}{R}",
  identity: ["R"], commander: true, emits: [], demands: [], partners: [], pool: {},
};

test("a known slug resolves through its shard", async () => {
  const f = fetchOf({
    "/static/manifest.json": { version: "v-abc" },
    [`/static/v-abc/partners/${partnerShardOf("krenko-mob-boss")}.json`]: { "krenko-mob-boss": KRENKO },
  });
  const page = await loadCardPage("krenko-mob-boss", "/static", f as unknown as typeof fetch);
  expect(page?.name).toBe("Krenko, Mob Boss");
});

/** A CARD PAGE THAT CANNOT ANSWER SAYS SO. A slug nobody minted, or a shard that 404s mid-deploy,
 *  is "no such card" -- never an exception the route has to catch to render anything at all. */
test("an unknown slug is null, not a throw", async () => {
  const f = fetchOf({ "/static/manifest.json": { version: "v-abc" } });
  expect(await loadCardPage("no-such-card", "/static", f as unknown as typeof fetch)).toBeNull();
});

/** A SHARD THAT EXISTS BUT DOES NOT HOLD THE SLUG is the same answer as a missing shard: two cards
 *  share a shard whenever their slugs hash together, so a hit on the file proves nothing. */
test("a shard without the slug is null too", async () => {
  const f = fetchOf({
    "/static/manifest.json": { version: "v-abc" },
    [`/static/v-abc/partners/${partnerShardOf("krenko-mob-boss")}.json`]: { "krenko-mob-boss": KRENKO },
  });
  expect(await loadCardPage("some-other-card", "/static", f as unknown as typeof fetch)).toBeNull();
});

test("the name index comes back as written, and an absent one is empty rather than fatal", async () => {
  const index = [{ slug: "krenko-mob-boss", name: "Krenko, Mob Boss", identity: ["R"], commander: true }];
  const f = fetchOf({ "/static/manifest.json": { version: "v-abc" }, "/static/v-abc/name-index.json": index });
  expect(await loadNameIndex("/static", f as unknown as typeof fetch)).toEqual(index);
  const empty = fetchOf({ "/static/manifest.json": { version: "v-abc" } });
  expect(await loadNameIndex("/static", empty as unknown as typeof fetch)).toEqual([]);
});
