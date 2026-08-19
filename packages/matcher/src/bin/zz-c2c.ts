import { connect, loadConfig } from "@mtg/data";
const store = await connect(loadConfig());
const rows = await store.db.collection("cardTagsDerived")
  .find({ "abilities.effect.scalingSubject": { $exists: true } } as never).toArray();
let typed = 0; const untypedButNarrowed: string[] = []; const trulyUntyped: string[] = [];
for (const r of rows) {
  for (const a of ((r as never as { abilities: { effect?: { scalingSubject?: Record<string, unknown> } }[] }).abilities)) {
    const s = a.effect?.scalingSubject; if (!s) continue;
    const hasType = (Array.isArray(s.type) ? s.type.length : s.type ? 1 : 0) > 0;
    const hasSub = (Array.isArray(s.subtype) ? s.subtype.length : s.subtype ? 1 : 0) > 0;
    if (hasType || hasSub) { typed++; continue; }
    const narrowing = ["historic", "legendary", "basic", "named", "counter", "keyword", "notType"]
      .filter((k) => s[k] !== undefined);
    const c = await store.db.collection("cards").findOne({ _id: (r as never as { oracleId: string }).oracleId } as never) as never as { name: string } | null;
    if (narrowing.length > 0) untypedButNarrowed.push(`${c?.name} [${narrowing.join(",")}]`);
    else trulyUntyped.push(`${c?.name}`);
  }
}
console.log("scalingSubjects with a type/subtype (the loop accepts):", typed);
console.log("UNTYPED but otherwise NARROWED (the loop refuses these):", untypedButNarrowed.length, "->", [...new Set(untypedButNarrowed)].join(" · "));
console.log("truly untyped (correctly refused):", trulyUntyped.length, "->", [...new Set(trulyUntyped)].slice(0, 8).join(" · "));
process.exit(0);
