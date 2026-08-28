import { mechanicCoverageSummary } from "@edh-seer/engine";

const s = mechanicCoverageSummary();
console.log("Mechanic coverage:");
console.log(`  total   ${s.total}`);
console.log(`  covered ${s.byStatus.covered}`);
console.log(`  tighten ${s.byStatus.tighten}`);
console.log(`  planned ${s.byStatus.planned}`);
console.log(`  skip    ${s.byStatus.skip}`);

console.log(`\nTIGHTEN (${s.tighten.length}) — imprecise, needs a precision pass:`);
for (const m of s.tighten) console.log(`  - ${m.mechanic} [${(m.tags ?? []).join(", ")}] — ${m.note ?? ""}`);

console.log(`\nPLANNED (${s.planned.length}) — synergy-relevant, no pattern yet:`);
for (const m of s.planned) console.log(`  - ${m.mechanic} (${m.source})${m.note ? ` — ${m.note}` : ""}`);
