import { readFileSync } from "node:fs";
import { parseDecklistSections } from "../../packages/data/src/index.js";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
for (const f of (process.argv[2] ?? "acererak-combo,gogo-trying-to-combo-off,enchanting-rani").split(",")) {
  const s = parseDecklistSections(readFileSync(`packages/cli/decks/calibration/${f}.txt`, "utf8"));
  let r: any;
  for (let a = 0; ; a++) { try { r = await analyzeDeckStatic(s.deck.join("\n"), s.commanders.join("\n"), "https://edhseer.cards/static"); break; } catch (e) { if (a > 4) throw e; await new Promise((res) => setTimeout(res, 2000 * 2 ** a)); } }
  const rep = r.report;
  console.log(`## ${f}: ${rep.combos.length} combos`);
  for (const c of rep.combos.slice(0, 4)) console.log("  ", c.cards.join(" + "), "->", (c.payoffs ?? []).map((p: any) => `${p.name} (${p.effect} on ${p.on.join("/")})`).join(", ") || "no payoff");
  const combo = rep.deckMath?.wincons?.classes?.find((x: any) => x.class === "combo");
  console.log("   win plan combo payoffs:", combo?.payoffs);
  console.log("   cut list protections mentioning combos:", (rep.cutList ?? []).filter((x: any) => (x.protections ?? []).some((p: string) => /combo/.test(p))).length);
}
