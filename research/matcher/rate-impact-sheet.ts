/** THE JUDGING SHEET FOR RATE ON THE CARD SCORE (roadmap Y9, 2026-09-18). Reads two
 *  `ratings-compare --save` snapshots (rateWeight 0 and 0.5) and the built facet index, and prints
 *  per deck the top ten after, each with its rating before -> after and the card's best rate as
 *  the search tile prints it, so the owner can say whether the moves read right. One-shot; prints.
 *
 *  Usage: tsx research/matcher/rate-impact-sheet.ts before.json after.json static-out/<version>/facet-index.json */
import { readFileSync } from "node:fs";
import { slugOf } from "../../packages/matcher/src/bin/partners-core.js";
import type { FacetRow } from "../../packages/matcher/src/bin/facet-index-core.js";

type Snap = { deck: string; cards: Record<string, { rating: number; score: number }> }[];
const [beforePath, afterPath, facetPath] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforePath!, "utf8")) as Snap;
const after = JSON.parse(readFileSync(afterPath!, "utf8")) as Snap;
const rows = new Map((JSON.parse(readFileSync(facetPath!, "utf8")) as FacetRow[]).map((r) => [r.s, r]));

const label = (r: FacetRow | undefined): string => {
  if (!r?.r) return "no rate";
  return Object.entries(r.r).map(([family, s]) => {
    const [floor, floorMana, ceiling, ceilingMana, delayed] = s!;
    const span = ceiling === null ? `${floor}+` : ceiling === floor ? `${floor}` : `${floor}–${ceiling}`;
    const then = ceiling !== null && ceilingMana !== floorMana ? `, then ${ceiling} / ${ceilingMana}` : "";
    return `${family} ${span}${family === "tokens" && r.z ? ` (${r.z})` : ""} / ${floorMana}${then}${delayed ? " next turn" : ""}`;
  }).join("; ");
};

let topChanged = 0;
for (const a of after) {
  const b = before.find((d) => d.deck === a.deck)!;
  // Ranked by the RAW score, the order analyze.ts itself sorts by; a rating is score / deck max
  // and ties at 5.0. A card whose raw score did not move but whose rating did is a
  // RENORMALISATION (another card moved the max), marked `norm`, never UP or DOWN.
  const rank = (deck: typeof a) => Object.entries(deck.cards).sort((x, y) => y[1].score - x[1].score).map(([n]) => n);
  const ra = rank(a), rb = rank(b);
  if (ra[0] !== rb[0]) topChanged++;
  console.log(`\n## ${a.deck}${ra[0] !== rb[0] ? `   TOP: ${rb[0]} -> ${ra[0]}` : ""}`);
  for (const name of ra.slice(0, 10)) {
    const was = rb.indexOf(name) + 1;
    const cB = b.cards[name], cA = a.cards[name]!;
    const rB = cB?.rating ?? 0, rA = cA.rating;
    const raw = cB ? cA.score / cB.score : 1;
    const mark = Math.abs(raw - 1) < 1e-9 ? (Math.abs(rA - rB) > 0.05 ? "norm" : "    ") : raw > 1 ? "UP  " : "DOWN";
    console.log(`  ${mark} ${String(rB.toFixed(1)).padStart(4)} -> ${String(rA.toFixed(1)).padStart(4)}  (#${String(was).padStart(2)} before, raw x${raw.toFixed(2)})  ${name.padEnd(34)} ${label(rows.get(slugOf(name)))}`);
  }
}
console.log(`\ntop card changed in ${topChanged} of ${after.length} decks`);
