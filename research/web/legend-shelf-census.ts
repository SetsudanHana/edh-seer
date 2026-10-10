import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS } from "../../packages/data/src/deck-paths.js";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";

/** NAME-COLLISION ROLE LOSS (#1172). A deck can hold a real card whose name equals one FACE of
 *  another card in the deck (Rampant Growth beside "Studious First-Year // Rampant Growth";
 *  Brainstorm beside "... // Brainstorm"). The report's per-card roles join on the face name, so the
 *  real card's graph node ends up with no roles although `detectBuildCategories` (the Roles shelf)
 *  counts it. Per build parent, this counts the distinct physical cards whose graph node carries
 *  one of the parent's leaves against `report.buildParents[].count`; every deck where they differ
 *  is printed with the colliding names. (Born as the map-legend vs shelf census; the legend itself
 *  had no caller and was deleted, and its face-node double-count with it.)
 *
 *    STATIC=https://edhseer.cards/static npx tsx research/web/legend-shelf-census.ts
 */
const STATIC = process.env.STATIC ?? "https://edhseer.cards/static";
const files = [
  ...readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort().map((f) => join(CALIBRATION_DECKS, f)),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `packages/cli/decks/${n}.txt`),
];
type Node = { id: string; cardName?: string; roles?: string[] };
let decks = 0, affected = 0, cells = 0;
for (const file of files) {
  const { report, graph } = await analyzeDeckStatic(readFileSync(file, "utf8"), undefined, STATIC);
  const nodes = (graph?.nodes ?? []) as unknown as Node[];
  const parents = (report as unknown as { buildParents?: { key: string; count: number; leaves: string[] }[] }).buildParents ?? [];
  // A name that is one face of a multi-face node AND a node of its own.
  const faceNames = new Set(nodes.filter((n) => n.id.includes(" // ")).flatMap((n) => n.id.split(" // ")));
  const colliding = nodes.filter((n) => !n.id.includes(" // ") && !n.id.startsWith("token:") && faceNames.has(n.id)).map((n) => n.id);
  decks++;
  const diffs: string[] = [];
  for (const p of parents) {
    const physical = new Set(nodes.filter((n) => (n.roles ?? []).some((r) => p.leaves.includes(r))).map((n) => n.cardName ?? n.id));
    if (physical.size !== p.count) diffs.push(`${p.key} nodes ${physical.size} | shelf ${p.count}`);
  }
  if (diffs.length || colliding.length) {
    if (diffs.length) affected++;
    cells += diffs.length;
    console.log(`${file.split("/").pop()}: ${diffs.join("; ") || "no count difference"}${colliding.length ? ` [colliding: ${colliding.join(", ")}]` : ""}`);
  }
}
console.log(`${decks} decks: ${affected} where a parent's node count differs from the shelf (${cells} parent cells)`);
