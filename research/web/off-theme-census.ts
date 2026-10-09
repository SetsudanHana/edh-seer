import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS } from "@edh-seer/data";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
import { buildEngineModel } from "../../packages/web/client/src/lib/engine-model.js";
import { chooseCuts } from "../../packages/web/client/src/lib/cut-choice.js";
import { primaryType } from "../../packages/web/client/src/lib/deck-shape.js";
import { themeMatrix } from "../../packages/web/client/src/lib/theme-matrix.js";
import { unreadCardNames } from "../../packages/web/client/src/lib/unread.js";
import { offThemeSplit } from "../../packages/web/client/src/lib/off-theme.js";

/** "FITS NO THEME", MEASURED (#1085). For the calibration decks plus the first-cuts seat's Krenko
 *  108: the cards the line offered before (every off-theme card) and how many of them fill a role at
 *  or under its target, or are removal or protection (`held`, no longer offered). Mirrors
 *  `ReportChapters`' own derivation of the list.
 *
 *    STATIC=https://edhseer.cards/static npx tsx research/web/off-theme-census.ts
 */
const STATIC = process.env.STATIC ?? "https://edhseer.cards/static";
const files = [
  ...readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort().map((f) => join(CALIBRATION_DECKS, f)),
  "packages/cli/decks/first-deck-108.txt",
];
let decks = 0, offered = 0, held = 0, decksWithHeld = 0;
for (const file of files) {
  const data = await analyzeDeckStatic(readFileSync(file, "utf8"), undefined, STATIC);
  const { report, graph } = data;
  const m = graph ? buildEngineModel(report, graph) : null;
  const themes = m && m.totalLinks ? m : null;
  const nonland = (graph?.nodes ?? [])
    .filter((n) => n.face === undefined && n.isToken !== true && n.isCompanion !== true && primaryType(n.types) !== null)
    .map((n) => n.cardName ?? n.id);
  const skip = new Set([...chooseCuts(report, themes).map((c) => c.name), ...unreadCardNames(report.cards)]);
  const offTheme = (themeMatrix(report.archetypes, nonland)?.unaffiliated ?? []).filter((n) => !skip.has(n));
  const split = offThemeSplit(offTheme, report);
  decks++; offered += offTheme.length; held += split.held.length; if (split.held.length) decksWithHeld++;
  if (file.includes("first-deck-108")) console.log(`krenko-108: before ${offTheme.join(", ")} | free ${split.free.join(", ") || "-"} | held ${split.held.join(", ")}`);
}
console.log(`${decks} decks: ${offered} off-theme cards offered before; ${held} of them held (role at/under target, or removal/protection) in ${decksWithHeld} decks; ${offered - held} still offered`);
