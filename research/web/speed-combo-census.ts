import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS } from "@edh-seer/data";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
import { fastestRoute, speedRoutes } from "../../packages/web/client/src/lib/speed.js";
import { tableTalk } from "../../packages/web/client/src/lib/table-talk.js";

/** THE COMBO ROUTE'S TURN, MEASURED (#1084). For the 73 calibration decks plus Inalla: the combo
 *  route (its cards, whether anything turns it into a win, its turn), the fastest route the "How you
 *  win" headline leads with, and the Say-this line. Counts the two defects the persona round found:
 *  a combo with no kill that is timed (and may lead), and a combo that kills but has no turn while
 *  the Say-this box gives another route's turn without saying the combo's is unknown.
 *
 *    STATIC=https://edhseer.cards/static npx tsx research/web/speed-combo-census.ts <out.json>
 */
const STATIC = process.env.STATIC ?? "https://edhseer.cards/static";
const EXTRA = ["packages/cli/decks/inalla.txt"];

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error("usage: speed-combo-census.ts <out.json>");
  const files = [
    ...readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort().map((f) => join(CALIBRATION_DECKS, f)),
    ...EXTRA,
  ];
  const rows: { deck: string; combo: unknown; fastest: unknown; say: string | null }[] = [];
  for (const file of files) {
    const data = await analyzeDeckStatic(readFileSync(file, "utf8"), undefined, STATIC);
    const mv = new Map<string, number>();
    for (const r of data.report.cards) if (r.manaValue !== undefined) { mv.set(r.name, r.manaValue); if (r.cardName) mv.set(r.cardName, r.manaValue); }
    const manaValueOf = (n: string) => mv.get(n);
    const routes = speedRoutes(data.report, manaValueOf);
    const combo = routes.find((r) => r.kind === "combo");
    const fastest = fastestRoute(routes);
    const talk = tableTalk(data.report, data.graph, manaValueOf);
    rows.push({
      deck: file.split("/").pop()!.replace(/\.txt$/, ""),
      combo: combo ? { cards: combo.cards, payoffs: combo.payoffs ?? [], turn: combo.turn ?? null, mana: combo.mana ?? null, caveat: combo.caveat } : null,
      fastest: fastest ? { kind: fastest.kind, turn: fastest.turn } : null,
      say: talk ? JSON.stringify(talk) : null,
    });
    process.stderr.write(".");
  }
  writeFileSync(out, JSON.stringify(rows, null, 1));
  process.stderr.write(`\n${rows.length} decks -> ${out}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
