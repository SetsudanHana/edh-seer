import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { encodeShare } from "../../packages/web/client/src/lib/share-link.js";
import { parseDecklistSections } from "../../packages/data/src/index.js";

/** THE GLANCE MAP ON A PHONE, COUNTED (#986). At 390px, for each deck: the discs drawn, how many
 *  carry a visible name, and how many visible names overlap a disc other than their own. Run against
 *  a local Vite server:
 *
 *    npx tsx research/web/map-phone-census.ts [deck.txt ...] [--shots <dir>]
 */
const args = process.argv.slice(2);
const shotsAt = args.indexOf("--shots");
const shots = shotsAt >= 0 ? args.splice(shotsAt, 2)[1] : undefined;
const decks = args.length ? args : ["packages/cli/decks/calibration/inalla.txt", "packages/cli/decks/gisa.txt", "packages/cli/decks/calibration/enchanting-rani.txt", "packages/cli/decks/first-deck-108.txt"];
/** What one look at the map counts. Module-level and passed by reference: tsx's __name helper
 *  wraps named functions, and nothing named may be declared INSIDE the page. */
const measure = () => {
    // THE ONE MAP ON SCREEN: the largest visible svg in the Glance chapter that draws cards.
    const svg = [...document.querySelectorAll<SVGSVGElement>("#read svg")].filter((v) => v.querySelector(".constellation-node") && v.getBoundingClientRect().width > 1)
      .sort((a, c) => c.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!svg) return { drawn: 0, unique: 0, named: 0, overlaps: 0, hint: false };
    // A disc is its art (the node group's box includes the glow); visible and not faded out.
    const discs = [...svg.querySelectorAll<SVGGElement>(".constellation-node")].filter((g) => Number(getComputedStyle(g).opacity) > 0.3)
      .map((g) => ({ id: g.dataset.id, b: (g.querySelector("image") ?? g).getBoundingClientRect() })).filter((d) => d.b.width > 1);
    const unique = new Set(discs.map((d) => d.id)).size;
    const labels = [...svg.querySelectorAll<SVGTextElement>(".constellation-label")].filter((t) => t.style.display !== "none" && Number(t.getAttribute("opacity") ?? 1) > 0.3 && t.getBoundingClientRect().width > 1);
    let overlaps = 0;
    for (const t of labels) {
      const tb = t.getBoundingClientRect();
      // Its own disc sits directly above it, centred on the same x. Inline, never a named arrow:
      // tsx's __name helper does not exist inside the page.
      const own = discs.filter((d) => Math.abs((d.b.left + d.b.right) / 2 - (tb.left + tb.right) / 2) < 3 && d.b.bottom <= tb.top + 4)
        .sort((a, c) => (tb.top - a.b.bottom) - (tb.top - c.b.bottom))[0];
      if (discs.some((d) => d !== own && tb.left < d.b.right && tb.right > d.b.left && tb.top < d.b.bottom && tb.bottom > d.b.top)) overlaps++;
    }
    svg.scrollIntoView({ block: "center" });
    return { drawn: discs.length, unique, named: labels.length, overlaps, hint: /tap a card/i.test(svg.parentElement?.parentElement?.textContent ?? "") };
  };

const b = await chromium.launch();
for (const file of decks) {
  const { commanders, deck } = parseDecklistSections(readFileSync(file, "utf8"));
  const payload = await encodeShare({ commanders: commanders.join("\n"), decklist: deck.join("\n") });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await p.goto(`${process.env.BASE ?? "http://localhost:5173"}/#deck=${payload}`);
  await p.waitForSelector("#stand", { timeout: 120000 });
  await p.waitForTimeout(3000);
  const first = await p.evaluate(measure);
  // A WALK, TWICE (review of #986): tap a named partner to point at it, tap again to put it in the
  // middle, then once more from there. Cards the old middle drew must not stay as unnamed dots.
  for (let step = 0; step < 2; step++) {
    const target = p.locator("#read .constellation-node:visible").nth(1);
    await target.click({ force: true }); await p.waitForTimeout(400);
    await target.click({ force: true }); await p.waitForTimeout(2500);
  }
  const walked = await p.evaluate(measure);
  const name = file.split("/").pop()!.replace(/\.txt$/, "");
  for (const [when, r] of [["first", first], ["walked", walked]] as const) {
    console.log(`${name} (${when}): ${r.drawn} discs drawn (${r.unique} cards), ${r.named} named, ${r.drawn - r.named} unnamed, ${r.overlaps} names over another disc, tap hint ${r.hint ? "yes" : "no"}`);
  }
  if (shots) { await p.waitForTimeout(500); await p.screenshot({ path: `${shots}/map-${name}.png` }); }
  await p.close();
}
await b.close();
