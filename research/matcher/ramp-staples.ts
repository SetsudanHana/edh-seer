/** WHICH OF OUR RAMP CARDS A PLAYER WOULD TAKE, measured against EDHREC's top lists (#534). Free:
 *  Mongo reads plus EDHREC's public JSON, cached to disk.
 *
 *  A short-on-ramp list drawn only from the partner pool offered Inalla four cards no Wizards
 *  player would take, because a plain rock joins nothing and never enters the pool. Appending role
 *  cards needs an order, and the name index's only candidate, `partners`, ranks Cabal Ritual 27x
 *  above Arcane Signet. This asks what a DERIVED order would keep: every commander-legal card our
 *  rules call ramp, split by the resilience tier `rampResilience` already assigns, scored against
 *  the cards EDHREC's top lists name (the label), by mana value.
 *
 *    npx tsx --env-file=packages/tagger/.env research/matcher/ramp-staples.ts */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, docToCard, loadConfig } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { detectBuildRules, rampGrade, rampResilience } from "../../packages/matcher/src/build.js";
import type { DeckCard } from "../../packages/matcher/src/types.js";

const CACHE = ".edhrec-cache";
const LISTS = ["mana-artifacts", "creatures", "sorceries", "instants", "enchantments", "year"];

async function topList(page: string): Promise<Map<string, number>> {
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/top-${page}.json`;
  if (!existsSync(file)) {
    const res = await fetch(`https://json.edhrec.com/pages/top/${page}.json`, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`);
    writeFileSync(file, await res.text());
  }
  const j = JSON.parse(readFileSync(file, "utf8"));
  const out = new Map<string, number>();
  for (const l of j.container?.json_dict?.cardlists ?? []) {
    for (const c of l.cardviews ?? []) out.set(c.name, c.potential_decks ? c.num_decks / c.potential_decks : 0);
  }
  return out;
}

const staple = new Map<string, number>();
for (const page of LISTS) for (const [n, r] of await topList(page)) staple.set(n, Math.max(staple.get(n) ?? 0, r));

const store = await connect(loadConfig());
const derived = store.db.collection<CardTags>("cardTagsDerived");
const cards = store.db.collection("cards");

type Row = { name: string; mv: number; tier: string; rules: string[]; staple: number | undefined; tap: boolean; grade: number };
const rows: Row[] = [];
for await (const doc of cards.find({ "legalities.commander": "legal" })) {
  const tags = (await derived.findOne({ oracleId: String(doc._id) })) as CardTags | null;
  const dc: DeckCard = { card: docToCard(doc as never), tags };
  if (/\bland\b/i.test(dc.card.typeLine)) continue;
  const rules = [...detectBuildRules([dc])].filter(([id]) => id.startsWith("ramp.")).map(([id]) => id);
  if (rules.length === 0) continue;
  const r = rampResilience([dc]);
  const tier = /\b(instant|sorcery)\b/i.test(dc.card.typeLine) && !r.land ? "spell" : r.land ? "land" : r.rock ? (rules.includes("ramp.manaToken") && !rules.includes("ramp.effect") ? "token" : "rock") : r.dork ? "dork" : "other";
  rows.push({ name: dc.card.name, mv: dc.card.manaValue ?? 0, tier, rules, staple: staple.get(dc.card.name), tap: rampGrade(dc) > 0, grade: rampGrade(dc) });
}
await store.close?.();

console.log(`ramp cards ${rows.length}, EDHREC top-list names ${staple.size}, ramp cards on a top list ${rows.filter((r) => r.staple !== undefined).length}\n`);
console.log("tier    mv   cards  staples  share");
for (const tier of ["land", "rock", "dork", "token", "spell", "other"]) {
  for (const band of [[0, 1], [2, 2], [3, 3], [4, 99]] as const) {
    const in_ = rows.filter((r) => r.tier === tier && r.mv >= band[0] && r.mv <= band[1]);
    const s = in_.filter((r) => r.staple !== undefined).length;
    if (in_.length) console.log(`${tier.padEnd(7)} ${band.join("-").padEnd(4)} ${String(in_.length).padStart(5)}  ${String(s).padStart(7)}  ${((100 * s) / in_.length).toFixed(0).padStart(4)}%`);
  }
}
const show = (label: string, xs: Row[]) => console.log(`\n${label}\n  ` + xs.map((r) => `${r.name} [${r.tier} ${r.mv}${r.staple !== undefined ? ` ${(100 * r.staple).toFixed(1)}%` : ""}]`).join("\n  "));
show("TOP-LIST RAMP BY INCLUSION", rows.filter((r) => r.staple !== undefined).sort((a, b) => b.staple! - a.staple!).slice(0, 60));
show("TOP-LIST NAMES OUR RULES DO NOT CALL RAMP (mana artifacts)", [...(await topList("mana-artifacts")).keys()].filter((n) => !rows.some((r) => r.name === n)).map((name) => ({ name, mv: 0, tier: "-", rules: [], staple: undefined, tap: false, grade: 0 })));
const grixis = new Set(["U", "B", "R"]);
const idOf = new Map<string, string[]>();
{
  const s = await connect(loadConfig());
  for await (const d of s.db.collection("cards").find({ name: { $in: rows.map((r) => r.name) } }, { projection: { name: 1, colorIdentity: 1 } })) idOf.set(d.name as string, (d.colorIdentity as string[]) ?? []);
  await s.close?.();
}
const inGrixis = (r: Row) => (idOf.get(r.name) ?? []).every((c) => grixis.has(c));
const kept = rows.filter((r) => (r.tier === "rock" || r.tier === "dork") && r.mv >= 2 && r.mv <= 3 && inGrixis(r));
console.log(`\nGRIXIS rock+dork at MV 2-3: ${kept.length} cards, ${kept.filter((r) => r.staple !== undefined).length} on a top list`);
show("  NOT on a top list (first 60 by name)", kept.filter((r) => r.staple === undefined).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60));

for (const [label, xs] of [["ALL", rows], ["GRIXIS", rows.filter(inGrixis)]] as const) {
  for (const band of [[2, 2], [3, 3], [2, 3]] as const) {
    const b = xs.filter((r) => r.mv >= band[0] && r.mv <= band[1]);
    const t = b.filter((r) => r.tap);
    const st = b.filter((r) => r.staple !== undefined);
    console.log(`${label} MV ${band.join("-")}: tapRamp keeps ${t.length} of ${b.length}; staples kept ${t.filter((r) => r.staple !== undefined).length} of ${st.length}; precision ${((100 * t.filter((r) => r.staple !== undefined).length) / Math.max(1, t.length)).toFixed(0)}%`);
  }
}
show("STAPLES tapRamp DROPS (MV 2-3)", rows.filter((r) => !r.tap && r.staple !== undefined && r.mv >= 2 && r.mv <= 3).sort((a, b) => b.staple! - a.staple!));
show("GRIXIS tapRamp KEEPS, MV 2 (all)", rows.filter((r) => r.tap && inGrixis(r) && r.mv === 2).sort((a, b) => (b.staple ?? -1) - (a.staple ?? -1)));

const ranked = rows.filter((r) => r.tap && inGrixis(r) && r.mv >= 2 && r.mv <= 3).sort((a, b) => b.grade - a.grade || a.mv - b.mv || a.name.localeCompare(b.name));
for (const n of [10, 20, 40]) {
  const top = ranked.slice(0, n);
  console.log(`GRIXIS MV 2-3 derived top ${n}: ${top.filter((r) => r.staple !== undefined).length} staples`);
}
console.log(`staples by grade: ` + [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((g) => `${g}:${ranked.filter((r) => r.grade === g && r.staple !== undefined).length}/${ranked.filter((r) => r.grade === g).length}`).join(" "));
show("GRIXIS MV 2-3 derived order, top 30", ranked.slice(0, 30));
