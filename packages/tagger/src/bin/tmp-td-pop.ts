import { connect, loadConfig } from "@mtg/data";
const store = await connect(loadConfig());
const RE = /if an? ([^,]{1,60}?) (entering|attacking|dying|blocking|leaving|you cast|casts?)[^,]{0,40}causes? a triggered ability/i;
const cards = await store.cards.find({ oracleText: /causes a triggered ability/i } as never)
  .project({ name: 1, oracleText: 1 }).toArray() as unknown as { name: string; oracleText?: string }[];
console.log(`corpus cards printing "causes a triggered ability": ${cards.length}`);
const byEvent = new Map<string, string[]>();
let unmatched = 0;
for (const c of cards) {
  const m = RE.exec((c.oracleText ?? "").replace(/\n/g, " "));
  if (!m) { unmatched++; continue; }
  const k = m[2].toLowerCase();
  byEvent.set(k, [...(byEvent.get(k) ?? []), `${c.name} [${m[1].trim()}]`]);
}
for (const [k, v] of [...byEvent].sort((a, b) => b[1].length - a[1].length))
  console.log(`\n  ${k}: ${v.length}\n     ${v.slice(0, 6).join("\n     ")}`);
console.log(`\n  no qualifier matched by the probe: ${unmatched}`);
process.exit(0);
