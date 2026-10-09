import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** CARDS THAT USE A CARD FROM AN OPPONENT'S GRAVEYARD, AND HOW THEY DERIVE (#729). Owner ruling
 *  2026-10-09: such a card joins only cards that explicitly mill opponents. This counts the cards
 *  whose printed text takes a card from an opponent's graveyard and puts it onto the battlefield,
 *  casts or plays it, or makes a copy of it, and the effect kind each derives to: `graveyard-recursion`
 *  is what the reanimator pass can join; `graveyard-hate` joins nothing. Reads the static shards.
 *
 *    npx tsx research/tagger/opp-graveyard-use-census.ts [static-out] [out.json]
 */
const root = process.argv[2] ?? "static-out";
const version = readdirSync(root).find((d) => d.startsWith("v-"))!;
const dir = join(root, version, "cards");
const USES = /(?:opponent'?s?'? graveyards?|exiled this way|exiled with)[\s\S]{0,200}?(?:onto the battlefield under your control|you may cast|you may play|copy of)/i;
const OPP = /opponent'?s?'? graveyard|each opponent's graveyard|from an opponent's graveyard/i;
const rows: { name: string; kinds: string[]; recursionOpp: boolean }[] = [];
for (const f of readdirSync(dir)) {
  const shard = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, { card: { name: string; oracleText?: string }; tags: { abilities?: { effect?: { kind?: string; subject?: { control?: string; zone?: string; fromZone?: string } } }[] } }>;
  for (const v of Object.values(shard)) {
    const text = v.card.oracleText ?? "";
    if (!OPP.test(text) || !USES.test(text)) continue;
    const abs = v.tags?.abilities ?? [];
    const kinds = [...new Set(abs.map((a) => a.effect?.kind).filter((k): k is string => !!k))];
    const recursionOpp = abs.some((a) => a.effect?.kind === "graveyard-recursion" && a.effect.subject?.control !== "you");
    rows.push({ name: v.card.name, kinds, recursionOpp });
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name));
const joinable = rows.filter((r) => r.recursionOpp).length;
const hateOnly = rows.filter((r) => !r.recursionOpp && r.kinds.includes("graveyard-hate")).length;
console.log(`${rows.length} cards use a card from an opponent's graveyard: ${joinable} derive a recursion the reanimator pass can join, ${hateOnly} derive graveyard-hate only, ${rows.length - joinable - hateOnly} neither`);
for (const r of rows) if (!r.recursionOpp) console.log(`  ${r.name}: ${r.kinds.join(", ") || "-"}`);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(rows, null, 1));
