/** Parity of the derive-side `staticFixer` / `landFetch` with the matcher's printed-text detectors they replace (#1169
 *  task 1): the two answer sets over every derived card must agree, or the difference is named. Run from the repo root,
 *  env sourced, sandbox off. */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const sf = await import(`${R}/matcher/src/static-fixers.ts`);
const sj = await import(`${R}/matcher/src/same-job.ts`);
const ml = await import(`${R}/matcher/src/mana-lines.ts`);
const store = await data.connect(data.loadConfig());
const tags = new Map<string, any>((await store.db.collection("cardTagsDerived").find({}).toArray()).map((r: any) => [r.oracleId, r]));
const diffFixer: string[] = []; const diffFetch: string[] = []; const diffLines: string[] = [];
let nFixer = 0, nFetchSpell = 0;
for await (const c of store.cards.find({ "legalities.commander": "legal" } as never)) {
  const card: any = c; const t = tags.get(card._id); if (!t) continue;
  const dc: any = { card, tags: t };
  const old = sf.staticFixer(dc); const now = t.staticFixer;
  if (old) nFixer++;
  const a = old ? `${old.covers === "all-mana" ? "all" : "lands"}:${[...old.colours].join("")}` : "-";
  const b = now ? `${now.covers}:${now.colours.join("")}` : "-";
  if (a !== b) diffFixer.push(`${card.name} old=${a} new=${b}`);
  // fetch SPELLS: the printed reader (`landsToBattlefield`) against the derived `landFetch.kind === spell`
  const spell = /\b(instant|sorcery)\b/i.test((card.typeLine ?? "").split("//")[0]);
  // the printed reader counts ANY "put ... onto the battlefield" (Chaos Warp, Green Sun's Zenith), so narrow it to a land search
  const oldFetch = spell && sj.landsToBattlefield(dc) > 0 && /search your library for[^.]*\bland\b|search your library for[^.]*\b(?:plains|island|swamp|mountain|forest)\b/i.test(card.oracleText ?? "");
  const newFetch = t.landFetch?.kind === "spell";
  if (oldFetch) nFetchSpell++;
  if (oldFetch !== newFetch) diffFetch.push(`${card.name} old=${oldFetch} new=${newFetch} :: ${(card.oracleText ?? "").replace(/\n/g, " / ").slice(0, 230)}`);
  // plain tap lines: the printed reader's colours (qualifying lines) against the derived tap lines with no sacrifice / restriction
  const oldLines = ml.manaLines(dc);
  const newLines = (t.manaLines ?? []).filter((l: any) => l.source === "tap-ability" && !l.cost.sacrificeSelf && !l.restriction && l.colours.length > 0);
  const oc = new Set(oldLines.flatMap((l: any) => l.colours)); const nc = new Set(newLines.flatMap((l: any) => l.colours));
  if ([...oc].sort().join("") !== [...nc].sort().join("")) diffLines.push(`${card.name} old=${[...oc].sort().join("")} new=${[...nc].sort().join("")}`);
}
console.log(`static fixers: old ${nFixer}; differing ${diffFixer.length}`); console.log(diffFixer.slice(0, 30).join("\n"));
console.log(`fetch spells: old ${nFetchSpell}; differing ${diffFetch.length}`); console.log(diffFetch.slice(0, 40).join("\n"));
if (process.argv.includes('--no-lines')) process.exit(0);
console.log(`tap-line colour sets differing: ${diffLines.length}`); console.log(diffLines.slice(0, 60).join("\n"));
await store.close();
