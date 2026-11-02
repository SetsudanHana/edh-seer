import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const g = new Set<string>(), l = new Set<string>();
for (const sec of [j.pairDetail, j.sampleDetail]) for (const c of sec) { c.gained.forEach((k: string) => g.add(k)); c.lost.forEach((k: string) => l.add(k)); }
const by = (s: Set<string>, i: number) => { const m = new Map<string, number>(); for (const k of s) { const x = k.split("|")[i]!; m.set(x, (m.get(x) ?? 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, +process.argv[3]!); };
console.log("gained by consumer", by(g, 2)); console.log("gained by producer", by(g, 1));
console.log("gained tags", by(g, 0)); 
console.log("sample gained", [...g].filter((k) => /Warg|Hidetsugu|Kiyomaro/.test(k)).slice(0, 12));
console.log("lost by consumer", by(l, 2).slice(0,3)); console.log("lost tags", by(l, 0));
