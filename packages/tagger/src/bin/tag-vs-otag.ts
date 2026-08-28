/** Compares Scryfall's otag vocabulary against our LLM-authored cardTags, per otag slug.
 *
 *  For each slug: how many of its cards we ATTEMPTED to tag and recorded nothing for (the defect),
 *  how many we never attempted (grind coverage, not a defect — these must never be merged), and
 *  which effect kinds we do assign to that slug's cards. A slug with a high empty rate is a
 *  systematic blind spot; the "we say" column shows where our vocabulary answers a different
 *  question than Scryfall's.
 *
 *  Usage: tsx src/bin/tag-vs-otag.ts   (writes /tmp/otag-vs-tags.txt) */
import { writeFileSync } from "node:fs";
import { connect, loadConfig } from "@edh-seer/data";
import { expectsAbilities } from "./corpus-core.js";

const s = await connect(loadConfig());
const ccol = s.db.collection("cards");
const tcol = s.db.collection("cardTags");
const ocol = s.db.collection("cardOtags");

// name -> otags
const otagsByName = new Map<string, string[]>();
for await (const d of ocol.find({}, { projection: { name: 1, otags: 1 } })) {
  otagsByName.set((d as unknown as { name: string }).name, (d as unknown as { otags?: string[] }).otags ?? []);
}
// oracleId -> abilities count + effect kinds
const tagInfo = new Map<string, { n: number; kinds: string[] }>();
for await (const d of tcol.find({}, { projection: { oracleId: 1, abilities: 1 } })) {
  const t = d as unknown as { oracleId: string; abilities?: { effect?: { kind?: string } }[] };
  tagInfo.set(t.oracleId, {
    n: (t.abilities ?? []).length,
    kinds: (t.abilities ?? []).map((a) => a.effect?.kind ?? "?"),
  });
}

interface Slug { total: number; noTagDoc: number; empty: number; tagged: number; kinds: Map<string, number>; ex: string[] }
const slugs = new Map<string, Slug>();
let cards = 0, withOtags = 0, withTags = 0;

for await (const c of ccol.find({}, { projection: { name: 1, oracleText: 1, keywords: 1 } })) {
  const card = c as unknown as { _id: string; name: string; oracleText?: string; keywords?: string[] };
  cards++;
  const ot = otagsByName.get(card.name);
  const ti = tagInfo.get(card._id);
  if (ot) withOtags++;
  if (ti) withTags++;
  if (!ot || !expectsAbilities(card)) continue;
  for (const slug of ot) {
    if (!slugs.has(slug)) slugs.set(slug, { total: 0, noTagDoc: 0, empty: 0, tagged: 0, kinds: new Map(), ex: [] });
    const e = slugs.get(slug)!;
    e.total++;
    if (!ti) { e.noTagDoc++; continue; }
    if (ti.n === 0) {
      e.empty++;
      if (e.ex.length < 4) e.ex.push(card.name);
      continue;
    }
    e.tagged++;
    for (const k of ti.kinds) e.kinds.set(k, (e.kinds.get(k) ?? 0) + 1);
  }
}

const rows = [...slugs].map(([slug, v]) => ({
  slug, ...v,
  blind: v.empty + v.noTagDoc,
  rate: (v.empty + v.noTagDoc) / v.total,
  topKinds: [...v.kinds].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}:${n}`).join(" "),
}));

const lines: string[] = [];
lines.push(`corpus cards=${cards}  with otags=${withOtags}  with cardTags=${withTags}`);
lines.push(`otag slugs seen on ability-bearing cards: ${rows.length}\n`);
// EMPTY = we ran the tagger and recorded nothing (the defect). noTagDoc = never attempted (the
// grind covered 20,394 of 33,993 cards, most-played first) — expected, not a bug. Never merge them.
const attempted = (r: (typeof rows)[number]): number => r.empty + r.tagged;
lines.push(`=== TAGGED BUT EMPTY — we ran the tagger on these and recorded nothing ===`);
for (const r of rows.sort((a, b) => b.empty - a.empty).slice(0, 22)) {
  const att = attempted(r);
  lines.push(`${String(r.empty).padStart(4)} empty / ${String(att).padStart(5)} attempted (${((r.empty / (att || 1)) * 100).toFixed(0)}%)  ${r.slug.padEnd(30)} we say: ${r.topKinds || "-"}`);
  lines.push(`        e.g. ${r.ex.join(", ")}`);
}
lines.push(`\n=== HIGHEST EMPTY RATE among attempted (>= 200 attempted) ===`);
for (const r of rows.filter((x) => attempted(x) >= 200).sort((a, b) => b.empty / attempted(b) - a.empty / attempted(a)).slice(0, 20)) {
  lines.push(`${((r.empty / attempted(r)) * 100).toFixed(0).padStart(4)}%  ${String(attempted(r)).padStart(5)} attempted  ${r.slug.padEnd(30)} we say: ${r.topKinds || "-"}`);
}
lines.push(`\n=== NEVER ATTEMPTED (grind coverage, not a defect) ===`);
for (const r of rows.sort((a, b) => b.noTagDoc - a.noTagDoc).slice(0, 8)) {
  lines.push(`${String(r.noTagDoc).padStart(5)} of ${String(r.total).padStart(5)}  ${r.slug}`);
}
lines.push(`\n=== BEST COVERED (>= 200 attempted), for contrast ===`);
for (const r of rows.filter((x) => attempted(x) >= 200).sort((a, b) => a.empty / attempted(a) - b.empty / attempted(b)).slice(0, 10)) {
  lines.push(`${((r.empty / attempted(r)) * 100).toFixed(0).padStart(4)}%  ${String(attempted(r)).padStart(5)} attempted  ${r.slug.padEnd(30)} we say: ${r.topKinds || "-"}`);
}
const out = lines.join("\n");
writeFileSync("/tmp/otag-vs-tags.txt", out);
console.log(out.slice(0, 4200));
console.log(`\n[full report: /tmp/otag-vs-tags.txt]`);
await s.close();
