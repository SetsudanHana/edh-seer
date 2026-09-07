import { expect, test, vi } from "vitest";
import { partnerShardOf } from "@edh-seer/matcher/partners-core";
import { CARD_PAGE_DATA_ID } from "./inject.js";
import { inlineCardPage, loadCardPage, loadNameIndex } from "./partners.js";

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

/** THE INLINE RECORD, AND THE SLUG CHECK THAT MAKES IT SAFE.
 *
 *  The edge writes the served card into the document so the app needs no fetch -- which is what
 *  makes the page true for Googlebot's renderer, since `robots.txt` disallows `/static/` and the
 *  renderer will not fetch a disallowed subresource. Every card page rendered as `<NotFound />` in
 *  the DOM Google kept until this existed. */
const withTag = (slug: string, body: string): Document => {
  const d = document.implementation.createHTMLDocument("t");
  const el = d.createElement("script");
  el.type = "application/json";
  el.id = CARD_PAGE_DATA_ID;
  el.setAttribute("data-slug", slug);
  el.textContent = body;
  d.body.appendChild(el);
  return d;
};

test("the record in the document is used for the slug it names", () => {
  const d = withTag("krenko-mob-boss", JSON.stringify(KRENKO));
  expect(inlineCardPage("krenko-mob-boss", d)?.name).toBe("Krenko, Mob Boss");
});

/** THE ONE THAT WOULD NOT LOOK BROKEN. React Router navigates without reloading the document, so
 *  after a click on a partner link this tag still holds the card the reader ARRIVED on. Serving it
 *  then would render the wrong card under the right URL -- worse than the bug being fixed, because
 *  the page looks fine and only the content is a lie. */
test("a record for a different slug is refused, not reused", () => {
  const d = withTag("krenko-mob-boss", JSON.stringify(KRENKO));
  expect(inlineCardPage("impact-tremors", d)).toBeNull();
});

test("no tag, or one that will not parse, falls through to the network", async () => {
  expect(inlineCardPage("krenko-mob-boss", document.implementation.createHTMLDocument("t"))).toBeNull();
  expect(inlineCardPage("krenko-mob-boss", withTag("krenko-mob-boss", "{ not json"))).toBeNull();

  // And `loadCardPage` really does fall back rather than answering null: this is the path a dev
  // server, the SPA fallback and a degraded edge response all take.
  const f = fetchOf({
    "/static/manifest.json": { version: "v-abc" },
    [`/static/v-abc/partners/${partnerShardOf("krenko-mob-boss")}.json`]: { "krenko-mob-boss": KRENKO },
  });
  expect((await loadCardPage("krenko-mob-boss", "/static", f as unknown as typeof fetch))?.name)
    .toBe("Krenko, Mob Boss");
  expect(f).toHaveBeenCalled();
});

/** THE POINT OF THE WHOLE CHANGE, ASSERTED AS A NEGATIVE: when the document carries the record, the
 *  page makes NO request at all. A version that read the tag and fetched anyway would pass every
 *  test above and still leave Google rendering a 404. */
test("a page whose record is inline fetches nothing", async () => {
  const d = withTag("krenko-mob-boss", JSON.stringify(KRENKO));
  document.body.appendChild(d.getElementById(CARD_PAGE_DATA_ID)!);
  try {
    const f = fetchOf({});
    expect((await loadCardPage("krenko-mob-boss", "/static", f as unknown as typeof fetch))?.name)
      .toBe("Krenko, Mob Boss");
    expect(f).not.toHaveBeenCalled();
  } finally {
    document.getElementById(CARD_PAGE_DATA_ID)?.remove();
  }
});
