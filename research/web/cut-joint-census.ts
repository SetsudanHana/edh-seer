import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS } from "@edh-seer/data";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
import { buildEngineModel } from "../../packages/web/client/src/lib/engine-model.js";
import { chooseCuts, type CutChoice } from "../../packages/web/client/src/lib/cut-choice.js";
import { lossIn, pickTogether, tokenMakersOf } from "../../packages/web/client/src/lib/cut-together.js";

/** DO THE CUTS HOLD TOGETHER? (#1153). For the calibration decks plus the first-cuts seat's Krenko
 *  108: the cuts that read "Cutting it loses nothing" on their own, and how many of those lose a link
 *  once every other card in the same list is cut too -- a link whose only other givers are on that
 *  list. At 100 the list is "Nothing argues for keeping these"; over 100 it is the counted cuts.
 *  `alone` is the per-card reading the page used before #1153; `shown` is the group `CutList` now
 *  shows, picked with `pickTogether`, read against itself. `shown` must lose nothing.
 *
 *    STATIC=https://edhseer.cards/static npx tsx research/web/cut-joint-census.ts
 */
const STATIC = process.env.STATIC ?? "https://edhseer.cards/static";
const files = [
  ...readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort().map((f) => join(CALIBRATION_DECKS, f)),
  "packages/cli/decks/first-deck-108.txt",
];
// CutList's own split: a card is argued for when a real keep reason or a lost link speaks for it.
const realKeeps = (c: CutChoice) => c.row ? c.keeps.filter((k) => !/^its strongest link: /.test(k) && !/^it scores \d+(?:\.\d+)? for synergy/.test(k)) : c.keeps;
const argued = (c: CutChoice) => realKeeps(c).length > 0 || (c.row?.loses.length ?? 0) > 0;
let decks = 0, free = 0, broken = 0, shownFree = 0, shownBroken = 0;
for (const file of files) {
  const data = await analyzeDeckStatic(readFileSync(file, "utf8"), undefined, STATIC);
  const { report, graph } = data;
  const m = graph ? buildEngineModel(report, graph) : null;
  const cuts = chooseCuts(report, m && m.totalLinks ? m : null);
  const clear = cuts.filter((c) => c.row && !argued(c));
  const set = new Set(clear.map((c) => c.name));
  const lost = clear.map((c) => ({ c, links: c.row!.covers.filter((x) => x.by.every((n) => set.has(n))) })).filter((x) => x.links.length);
  const makers = tokenMakersOf(m);
  const picked = pickTogether(clear, Infinity, makers);
  const shown = clear.filter((c) => picked.has(c.name));
  const shownLost = shown.filter((c) => lossIn(c, picked, makers)?.length);
  decks++; free += clear.length; broken += lost.length; shownFree += shown.length; shownBroken += shownLost.length;
  const name = file.split("/").pop()!.replace(/\.txt$/, "");
  console.log(`${name} (${data.totalCount}): ${clear.length} loses-nothing${lost.length ? ` | ${lost.length} lose a link cut together: ${lost.map((x) => `${x.c.name} (${x.links.length}, by ${[...new Set(x.links.flatMap((l) => l.by))].join("/")})`).join("; ")}` : ""}`);
}
console.log(`${decks} decks: ${free} cuts read "loses nothing" alone; ${broken} of them lose a link when the rest of their list is cut too`);
console.log(`shown together: ${shownFree} cuts in the loss-free group; ${shownBroken} of them lose a link cut together`);
