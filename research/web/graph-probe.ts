/** THE GRAPH'S NUMBERS, WHICH `ui-review-capture.ts` CANNOT REACH.
 *
 *  The capture's `measure` list is CSS selectors, and the board is a <canvas> -- so `svg circle`
 *  in `runs/deck-report.json` matches the site LOGO (two interactive circles, 5px and 7px, on
 *  every step) and not one board node. The single defect that selector exists to catch is
 *  precisely the one it cannot see: node radius 3.5 SIMULATED against 14 PAINTED, which every
 *  automated gate passed.
 *
 *  `GraphView` already exposes `canvas.__graphProbe()` -- the live simulation state, not a
 *  reimplementation of it. This reads it at both review widths and prints the pairing a persona's
 *  "the dots are too small to tell apart" has to be reconciled against: what the simulation thinks
 *  a node is, what the camera multiplies it by, and what therefore lands on the glass.
 *
 *    npx tsx research/web/graph-probe.ts            # both servers up, from the repo root
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS, DECKS_DIR, parseDecklistSections } from "../../packages/data/src/index.js";
import { encodeShare } from "../../packages/web/client/src/lib/share-link.js";

const decks = [
  join(DECKS_DIR, "precon-party-time.txt"),
  join(CALIBRATION_DECKS, "inalla.txt"),
  join(CALIBRATION_DECKS, "yuna-grand-summoner.txt"),
];
async function main() {
const b = await chromium.launch();
for (const f of decks) {
  const d = parseDecklistSections(readFileSync(f, "utf8"));
  const payload = await encodeShare({ commanders: d.commanders.join("\n"), decklist: d.deck.join("\n") });
  // `hasTouch` ON THE PHONE, FOR THE REASON `ui-review-capture.ts` NOW CARRIES IN FULL: a bare
  // narrow viewport reports `pointer: coarse` false and `any-pointer: fine` true, so `useBoardMode`
  // hands it the desktop BOARD and this probe measures a surface no phone ever gets.
  for (const [label, ctxOpts] of [
    ["desktop", { viewport: { width: 1920, height: 1080 } }],
    ["phone", { viewport: { width: 390, height: 844 }, hasTouch: true }],
  ] as const) {
    const ctx = await b.newContext({ ...ctxOpts, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:5173/analysis/graph#deck=${payload}`);
    await p.waitForTimeout(6000);
    const out = await p.evaluate(() => {
      const c = document.querySelector("canvas") as (HTMLCanvasElement & { __graphProbe?: () => any }) | null;
      if (!c) return { error: "no canvas" };
      if (!c.__graphProbe) return { error: "no probe" };
      const nodes = c.__graphProbe();
      const rect = c.getBoundingClientRect();
      const z = (nodes as any).camZ as number;
      const r = nodes[0]?.r ?? null;
      const xs = nodes.map((n: any) => n.x), ys = nodes.map((n: any) => n.y);
      // painted radius in CSS px = simulated r * camera zoom
      const painted = r === null ? null : r * z;
      // how many node centres land outside the visible canvas box
      const cx = rect.width / 2, cy = rect.height / 2;
      // SPLIT BY DEGREE, because `fitToView` frames the CONNECTED cluster on purpose -- an orphan
      // with no synergy edge is ALLOWED to sit outside the frame, and counting it as a fit defect
      // is reading a deliberate choice as a bug.
      const outside = nodes.filter((n: any) => {
        const sx = cx + n.x * z, sy = cy + n.y * z;
        return sx < 0 || sy < 0 || sx > rect.width || sy > rect.height;
      });
      const off = outside.length;
      const offConnected = outside.filter((n: any) => n.deg > 0).length;
      const offNames = outside.map((n: any) => `${n.id} (deg ${n.deg})`);
      // closest pair of node centres in painted px, as an overlap proxy
      let min = Infinity;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const dx = (nodes[i].x - nodes[j].x) * z, dy = (nodes[i].y - nodes[j].y) * z;
        const dd = Math.hypot(dx, dy); if (dd < min) min = dd;
      }
      const edges = (nodes as any).edges as any[];
      return {
        canvasCssPx: { w: Math.round(rect.width), h: Math.round(rect.height) },
        nodes: nodes.length, edges: edges.length, fits: (nodes as any).fits,
        simulatedRadius: r, camZ: Number(z.toFixed(3)), paintedRadiusCssPx: painted === null ? null : Number(painted.toFixed(2)),
        paintedDiameterCssPx: painted === null ? null : Number((painted * 2).toFixed(2)),
        nodeCentresOutsideCanvas: off,
        outsideWithAnEdge: offConnected,
        outside: offNames,
        closestNodeCentrePairPaintedPx: Number(min.toFixed(2)),
        boardExtentPaintedPx: {
          w: Number(((Math.max(...xs) - Math.min(...xs)) * z).toFixed(0)),
          h: Number(((Math.max(...ys) - Math.min(...ys)) * z).toFixed(0)),
        },
      };
    });
    console.log(f.split("/").pop(), label, JSON.stringify(out));
    await ctx.close();
  }
}
await b.close();
}
void main();
