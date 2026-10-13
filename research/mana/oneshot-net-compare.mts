/** ONE-SHOT NET, OLD VS NEW (#1169 2b-2 follow-up): over every derived instant or sorcery with a mana-generation ability, whether the Ramp rule `ramp.effect` keeps the card under the
 *  retired text reader (`manaAdded`, the last "add" run in the card's own text, less its mana value) and under the derived lines (`oneShotNet`). Lists the cards where they disagree.
 *  `npx tsx research/mana/oneshot-net-compare.mts` (env sourced, sandbox off). */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const rules = await import(`${R}/matcher/src/rules.ts`);
const store = await data.connect(data.loadConfig());
const derived = new Map<string, any>((await store.db.collection("cardTagsDerived").find({}).toArray()).map((r: any) => [r.oracleId, r]));
const NUMBER_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** The retired reader, verbatim from e5fa2372. */
function manaAdded(oracle: string): number | undefined {
  let best: number | undefined;
  for (const mm of oracle.matchAll(/\badd\s+((?:\{[^{}]+\}\s*)+|\w+ mana\b)/gi)) {
    const frag = mm[1]!; let n: number | undefined;
    if (frag.trimStart().startsWith("{")) {
      n = 0;
      for (const sym of frag.matchAll(/\{([^{}]+)\}/g)) {
        if (/^\d+$/.test(sym[1]!)) n += Number(sym[1]); else if (/^[XYZ]$/i.test(sym[1]!)) return undefined; else n += 1;
      }
    } else n = NUMBER_WORD[frag.trim().split(/\s+/)[0]!.toLowerCase()];
    if (n === undefined) return undefined;
    if (/^\s*(?:for each|equal to|where|times)\b/i.test(oracle.slice(mm.index! + mm[0].length))) return undefined;
    best = Math.max(best ?? 0, n);
  }
  return best;
}
let n = 0; const rows: string[] = [];
for await (const c of store.cards.find({}) as any) {
  const line = (c.typeLine ?? "").toLowerCase();
  if (!/\b(instant|sorcery)\b/.test(line) || /\b(creature|artifact|enchantment|land|planeswalker|battle)\b/.test(line)) continue;
  const t = derived.get(c._id);
  if (!t?.abilities?.some((a: any) => a.effect?.kind === "mana-generation")) continue;
  n++;
  const added = manaAdded(rules.ownText(c));
  const oldKeep = added === undefined || added - (c.manaValue ?? 0) >= 1;
  const dc = { card: c, tags: t };
  const newKeep = rules.ruleMatches(rules.loadRules().rules.find((r: any) => r.id === "ramp.effect")!, dc as any);
  if (oldKeep !== newKeep) rows.push(`${oldKeep ? "kept -> cut" : "cut -> kept"}  ${c.name} (MV ${c.manaValue}): ${(c.oracleText ?? "").replace(/\n/g, " / ").slice(0, 140)}`);
}
console.log(`${n} derived instants/sorceries with a mana-generation ability; ${rows.length} flip`);
rows.sort().forEach((r) => console.log("  " + r));
await store.close();
