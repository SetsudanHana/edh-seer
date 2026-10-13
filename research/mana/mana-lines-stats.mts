/** Corpus census of the derived `manaLines` (#1169 task 1): how many cards carry them, by source; which `mana-generation`
 *  abilities have no line; and the card flags. Run from the repo root, env sourced, sandbox off. */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const store = await data.connect(data.loadConfig());
const rows: any[] = await store.db.collection("cardTagsDerived").find({}).toArray();
const cards = new Map<string, any>((await store.cards.find({}, { projection: { name: 1, oracleText: 1, "legalities.commander": 1 } } as never).toArray()).map((c: any) => [c._id, c]));
const bySource: Record<string, number> = {}; const cardsBySource: Record<string, number> = {};
let withLines = 0, tokens = 0, tokensWith = 0, gapAbilities = 0, gapCards = 0, repeatsNull = 0, lines = 0, unreadable = 0;
const gaps: string[] = [], unread: string[] = [], nullRep: string[] = [];
const flags = { staticFixer: 0, landFetch: 0, isOneShot: 0, suspendOnly: 0 };
for (const r of rows) {
  const isTok = r.isToken === true;
  if (isTok) tokens++;
  const ml = r.manaLines ?? [];
  if (ml.length) { withLines++; if (isTok) tokensWith++; }
  for (const f of Object.keys(flags)) if (r[f]) (flags as any)[f]++;
  const seen = new Set<string>();
  for (const l of ml) {
    lines++; bySource[l.source] = (bySource[l.source] ?? 0) + 1; seen.add(l.source);
    if (l.repeats === null) { repeatsNull++; if (nullRep.length < 15) nullRep.push(`${cards.get(r.oracleId)?.name ?? r.oracleId}[${l.source}]`); }
    if (l.source !== "fetch" && l.source !== "token-maker" && l.colours.length === 0 && l.colourless === 0 && l.anyColour === null) { unreadable++; if (unread.length < 25) unread.push(`${cards.get(r.oracleId)?.name ?? r.oracleId}`); }
  }
  for (const s of seen) cardsBySource[s] = (cardsBySource[s] ?? 0) + 1;
  // gap: a mana-generation ability whose clause no add-mana line covers (count per card clause)
  const mg = (r.abilities ?? []).filter((a: any) => a.effect?.kind === "mana-generation");
  const addMana = ml.filter((l: any) => l.source !== "fetch" && l.source !== "token-maker").length;
  const clauses = new Set(mg.map((a: any) => a.clause));
  // abilities per distinct clause may have twins; compare distinct clause count vs lines is rough, so count clause ids with no line at all via face/source-agnostic total
  if (mg.length && addMana === 0) { gapCards++; gapAbilities += mg.length; if (gaps.length < 25) gaps.push(cards.get(r.oracleId)?.name ?? r.oracleId); }
  else if (mg.length && addMana < clauses.size) { gapCards++; gapAbilities += clauses.size - addMana; if (gaps.length < 25) gaps.push(`${cards.get(r.oracleId)?.name ?? r.oracleId} (partial)`); }
}
const mgCards = rows.filter((r) => (r.abilities ?? []).some((a: any) => a.effect?.kind === "mana-generation")).length;
console.log({ derivedRows: rows.length, tokens, cardsWithManaLines: withLines, tokenRowsWithLines: tokensWith, lines, bySource, cardsBySource, flags,
  cardsWithManaGenerationAbility: mgCards, manaGenerationGapCards: gapCards, gapAbilities, repeatsNull, unreadableLines: unreadable });
console.log("gaps:", gaps.join(" | ")); console.log("unreadable:", unread.join(" | ")); console.log("repeats null:", nullRep.join(" | "));
await store.close();
