// LOCAL RESEARCH ONLY (#726): each calibration deck's Spellbook combos and its producer->consumer reasons.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseDecklistSections } from "../../packages/data/src/index.js";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
const out: unknown[] = [];
for (const f of readdirSync("packages/cli/decks/calibration").filter((f) => f.endsWith(".txt"))) {
  const s = parseDecklistSections(readFileSync(`packages/cli/decks/calibration/${f}`, "utf8"));
  let r: any;
  for (let a = 0; ; a++) {
    try { r = await analyzeDeckStatic(s.deck.join("\n"), s.commanders.join("\n"), "https://edhseer.cards/static"); break; }
    catch (e) { if (a > 4) throw e; await new Promise((res) => setTimeout(res, 2000 * 2 ** a)); }
  }
  const rep = r.report;
  const reasons = (rep.edges ?? []).flatMap((p: any) => (p.reasons ?? []).map((x: any) => ({
    p: x.producer, c: x.consumer, tag: x.tag, rep: x.repeatability, kind: x.effectKind, ca: x.consumerAbility, pa: x.producerAbility, implied: x.impliedProducer ?? false, text: x.text,
  })));
  out.push({ id: f.replace(".txt", ""), commanders: s.commanders, combos: rep.combos ?? [], reasons,
    cards: (r.graph?.nodes ?? []).filter((n: any) => n.typeLine).map((n: any) => ({ n: n.label, t: n.typeLine, o: n.oracleText ?? "" })) });
  process.stdout.write(`${f} combos ${(rep.combos ?? []).length} reasons ${reasons.length}\n`);
}
writeFileSync("research/combos/decks.json", JSON.stringify(out));
