import { readFileSync, readdirSync } from "node:fs";
import { parseDecklistSections } from "../../packages/data/src/index.js";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
let decks = 0, withCombo = 0, combos = 0, withPay = 0, pay = new Set<string>(), planned = 0;
const eff: Record<string, number> = {};
for (const f of readdirSync("packages/cli/decks/calibration").filter((f) => f.endsWith(".txt"))) {
  const s = parseDecklistSections(readFileSync(`packages/cli/decks/calibration/${f}`, "utf8"));
  let r: any;
  for (let a = 0; ; a++) { try { r = await analyzeDeckStatic(s.deck.join("\n"), s.commanders.join("\n"), "https://edhseer.cards/static"); break; } catch (e) { if (a > 4) throw e; await new Promise((res) => setTimeout(res, 2000 * 2 ** a)); } }
  const cs = r.report.combos.filter((c: any) => c.cards.length >= 2);
  decks++; if (cs.length) withCombo++;
  combos += cs.length;
  for (const c of cs) if (c.payoffs?.length) { withPay++; for (const p of c.payoffs) { pay.add(`${f}:${p.name}`); eff[p.effect] = (eff[p.effect] ?? 0) + 1; } }
  if (r.report.deckMath?.wincons?.classes?.find((x: any) => x.class === "combo")?.payoffs?.length) planned++;
}
console.log({ decks, withCombo, combos, withPay, payoffCards: pay.size, decksWithComboPayoffsInPlan: planned, effects: eff });
