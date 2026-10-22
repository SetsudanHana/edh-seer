// LOCAL RESEARCH ONLY (#1302): where do the hand-fill cards land? Groups every card with a `to-hand` ability or a typed dig (`Ability.toHand`) by kind and by the roles role-membership.json banks for it. FREE, read-only.
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`: npx tsx research/tagger/to-hand-landing.ts [kind-filter]
import { readFileSync } from "node:fs";
import { connect, loadConfig } from "@edh-seer/data";
const members = JSON.parse(readFileSync("packages/instruments/role-membership.json", "utf8")) as Record<string, string[]>;
const store = await connect(loadConfig());
const groups = new Map<string, string[]>();
for await (const d of store.db.collection<any>("cardTagsDerived").find({ isToken: { $ne: true } })) {
  const hf = (d.abilities ?? []).filter((a: any) => a.effect.kind === "to-hand" || a.toHand !== undefined);
  if (!hf.length) continue;
  const name = (await store.cards.findOne({ _id: d.oracleId } as never) as any)?.name ?? d.oracleId;
  const kind = [...new Set(hf.map((a: any) => (a.effect.kind === "to-hand" ? "to-hand" : "typed-dig") + (a.named ? "+named" : "") + (a.netZero ? "+netZero" : "") + (a.chooses && (a.effect.kind === "to-hand" ? a.amount : a.toHand) === "1" ? "+pickOne" : "")))].sort().join(" ");
  const roles = (members[name] ?? []).filter((r) => /^role:(handFill|cardSelection|tutor|draw)$/.test(r)).sort().join(",") || "(none)";
  const key = `${kind} -> ${roles}`;
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(name);
}
for (const [k, v] of [...groups].sort()) { console.log(`## ${k}: ${v.length}`); if (process.env.NAMES) console.log("   " + v.sort().join("; ")); }
await store.close();
