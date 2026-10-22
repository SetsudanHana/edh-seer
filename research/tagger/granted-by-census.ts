// LOCAL RESEARCH ONLY (#1315): after a derive, how many abilities / cards carry `grantedBy` (the clause that grants a quoted ability), and for the commander-legal Auras with a host
// keyword-grant whose `grants` is empty (a quoted grant), how many have at least one ability grantedBy that clause; the others are listed (they stay unreadable).
// Also: cards / abilities deriving a `restriction`, by `restricts`, and host restrictions. FREE: reads Mongo (cardTagsDerived), writes nothing.
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`: npx tsx research/tagger/granted-by-census.ts
import { connect, loadConfig } from "@edh-seer/data";
const store = await connect(loadConfig());
let gbAb = 0, gbCards = 0, restrCards = 0, restrAb = 0, restrLegalCards = 0;
const byRestricts: Record<string, number> = {};
let auras = 0, withChild = 0; const none: string[] = []; const hostRestr = new Set<string>();
const legal = new Set<string>(), names = new Map<string, string>();
for await (const c of store.cards.find({ "legalities.commander": "legal" } as never).project({ _id: 1, name: 1 }) as any) { legal.add(String(c._id)); names.set(String(c._id), c.name); }
for await (const d of store.db.collection("cardTagsDerived").find({ isToken: { $ne: true } }) as any) {
  const abs: any[] = d.abilities ?? [];
  const gb = abs.filter((a) => a.grantedBy !== undefined);
  if (gb.length) { gbAb += gb.length; gbCards++; }
  const rs = abs.filter((a) => a.effect?.kind === "restriction");
  if (rs.length) { restrCards++; restrAb += rs.length; if (legal.has(String(d.oracleId))) restrLegalCards++; for (const a of rs) byRestricts[(a.restricts ?? []).join("+") + (a.host ? " host" : "")] = (byRestricts[(a.restricts ?? []).join("+") + (a.host ? " host" : "")] ?? 0) + 1; }
  if (rs.some((a) => a.host) && legal.has(String(d.oracleId))) hostRestr.add(names.get(String(d.oracleId)) ?? String(d.oracleId));
  if (!legal.has(String(d.oracleId)) || !/\bAura\b/.test(String(d.characteristics?.subtypes ?? "")) && !/Aura/i.test(JSON.stringify(d.characteristics?.subtypes ?? []))) continue;
  const empties = abs.filter((a) => a.host && a.effect?.kind === "keyword-grant" && (a.grants ?? []).length === 0);
  if (!empties.length) continue;
  auras++;
  if (empties.some((e) => abs.some((a) => a.grantedBy === e.clause))) withChild++; else none.push(names.get(String(d.oracleId)) ?? String(d.oracleId));
}
console.log(`abilities with grantedBy ${gbAb}, cards ${gbCards}`);
console.log(`commander-legal Auras with a host keyword-grant of empty grants: ${auras}; with >=1 grantedBy child of that clause: ${withChild}; with none: ${none.length}`);
console.log("none:", none.join("; "));
console.log(`cards deriving a restriction ${restrCards} (commander-legal ${restrLegalCards}), abilities ${restrAb}; by restricts`, JSON.stringify(byRestricts));
console.log(`commander-legal cards with a HOST restriction: ${hostRestr.size}`);
if (process.env.LIST) console.log([...hostRestr].join("; "));
await store.close();
