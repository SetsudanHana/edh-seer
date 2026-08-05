/** Scores normalize-experiment output against the acceptance gates. No judgment calls — every
 *  number here is mechanical, so the decision to re-tag rests on measurement rather than opinion. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Clause } from "../segment.js";

const dir = process.argv[2] ?? "/tmp/normalize-exp";
interface Row { name: string; clauses: Clause[]; output: { clauses?: Rec[]; ERROR?: string } }
interface Rec { id: number; abilityType?: string; trigger?: { event?: string } | null; actions?: { verb?: string; fromZone?: string | null; toZone?: string | null }[] }

const load = (f: string): Row[] => JSON.parse(readFileSync(join(dir, f), "utf8")) as Row[];
const r1 = load("run1.json"), r2 = load("run2.json");

/** Structured fields only — the free-text object is deliberately excluded. */
const skeleton = (o: Row["output"]): string =>
  JSON.stringify((o.clauses ?? []).map((c) => [
    c.id, c.abilityType, c.trigger?.event === "none" ? null : c.trigger?.event ?? null,
    (c.actions ?? []).map((a) => [a.verb, a.fromZone ?? null, a.toZone ?? null]),
  ]));

/** What the DERIVATION layer actually consumes: which verbs and zone transitions a clause
 *  contains, not whether "reveal" was recorded as its own action or folded into the search. Both
 *  numbers are reported — the exact one is stricter than the model needs to be, the semantic one
 *  is the honest requirement. Stating both so the metric cannot be quietly moved after the fact. */
const semantic = (o: Row["output"]): string =>
  JSON.stringify((o.clauses ?? []).map((c) => [
    c.id, c.abilityType, c.trigger?.event === "none" ? null : c.trigger?.event ?? null,
    [...new Set((c.actions ?? []).map((a) => `${a.verb}|${a.fromZone ?? ""}|${a.toZone ?? ""}`))].sort(),
  ]));

/** Semantic, plus the canonicalisation the pipeline can apply IN CODE after extraction. Every rule
 *  here is a fact the model was never entitled to choose, so normalising it is not leniency:
 *    - a clause with no actions and one recorded as [none] are the same clause;
 *    - "reveal" is bookkeeping inside a search or a look, never a game action on its own;
 *    - a zone the verb already fixes is not the model's to state — search comes FROM the library,
 *      a cast goes TO the stack, and put/exile carry their meaning in toZone (Kura vs Cultivate).
 *      `return` keeps its fromZone: reanimation from the graveyard is a different card.
 *  Reported ALONGSIDE the strict numbers, never instead of them — this is the projected effect of
 *  a code fix on data already collected, not a gate that moved. */
const canonical = (o: Row["output"]): string =>
  JSON.stringify((o.clauses ?? []).map((c) => {
    const acts = (c.actions ?? []).filter((a) => a.verb !== "reveal").map((a) => {
      const from = a.verb === "search" ? "library" : ["put", "exile", "reveal"].includes(a.verb ?? "") ? "" : a.fromZone ?? "";
      const to = a.verb === "cast" ? "" : a.toZone ?? "";
      return `${a.verb}|${from}|${to}`;
    });
    const set = [...new Set(acts.length ? acts : ["none||"])].sort();
    return [c.id, c.abilityType, c.trigger?.event === "none" ? null : c.trigger?.event ?? null, set];
  }));

let identical = 0, complete = 0, errored = 0, semanticSame = 0, canonicalSame = 0;
for (const a of r1) {
  const b = r2.find((x) => x.name === a.name);
  if (a.output.ERROR || b?.output.ERROR) { errored++; continue; }
  if (b && skeleton(a.output) === skeleton(b.output)) identical++;
  if (b && canonical(a.output) === canonical(b.output)) canonicalSame++;
  if (b && semantic(a.output) === semantic(b.output)) semanticSame++;
  const want = a.clauses.map((c) => c.id).sort((x, y) => x - y);
  const got = (a.output.clauses ?? []).map((c) => c.id).sort((x, y) => x - y);
  if (JSON.stringify(want) === JSON.stringify(got)) complete++;
}
const n = r1.length;
console.log(`cards: ${n}   errors: ${errored}`);
console.log(`GATE determinism  : ${identical}/${n} (${((identical / n) * 100).toFixed(0)}%)   target >=90%, today's tagger 55%`);
console.log(`GATE determinism* : ${semanticSame}/${n} (${((semanticSame / n) * 100).toFixed(0)}%)   *verb+zone SET per clause — what derivation consumes`);
console.log(`     determinism† : ${canonicalSame}/${n} (${((canonicalSame / n) * 100).toFixed(0)}%)   †semantic + implied zones, bookkeeping verbs and empty≡none normalised in code`);
console.log(`GATE completeness : ${complete}/${n} (${((complete / n) * 100).toFixed(0)}%)   target 100% — every clause id answered, none invented`);

// The four cards today's tagger demonstrably gets wrong.
const find = (card: string, pred: (c: Rec) => boolean): string => {
  const row = r1.find((x) => x.name.startsWith(card));
  if (!row) return "card missing";
  return (row.output.clauses ?? []).some(pred) ? "PASS" : "FAIL";
};
const act = (c: Rec, f: (a: NonNullable<Rec["actions"]>[number]) => boolean): boolean => (c.actions ?? []).some(f);
const curatedPresent = r1.some((x) => x.name.startsWith("Kura") || x.name.startsWith("Cultivate"));
if (!curatedPresent) {
  console.log(`\n(held-out sample — the known-wrong card list does not apply; determinism and`);
  console.log(` completeness are the gates that generalise, plus a hand read of the output.)`);
  process.exit(0);
}
console.log(`\nKNOWN-WRONG CARDS`);
console.log(`  Kura searches to HAND, not battlefield : ${find("Kura", (c) => act(c, (a) => a.verb === "put" && a.toZone === "hand"))}`);
console.log(`  Cultivate puts one onto the BATTLEFIELD: ${find("Cultivate", (c) => act(c, (a) => a.verb === "put" && a.toZone === "battlefield"))}`);
console.log(`  Bitterblossom triggers on UPKEEP       : ${find("Bitterblossom", (c) => c.trigger?.event === "upkeep")}`);
console.log(`  Path to Exile actually EXILES a creature: ${find("Path to Exile", (c) => act(c, (a) => a.verb === "exile"))}`);
console.log(`  Counterspell counters a spell          : ${find("Counterspell", (c) => act(c, (a) => a.verb === "counter-spell"))}`);
console.log(`  Phyrexian Tower sacrifices a creature  : ${find("Phyrexian Tower", (c) => act(c, (a) => a.verb === "sacrifice"))}`);
