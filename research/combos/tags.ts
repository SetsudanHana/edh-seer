// LOCAL RESEARCH ONLY (#726): every calibration card's abilities, compact.
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeName } from "../../packages/data/src/names.js";
import { StaticLookup } from "../../packages/matcher/src/static-lookup.js";
const D = JSON.parse(readFileSync("research/combos/decks.json", "utf8")) as any[];
const lookup = new StaticLookup("https://edhseer.cards/static", fetch);
const names = [...new Set(D.flatMap((d) => d.cards.map((c: any) => normalizeName(c.n))))];
for (let i = 0; i < names.length; i += 40) {
  for (let a = 0; ; a++) {
    try { await lookup.prefetch(names.slice(i, i + 40)); break; } catch (e) { if (a > 4) throw e; await new Promise((r) => setTimeout(r, 2000 * 2 ** a)); }
  }
}
const out: Record<string, unknown> = {};
for (const n of names) {
  const card = await lookup.findByName(n) as any;
  const tags = card ? await lookup.findOne(card._id) as any : null;
  if (!tags) continue;
  out[card.name] = (tags.abilities ?? []).map((a: any) => ({
    k: a.kind, rep: a.repeats ?? null, cost: a.cost ?? null, eff: a.effect?.kind ?? null, amt: a.amount ?? null,
    tv: a.trigger?.verbs ?? null, tsub: a.trigger?.subject ?? null, emits: (a.emits ?? []).map((e: any) => e.verb),
    unless: a.unless ?? null, delayed: a.delayedBy ?? null, threshold: a.threshold ?? null,
  }));
}
writeFileSync("research/combos/tags.json", JSON.stringify(out));
console.log(Object.keys(out).length, "cards with tags");
