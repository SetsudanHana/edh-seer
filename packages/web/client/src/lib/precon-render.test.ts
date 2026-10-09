import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { renderPreconIndex, renderPreconPage } from "../../../functions/_shared/render-precon.js";
import { preconDataSlug, preconPageHtml, type PreconIndexEntry } from "./precon-html.js";
import type { PreconPage } from "./precon-page.js";

const shell = readFileSync(join(import.meta.dirname, "..", "..", "index.html"), "utf8");
const page: PreconPage = {
  slug: "party-time-baldurs-gate", name: "Party Time", setCode: "CLB", setName: "Battle for Baldur's Gate", releaseDate: "2022-06-10",
  commanders: ["Nalia de'Arnise"], identity: ["W", "B"], theme: "Cleric tribal", synergy: { score: 2.9, band: "Developing" },
  bracket: { band: "1-2", gameChangers: 0, combos: 0 }, commanderLinks: 19,
  swaps: [{ out: { name: "Stick Together", connections: 13 }, in: { name: "Pious Evangel", slug: "pious-evangel", connections: 42, reason: "Pious Evangel <b>gains</b> life" } }],
  route: null, gaps: [{ group: "Ramp", have: 9, target: 11 }], build: { score: 3.6, band: "Close" },
  decklist: [{ group: "Creatures", cards: [{ name: "Burakos, Party Leader", count: 1 }] }, { group: "Lands", cards: [{ name: "Plains", count: 10 }] }],
  report: "/#deck=abc",
  packages: [{
    target: 2, from: "1-2", bringDown: [], after: { band: "1-2", synergy: 3.3, mana: 0.1, build: 4.2, short: [] },
    sections: [{ id: "synergy", swaps: [{ kind: "synergy", out: { name: "Stick Together", reason: "Stick Together works with 13 cards in this deck." }, in: { name: "Pious Evangel", reason: "Pious Evangel <b>gains</b> life" } }] }],
  }],
  unreachable: [3],
  packageCards: { "Pious Evangel": { name: "Pious Evangel", slug: "pious-evangel" } },
};
const index: PreconIndexEntry[] = [
  { slug: page.slug, name: page.name, setCode: "CLB", setName: page.setName, releaseDate: page.releaseDate, commanders: page.commanders, identity: page.identity, theme: page.theme },
  { slug: "draconic-dissent-baldurs-gate", name: "Draconic Dissent", setCode: "CLB", setName: page.setName, releaseDate: page.releaseDate, commanders: ["Firkraag, Cunning Instigator"], identity: ["U", "R"], theme: null },
];
function assets(files: Record<string, unknown>) {
  return {
    fetch: async (input: Request | string) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname;
      if (path === "/index.html") return new Response(shell);
      return path in files ? new Response(JSON.stringify(files[path])) : new Response("no", { status: 404 });
    },
  };
}
const site = assets({ "/static/manifest.json": { version: "v-1", precons: "p-abc" }, "/static/v-1/precons/p-abc/index.json": index, [`/static/v-1/precons/p-abc/${page.slug}.json`]: page });

test("a precon page is served with its own head, its crawler block and its record", async () => {
  const res = await renderPreconPage(new Request(`https://edhseer.cards/precons/${page.slug}`), site, page.slug);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("<title>Party Time precon upgrades — Battle for Baldur&#39;s Gate — EDH Seer</title>".replace("&#39;", "'"));
  expect(html).toContain(`<link rel="canonical" href="https://edhseer.cards/precons/${page.slug}" />`);
  expect(html).not.toContain('name="robots" content="noindex"');
  expect(html).toContain(`data-slug="${preconDataSlug(page.slug)}"`);
  expect(html).toContain('<a href="/precons/draconic-dissent-baldurs-gate">Draconic Dissent</a>');
  // The package is there, by bracket and section, and the engine's sentence is escaped, never markup.
  expect(html).toContain("<h2>Upgrades at bracket 1–2</h2>");
  expect(html).toContain("<h3>Cards that work together</h3>");
  expect(html).toContain('Take out Stick Together: Stick Together works with 13 cards in this deck. Put in <a href="/cards/pious-evangel">Pious Evangel</a>: Pious Evangel &lt;b&gt;gains&lt;/b&gt; life');
  expect(html).toContain("No swaps bring this deck to bracket 3");
  // The effect of the swaps, in words, and the synergy change said once.
  expect(html).toContain("synergy 2.9 → 3.3 of 5, from developing to connected.");
  expect(html).toContain("Build 3.6 → 4.2 of 5, from close to on target; no longer short on ramp");
  expect(html).not.toContain("synergy score goes from");
  expect(res.headers.get("x-robots-tag")).toBeNull();
});

test("a slug the index does not hold is a real 404 that asks not to be indexed", async () => {
  const res = await renderPreconPage(new Request("https://edhseer.cards/precons/nope"), site, "nope");
  expect(res.status).toBe(404);
  expect(await res.text()).toContain('name="robots" content="noindex"');
});

test("an artifact that did not load is degraded to the shell, never called missing", async () => {
  const res = await renderPreconPage(new Request(`https://edhseer.cards/precons/${page.slug}`), assets({}), page.slug);
  expect(res.status).toBe(200);
});

test("a manifest with no precons pointer serves the shell, not a page", async () => {
  const noPointer = assets({ "/static/manifest.json": { version: "v-1" }, "/static/v-1/precons/index.json": index, [`/static/v-1/precons/${page.slug}.json`]: page });
  const res = await renderPreconPage(new Request(`https://edhseer.cards/precons/${page.slug}`), noPointer, page.slug);
  expect(res.status).toBe(200);
  expect(await res.text()).not.toContain(`data-slug="${preconDataSlug(page.slug)}"`);
});

test("the precon list links every precon, sets newest first", async () => {
  const html = await (await renderPreconIndex(new Request("https://edhseer.cards/precons"), site)).text();
  expect(html).toContain('<a href="/precons/party-time-baldurs-gate">Party Time</a>');
  expect(html).toContain('<a href="/precons/draconic-dissent-baldurs-gate">Draconic Dissent</a>');
});

test("the crawler block carries names and the engine's sentences, never card rules text", () => {
  const html = preconPageHtml(page, index);
  expect(html).toContain("<h1>Party Time</h1>");
  expect(html).toContain("10 Plains");
  expect(html).toContain('<a href="/commanders/nalia-dearnise">');
});
