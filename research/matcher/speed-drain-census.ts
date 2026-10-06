import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS } from "@edh-seer/data";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";

/** THE SPEED ROUTES, MEASURED (#1056: R5 drain, R1 combat). For each of the 73 calibration decks plus the two persona
 *  decks that raised PB-3 (Gisa, Krenko's first-deck-108): the horizon (`deckMath.turn`,
 *  `turnSource`), the one-opponent `clock.turn`, and the new drain clock. Run on main and on the
 *  branch into two files; the first three fields must be byte-identical ("what must not move"), the
 *  drain clock is the new number.
 *
 *    npx tsx research/matcher/speed-drain-census.ts <out.json>
 */
const STATIC = process.env.STATIC ?? "https://edhseer.cards/static";
const EXTRA = ["packages/cli/decks/gisa.txt", "packages/cli/decks/first-deck-108.txt"];

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error("usage: speed-drain-census.ts <out.json>");
  const files = [
    ...readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort().map((f) => join(CALIBRATION_DECKS, f)),
    ...EXTRA,
  ];
  const rows: unknown[] = [];
  for (const file of files) {
    const { report } = await analyzeDeckStatic(readFileSync(file, "utf8"), undefined, STATIC);
    const m = report.deckMath;
    const speed = (m as { speed?: { drain?: unknown; combat?: unknown; commander?: unknown; prevented?: string; mill?: unknown } } | undefined)?.speed;
    rows.push({
      deck: file.split("/").pop()!.replace(/\.txt$/, ""),
      horizon: m ? { turn: m.turn, turnSource: m.turnSource, clock: m.clock.turn ?? null } : null,
      burn: m?.wincons.classes.find((c) => c.class === "burn")?.cards ?? [],
      drain: speed?.drain ?? null,
      combat: speed?.combat ?? null,
      commander: speed?.commander ?? null,
      prevented: speed?.prevented ?? null,
      mill: speed?.mill ?? null,
    });
    process.stderr.write(".");
  }
  writeFileSync(out, JSON.stringify(rows, null, 1));
  process.stderr.write(`\n${rows.length} decks -> ${out}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
