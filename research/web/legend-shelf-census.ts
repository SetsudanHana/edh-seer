import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS } from "../../packages/data/src/deck-paths.js";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
import { PAINT_MODES, paintLegend } from "../../packages/web/client/src/components/presets.js";

/** THE MAP LEGEND vs THE ROLES SHELF, PER PARENT (#1172). For each deck and each build parent, the
 *  legend's Role-mode count (`paintLegend` over the graph nodes) against the shelf's
 *  (`report.buildParents[].count`). Prints every deck where they differ, then per-parent totals.
 *  DIAG=1 also prints which cause explains each difference: faces counted as two nodes, copies,
 *  token nodes.
 *
 *    STATIC=https://edhseer.cards/static npx tsx research/web/legend-shelf-census.ts
 */
const STATIC = process.env.STATIC ?? "https://edhseer.cards/static";
const GROUP_OF_PARENT: Record<string, string> = { consistency: "cardAdvantage", ramp: "ramp", interaction: "interaction", boardWipes: "boardWipes" };
const role = PAINT_MODES.find((m) => m.id === "role")!;
const files = [
  ...readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort().map((f) => join(CALIBRATION_DECKS, f)),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `packages/cli/decks/${n}.txt`),
];
type N = Parameters<typeof paintLegend>[1][number];
const count = (nodes: readonly N[], group: string): number => paintLegend(role, nodes).find((r) => r.value === group)?.count ?? 0;
const perParent: Record<string, number> = {};
const cause: Record<string, number> = { faces: 0, copies: 0, tokens: 0, other: 0 };
let decks = 0, differing = 0;
for (const file of files) {
  const { report, graph } = await analyzeDeckStatic(readFileSync(file, "utf8"), undefined, STATIC);
  const nodes = (graph?.nodes ?? []) as unknown as (N & { id: string; cardName?: string; face?: number })[];
  const parents = (report as unknown as { buildParents?: { key: string; count: number }[] }).buildParents ?? [];
  decks++;
  let any = false;
  for (const p of parents) {
    const g = GROUP_OF_PARENT[p.key];
    if (!g) continue;
    const legend = count(nodes, g), shelf = p.count;
    if (legend === shelf) continue;
    any = true; perParent[p.key] = (perParent[p.key] ?? 0) + 1;
    let why = "";
    if (process.env.DIAG) {
      const noTok = nodes.filter((n) => !n.id.startsWith("token:"));
      const oneCopy = noTok.map((n) => ({ ...n, copies: 1 }));
      const noFace = oneCopy.filter((n) => n.face === undefined || n.face === 0);
      const tokens = legend - count(noTok, g);
      const copies = count(noTok, g) - count(oneCopy, g);
      const faces = count(oneCopy, g) - count(noFace, g);
      const rest = count(noFace, g) - shelf;
      if (tokens) cause.tokens++; if (copies) cause.copies++; if (faces) cause.faces++; if (rest) cause.other++;
      why = ` [tokens ${tokens}, copies ${copies}, faces ${faces}, rest ${rest}]`;
    }
    console.log(`${p.key} ${file.split("/").pop()}: legend ${legend} | shelf ${shelf}${why}`);
  }
  if (any) differing++;
}
console.log(`${decks} decks, ${differing} where any parent differs; per parent: ${JSON.stringify(perParent)}${process.env.DIAG ? `; decks-cells explained by ${JSON.stringify(cause)}` : ""}`);
