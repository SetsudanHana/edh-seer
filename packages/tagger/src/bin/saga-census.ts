/** Census of Sagas: how they are printed, what they derive, and — the half that decides whether the
 *  gap matters — how many CONSUMERS in the 71 calibration decks would read a Saga's guaranteed death.
 *  CR 704.5s puts a Saga into its owner's graveyard after its final chapter. Free, read-only.
 *
 *  "Count the consumers, not the printed cards" — the keyword sweep's lesson, 2026-08-14. */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@mtg/data";
import { DERIVED_COLLECTION } from "../clause-store.js";
import type { Ability, SubjectFilter } from "../schema.js";

const store = await connect(loadConfig());

const sagas = await store.cards.find({ typeLine: /Saga/ } as never).toArray() as unknown as
  { _id: string; name: string; typeLine?: string; oracleText?: string }[];

/** A Saga that transforms is EXILED and returned — it never reaches a graveyard, so it must not get
 *  a death event. Read off printed text, not from memory. */
const transforms = (t: string) => /transform/i.test(t);
const statesSacrifice = (t: string) => /Sacrifice after|[Ss]acrifice (this|it)\b/.test(t);

const dying = sagas.filter((s) => !transforms(s.oracleText ?? "") && statesSacrifice(s.oracleText ?? ""));
console.log(`corpus Sagas ${sagas.length} · transform (never die) ${sagas.filter((s) => transforms(s.oracleText ?? "")).length} · state their own sacrifice ${dying.length} · neither ${sagas.length - dying.length - sagas.filter((s) => transforms(s.oracleText ?? "")).length}`);
for (const s of sagas.filter((s) => !transforms(s.oracleText ?? "") && !statesSacrifice(s.oracleText ?? "")))
  console.log(`  NEITHER: ${s.name} [${(s as { layout?: string }).layout ?? "-"}] ${s.typeLine}\n    ${(s.oracleText ?? "").replace(/\n/g, " | ")}`);

// Can the MATCHER tell these apart? It sees Characteristics only — no oracle text — so the
// discriminator has to be the type line / layout. Cross-tab it rather than assume.
const tab = new Map<string, string[]>();
for (const s of sagas) {
  const multi = (s.typeLine ?? "").includes(" // ");
  const text = transforms(s.oracleText ?? "") ? "transform" : statesSacrifice(s.oracleText ?? "") ? "sacrifices" : "neither";
  const key = `${multi ? "multi-face" : "single-face"} + ${text}`;
  tab.set(key, [...(tab.get(key) ?? []), s.name]);
}
console.log(`\ntype line vs printed fate:`);
for (const [k, names] of [...tab].sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${names.length.toString().padStart(4)}  ${k}   e.g. ${names.slice(0, 3).join(" · ")}`);

// --- SUPPLY: derived Sagas that already carry a death emit.
const dyingIds = new Set(dying.map((s) => s._id));
const derived = await store.db.collection(DERIVED_COLLECTION).find({}).toArray() as unknown as
  { oracleId: string; abilities?: Ability[] }[];
const DEATH_VERBS = new Set(["dies", "enters-graveyard", "sacrifice", "leaves"]);
const emitsDeath = (a: Ability[] | undefined) =>
  (a ?? []).some((ab) => (ab.emits ?? []).some((e) => DEATH_VERBS.has(e.verb)));
const derivedSagas = derived.filter((d) => dyingIds.has(d.oracleId));
console.log(`\nderived corpus: ${derivedSagas.length} self-sacrificing Sagas, ${derivedSagas.filter((d) => emitsDeath(d.abilities)).length} already emitting a death verb`);

// --- DEMAND: consumers watching a death event, corpus-wide, by what subject they demand.
const byType = new Map<string, number>();
let consumers = 0;
for (const d of derived) {
  for (const ab of d.abilities ?? []) {
    const verbs = ab.trigger?.verbs ?? [];
    if (!verbs.some((v) => DEATH_VERBS.has(v))) continue;
    consumers++;
    const s: Partial<SubjectFilter> = ab.trigger?.subject ?? {};
    const t = s.type === undefined ? "(unset)" : JSON.stringify(s.type);
    const key = `${verbs.filter((v) => DEATH_VERBS.has(v)).join("/")} type=${t}${s.subtype ? ` subtype=${JSON.stringify(s.subtype)}` : ""}${s.self ? " SELF" : ""}`;
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }
}
console.log(`\ndeath-watching consumer abilities in the derived corpus: ${consumers}`);
const ENCH_OK = (k: string) => k.includes("SELF") ? false
  : /type="(unset)"|\(unset\)|enchantment|permanent/.test(k) && !k.includes("subtype=");
let enchOk = 0;
for (const [k, n] of [...byType].sort((a, b) => b[1] - a[1])) {
  if (ENCH_OK(k)) enchOk += n;
  console.log(`  ${n.toString().padStart(3)}  ${ENCH_OK(k) ? "ENCH-OK " : "        "}${k}`);
}
console.log(`\nof those, an ENCHANTMENT death could satisfy roughly: ${enchOk}`);

// --- Per deck: do a Saga and a death-watcher share a deck?
const DIR = "packages/cli/decks/calibration";
const lookup = mongoLookup(store);
const deathConsumerIds = new Set(derived.filter((d) => (d.abilities ?? []).some((ab) =>
  (ab.trigger?.verbs ?? []).some((v) => DEATH_VERBS.has(v)) && !ab.trigger?.subject?.self &&
  ENCH_OK(`x type=${JSON.stringify(ab.trigger?.subject?.type ?? "(unset)")}${ab.trigger?.subject?.subtype ? ` subtype=x` : ""}`)
)).map((d) => d.oracleId));

// `Card` carries no id, so join on normalized name.
const nameById = new Map(sagas.map((s) => [s._id, normalizeName(s.name)]));
const allById = new Map((await store.cards.find({}).project({ name: 1 }).toArray() as unknown as { _id: string; name: string }[])
  .map((c) => [c._id, normalizeName(c.name)]));
const sagaNames = new Set([...dyingIds].map((i) => nameById.get(i)!));
const consumerNames = new Set([...deathConsumerIds].map((i) => allById.get(i)!).filter(Boolean));

let decksWithBoth = 0, decksWithSaga = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const names = new Set(cards.map((c) => normalizeName(c.name)));
  const nSaga = [...sagaNames].filter((n) => names.has(n)).length;
  const nCons = [...consumerNames].filter((n) => names.has(n)).length;
  if (!nSaga) continue;
  decksWithSaga++;
  if (nCons) decksWithBoth++;
  console.log(`  ${file.replace(/\.txt$/, "").padEnd(34)} sagas ${nSaga}  death-watchers ${nCons}`);
}
console.log(`\ndecks with a self-sacrificing Saga: ${decksWithSaga}; of those, with a death-watcher too: ${decksWithBoth}`);
void normalizeName;

await store.close();
process.exit(0);
