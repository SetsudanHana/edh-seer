import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const sections: [string, any[]][] = [["pair", j.pairDetail ?? []], ["sample", j.sampleDetail ?? []]];
const seen = new Set<string>();
type Row = { dir: "gained" | "lost"; tag: string; p: string; c: string };
const rows: Row[] = [];
for (const [, cards] of sections) for (const card of cards) for (const dir of ["gained", "lost"] as const) for (const k of card[dir]) {
  const id = `${dir}|${k}`; if (seen.has(id)) continue; seen.add(id);
  const [tag, p, c] = k.split("|"); rows.push({ dir, tag, p, c });
}
const tally = (key: (r: Row) => string) => {
  const m = new Map<string, [number, number]>();
  for (const r of rows) { const e = m.get(key(r)) ?? [0, 0]; e[r.dir === "gained" ? 0 : 1]++; m.set(key(r), e); }
  return [...m.entries()].sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]).slice(0, 25).map(([k, [g, l]]) => `${k}\t+${g}\t-${l}`).join("\n");
};
console.log("total", rows.filter((r) => r.dir === "gained").length, rows.filter((r) => r.dir === "lost").length);
console.log("== by consumer (tag|a|b: b)\n" + tally((r) => r.c));
console.log("== by producer\n" + tally((r) => r.p));
