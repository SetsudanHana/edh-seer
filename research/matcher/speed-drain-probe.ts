import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS } from "@edh-seer/data";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";

/** WHAT A DRAIN'S TRIGGER IS JOINED TO, in one real deck (#1056, R5). Prints every reason whose
 *  consumer is the named card: tag, producer, which ability on each side, the token flag and the
 *  edge magnitude. The drain route's source count is built from exactly these fields, so it is read
 *  off a real analysis before it is written.
 *
 *    npx tsx research/matcher/speed-drain-probe.ts inalla "Impact Tremors"
 */
const STATIC = process.env.STATIC ?? "https://edhseer.cards/static";

async function main(): Promise<void> {
  const [deckName, card] = process.argv.slice(2);
  if (!deckName || !card) throw new Error("usage: speed-drain-probe.ts <calibration deck> <card name>");
  const list = readFileSync(join(CALIBRATION_DECKS, `${deckName}.txt`), "utf8");
  const { report } = await analyzeDeckStatic(list, undefined, STATIC);
  const rows = report.edges.flatMap((e) => e.reasons).filter((r) => r.consumer === card);
  for (const r of rows) {
    console.log([
      r.tag, `<- ${r.producer}${r.producerIsToken ? " [token]" : ""}`,
      `pAb=${r.producerAbility ?? "-"} cAb=${r.consumerAbility ?? "-"}`,
      r.magnitude ? `mag=${JSON.stringify(r.magnitude)}` : "mag=default",
      r.repeatability ?? "", r.perTurn ? "perTurn" : "",
    ].join("  "));
  }
  console.log(`${rows.length} reasons into ${card}`);
  console.log(JSON.stringify(report.deckMath?.wincons.classes.find((c) => c.class === "burn")));
}

main().catch((e) => { console.error(e); process.exit(1); });
