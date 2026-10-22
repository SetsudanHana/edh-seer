// LOCAL RESEARCH ONLY (#1315): (1) identity proof -- re-derive every card with the CURRENT code and compare with the stored rows after stripping `host`;
// (2) how many commander-legal cards / abilities carry `host`, split Aura / Equipment / other; (3) the residue: Auras and Equipment whose oracle text says
// "enchanted|equipped <thing> gets|has|gains|loses|can't be blocked" and that derive no host ability, grouped by cause. DETAIL=<cause> lists its cards.
// FREE (reads Mongo, no model, writes nothing). Run from the repo root after `set -a && source packages/tagger/.env && set +a`: npx tsx research/tagger/host-census.ts  (2-4 minutes).
import { connect, loadConfig } from "@edh-seer/data";
import { deriveRow } from "../../packages/tagger/src/derive-worker.js";
const store = await connect(loadConfig());
const stored = new Map((await store.db.collection("cardTagsDerived").find({ isToken: { $ne: true } }).toArray()).map((d: any) => [d.oracleId, d]));
// A clause whose only action became a `restriction` loses the kindless placeholder ability the trigger head used to leave (Aragorn, Ahn-Crop Crasher): dropped on both sides.
const strip = (abilities: any[], restrictedClauses: Set<unknown>) => JSON.stringify(abilities.filter((a) => a.effect?.kind !== "restriction" && !(a.effect?.kind === "" && !a.emits && restrictedClauses.has(a.clause))).map((a) => { const { host: _h, grantedBy: _g, restricts: _r, ...rest } = a; return rest; })); // the fields and the kind added since the stored rows (369-373)
let gainedRestriction = 0, same = 0, diff = 0, legal = 0;
const cards = { aura: new Set<string>(), equipment: new Set<string>(), other: new Set<string>() };
const abil = { aura: 0, equipment: 0, other: 0 };
const kinds: Record<string, number> = {};
const HOST_KINDS = new Set(["pump", "debuff", "keyword-grant", "speed-increase", "type-grant", "ability-loss", "animate", "evasion"]);
const unmarked: Record<string, number> = {};
const residue: Record<string, string[]> = {};
const RECIP = /\b(?:enchanted|equipped) (?!player\b)[a-z]+\b(?!['’]s)[^.]*?\b(gets?|has|have|gains?|loses?|can['’]t be blocked|can['’]t have)\b/i;
for (const doc of await store.db.collection("cardClauses").find({ isToken: { $ne: true } }).toArray() as any[]) {
  const src = await store.cards.findOne({ _id: doc.oracleId } as never) as any;
  if (!src) continue;
  const tags = deriveRow({ doc, source: src, isToken: false }).tags as any;
  const old = stored.get(doc.oracleId) ?? {};
  const rc = new Set((tags.abilities ?? []).filter((a: any) => a.effect?.kind === "restriction").map((a: any) => a.clause)); if (rc.size > 0) gainedRestriction++;
  if (strip(tags.abilities ?? [], rc) === strip(old.abilities ?? [], rc)) same++; else { diff++; console.log("DIFF", doc.name); }
  if (src.legalities?.commander !== "legal") continue;
  legal++;
  const tl = String(src.typeLine ?? "");
  const cls = /\bAura\b/.test(tl) ? "aura" : /\bEquipment\b/.test(tl) ? "equipment" : "other";
  const hostAb = (tags.abilities ?? []).filter((a: any) => a.host);
  if (cls !== "other") for (const a of tags.abilities ?? []) if (HOST_KINDS.has(a.effect.kind) && !a.host) {
    const quoted = /["\u201c]/.test(String(src.oracleText ?? ""));
    unmarked[quoted ? "in a card with a quoted grant" : "no quote"] = (unmarked[quoted ? "in a card with a quoted grant" : "no quote"] ?? 0) + 1;
  }
  if (hostAb.length) { cards[cls].add(src.name); abil[cls] += hostAb.length; for (const a of hostAb) kinds[a.effect.kind] = (kinds[a.effect.kind] ?? 0) + 1; }
  else if (cls !== "other") {
    const text = String(src.oracleText ?? "").replace(/\([^)]*\)/g, "");
    const m = RECIP.exec(text);
    if (!m) continue;
    const q = /["“]/.test(text) ? "quoted" : "plain";
    const key = `${cls} ${m[1]!.toLowerCase()} ${q} | derives: ${[...new Set((tags.abilities ?? []).map((a: any) => a.effect.kind).filter((k: string) => ["pump","debuff","keyword-grant","speed-increase","type-grant","ability-loss","animate","evasion"].includes(k)))].sort().join(",") || "none of the host kinds"}`;
    (residue[key] ??= []).push(src.name);
  }
}
console.log(`cards deriving a restriction (all legalities): ${gainedRestriction}`);
console.log(`identity (host, grantedBy, restricts, restriction stripped): identical ${same}, different ${diff}`);
console.log(`commander-legal ${legal}; cards with host: aura ${cards.aura.size}, equipment ${cards.equipment.size}, other ${cards.other.size}; abilities: ${JSON.stringify(abil)}`);
console.log("unmarked host-kind abilities on Auras/Equipment (a card's other-class effects, granted inner effects, Magemarks):", JSON.stringify(unmarked));
console.log("by effect kind", JSON.stringify(kinds));
console.log("other (non-Aura/Equipment) examples:", [...cards.other].slice(0, 100).join("; "));
for (const [k, v] of Object.entries(residue).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${v.length}\t${k}\t${process.env.DETAIL === k ? v.join("; ") : v.slice(0, 5).join("; ")}`);
}
await store.close();
