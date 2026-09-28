/** ONE-SHOT (compass backfill, owner 2026-09-28): the reason tags `pairReasons` writes for card pairs on
 *  the CURRENT derive, the same call the compass makes, so a pair can be banked with the tag it really
 *  carries. Pairs as "A / B" arguments; prints each tag with its repeatability.
 *
 *    npx tsx research/matcher/pair-tags-probe.ts "Inalla, Archmage Ritualist / Dour Port-Mage" ... */
import { connect, docToCard, loadConfig } from "../../packages/data/src/index.js";
import { pairReasons } from "../../packages/matcher/src/edges.js";
import { loadHierarchy } from "../../packages/matcher/src/hierarchy.js";
import type { DeckCard } from "../../packages/matcher/src/types.js";

const store = await connect(loadConfig());
const h = loadHierarchy();
const dc = async (name: string): Promise<DeckCard | null> => {
  const c = await store.cards.findOne({ name });
  if (!c) return null;
  const tags = await store.db.collection("cardTagsDerived").findOne({ oracleId: c._id });
  return { card: { ...c, ...docToCard(c as never) }, tags } as unknown as DeckCard;
};
for (const arg of process.argv.slice(2)) {
  const [a, b] = arg.split(" / ").map((s) => s.trim());
  const A = await dc(a!), B = await dc(b!);
  if (!A || !B) { console.log(`${arg}: NOT FOUND ${!A ? a : b}`); continue; }
  const rs = pairReasons(A, B, h);
  const tags = [...new Map(rs.map((r) => [`${r.tag} [${r.repeatability ?? "-"}${r.perTurn ? ",per-turn" : ""}] ${r.producer}->${r.consumer}`, r])).keys()];
  console.log(`${arg}: ${tags.join(" | ") || "(none)"}`);
}
await store.close();
