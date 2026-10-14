/** AMOUNT AGREEMENT (#1193, #1187): do the two readers of "how much mana does it add" say the same thing?
 *  `Ability.amount` (a string, set in derive.ts) and `ManaLine.amount` ({fixed, scales}, derive/mana-lines.ts). PRINTS; imports nothing exported.
 *  Run from the repo root, env sourced, sandbox off: `npx tsx research/mana/amount-agreement.ts`.
 *
 *  Population: every commander-legal card with a derived row (cardTagsDerived.oracleId = cards._id).
 *  Compared: cards with EXACTLY ONE ability of effect.kind "mana-generation" and EXACTLY ONE mana line whose source is
 *  activated / trigger / aura-trigger / static-grant / one-shot-spell (a token-maker and a fetch state theirs another way).
 *  Each side is read as FIXED n, SCALES, or UNREAD:
 *    ability: /^\d+$/ -> fixed n; undefined -> unread; any other string ("X", "for each ...") -> scales.
 *    line:    amount.fixed number -> fixed n; amount.scales string -> scales; both null -> unread.
 *  AGREE = both fixed and equal, OR the line SCALES and the ability is not a number (unread or a scaling text: a scaling amount has no
 *  number, so `Ability.amount` keeps no digits for it and every reader of it takes "not /^\\d+$/" as "no fixed amount"), OR both unread.
 *  DISAGREE = anything else (a number against a different number, a number against a scaling or unread reading, in either direction). The list is split by the pair of readings. Separately, UNREAD-LINE lists every mana line (of any card,
 *  not only single-ability ones) whose amount is neither fixed nor scales. */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const store = await data.connect(data.loadConfig());
type Read = { k: "fixed"; n: number } | { k: "scales"; t: string } | { k: "unread" };
const abilityRead = (a: string | undefined): Read => a === undefined ? { k: "unread" } : /^\d+$/.test(a) ? { k: "fixed", n: Number(a) } : { k: "scales", t: a };
const lineRead = (m: { fixed: number | null; scales: string | null }): Read => m.fixed !== null ? { k: "fixed", n: m.fixed } : m.scales !== null ? { k: "scales", t: m.scales } : { k: "unread" };
const show = (r: Read) => r.k === "fixed" ? `fixed ${r.n}` : r.k === "scales" ? `scales "${r.t}"` : "unread";
const agree = (a: Read, l: Read) => l.k === "scales" ? a.k !== "fixed" : a.k === l.k && (a.k !== "fixed" || a.n === (l as { n: number }).n);
const LINE_SOURCES = new Set(["activated", "trigger", "aura-trigger", "static-grant", "one-shot-spell"]);
const legal = new Set<string>((await store.cards.find({ "legalities.commander": "legal" } as never).project({ _id: 1 }).toArray()).map((c: any) => c._id));
const rows: any[] = (await store.db.collection("cardTagsDerived").find({}, { projection: { oracleId: 1, abilities: 1, manaLines: 1 } }).toArray()).filter((r: any) => legal.has(r.oracleId));
const cards = new Map<string, any>((await store.cards.find({ _id: { $in: rows.map((r) => r.oracleId) } } as never).toArray()).map((c: any) => [c._id, c]));
const text = (id: string) => (cards.get(id)?.oracleText ?? "").replace(/\n/g, " / ");
let compared = 0, agreed = 0;
const disagree: string[] = [], unreadLine: string[] = [];
for (const r of rows) {
  const lines: any[] = r.manaLines ?? [];
  for (const l of lines) if (lineRead(l.amount).k === "unread" && !(l.unread === true)) unreadLine.push(`${cards.get(r.oracleId)?.name} | ${l.source} | ${text(r.oracleId)}`);
  const abs: any[] = (r.abilities ?? []).filter((a: any) => a.effect?.kind === "mana-generation");
  const ls = lines.filter((l) => LINE_SOURCES.has(l.source));
  if (abs.length !== 1 || ls.length !== 1) continue;
  compared++;
  const a = abilityRead(abs[0].amount), l = lineRead(ls[0].amount);
  if (agree(a, l)) { agreed++; continue; }
  disagree.push(`${cards.get(r.oracleId)?.name} | ability ${show(a)} | line ${show(l)} | ${text(r.oracleId)}`);
}
console.log(`COMPARED ${compared} single-ability single-line cards (of ${rows.length} derived commander-legal)`);
console.log(`AGREE ${agreed}  DISAGREE ${disagree.length}`);
for (const d of disagree.sort()) console.log("  DISAGREE", d);
console.log(`UNREAD-LINE (line amount neither fixed nor scales, line not flagged unread) ${unreadLine.length}`);
for (const d of unreadLine.sort()) console.log("  UNREAD-LINE", d);
await store.close();
