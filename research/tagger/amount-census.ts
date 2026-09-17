/** AMOUNT CENSUS, for the cost-to-effect rate axis (roadmap X2; owner 2026-09-17, "proceed").
 *
 *  The rate is an interval per family -- floor and ceiling of what an ability does for what it
 *  charges -- and whether it is a number or a refusal on most of the corpus depends on what derive
 *  already records. This prints, per effect kind, how many abilities carry an amount, how many of
 *  those are numeric against variable ("X", "that many"), how many scale and on what basis, how
 *  the ability kinds split (a one-shot collapses the interval to a point; a trigger has a floor of
 *  0), and how many cards carry the "unless ... pays" fallback that derive has no field for.
 *
 *  One-shot: reads Mongo, prints, writes nothing. Run from the repo root:
 *    npx tsx research/tagger/amount-census.ts */
import { connect, loadConfig } from "@edh-seer/data";

const store = await connect(loadConfig());
const derived = store.db.collection("cardTagsDerived");

interface Ability {
  kind: string;
  cost?: string;
  amount?: string;
  effect?: { kind?: string; scaling?: string };
  trigger?: unknown;
  /** "repeatable" on a trigger or a reusable activation; what the interval's ceiling hangs on. */
  repeats?: string;
}
interface Row {
  abilities: number; withAmount: number; numeric: number; variable: number;
  scaled: number; bases: Record<string, number>; kinds: Record<string, number>;
  unlessPays: number; may: number; xCost: number; repeats: Record<string, number>;
}
const row = (): Row => ({ abilities: 0, withAmount: 0, numeric: 0, variable: 0, scaled: 0, bases: {}, kinds: {}, unlessPays: 0, may: 0, xCost: 0, repeats: {} });
const bump = (r: Record<string, number>, k: string): void => { r[k] = (r[k] ?? 0) + 1; };

const legal = new Map<string, { oracleText: string; manaCost: string | null }>();
for await (const c of store.cards.find({ "legalities.commander": "legal" } as never, { projection: { oracleText: 1, manaCost: 1 } } as never) as AsyncIterable<{ _id: string; oracleText?: string; manaCost?: string | null }>) {
  legal.set(String(c._id), { oracleText: c.oracleText ?? "", manaCost: c.manaCost ?? null });
}

const byKind = new Map<string, Row>();
const total = row();
let cardsRead = 0, cardsUnless = 0, cardsMay = 0;
// JOINED ON `oracleId`: the derived document's own `_id` is Mongo's, the card's `_id` is the oracle id.
for await (const d of derived.find({}) as AsyncIterable<{ oracleId: string; abilities?: Ability[]; tags?: { abilities?: Ability[] } }>) {
  const card = legal.get(String(d.oracleId));
  if (!card) continue;
  cardsRead++;
  const text = card.oracleText;
  const unless = /unless [^.]*\bpays?\b/i.test(text);
  const may = /\byou may\b/i.test(text);
  if (unless) cardsUnless++;
  if (may) cardsMay++;
  for (const a of d.abilities ?? d.tags?.abilities ?? []) {
    const kind = a.effect?.kind ?? "(none)";
    const r = byKind.get(kind) ?? row();
    byKind.set(kind, r);
    for (const t of [r, total]) {
      t.abilities++;
      bump(t.kinds, a.kind);
      bump(t.repeats, a.repeats ?? "(unset)");
      if (a.amount !== undefined) {
        t.withAmount++;
        if (/^\d[\d,]*$/.test(a.amount)) t.numeric++; else t.variable++;
      }
      const s = a.effect?.scaling;
      if (s !== undefined && s !== "fixed") { t.scaled++; bump(t.bases, s); }
      if (unless) t.unlessPays++;
      if (may) t.may++;
      if ((card.manaCost ?? "").includes("{X}") || (a.cost ?? "").includes("{X}")) t.xCost++;
    }
  }
}

const pct = (n: number, d: number): string => d === 0 ? "-" : `${((100 * n) / d).toFixed(0)}%`;
console.log(`commander-legal cards read in full: ${cardsRead.toLocaleString("en-US")} of ${legal.size.toLocaleString("en-US")}`);
console.log(`cards with "unless ... pays": ${cardsUnless.toLocaleString("en-US")}; with "you may": ${cardsMay.toLocaleString("en-US")}`);
console.log(`abilities: ${total.abilities.toLocaleString("en-US")}; with amount ${total.withAmount.toLocaleString("en-US")} (${pct(total.withAmount, total.abilities)}), numeric ${total.numeric.toLocaleString("en-US")}, variable ${total.variable.toLocaleString("en-US")}; scaled ${total.scaled.toLocaleString("en-US")}; X in the cost ${total.xCost.toLocaleString("en-US")}`);
console.log(`ability kinds: ${Object.entries(total.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString("en-US")}`).join(", ")}`);
console.log(`scaling bases: ${Object.entries(total.bases).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
console.log(`repeats: ${Object.entries(total.repeats).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString("en-US")}`).join(", ")}`);
console.log("");
console.log("effect kind".padEnd(24), "abil".padStart(7), "amount".padStart(8), "num".padStart(6), "var".padStart(5), "scaled".padStart(7), "unless".padStart(7), "may".padStart(6), "Xcost".padStart(6), "  kinds");
for (const [kind, r] of [...byKind].sort((a, b) => b[1].abilities - a[1].abilities).slice(0, 40)) {
  const kinds = Object.entries(r.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n, r.abilities)}`).join(" ")
    + ` | repeatable ${pct(r.repeats["repeatable"] ?? 0, r.abilities)}`;
  console.log(kind.padEnd(24), String(r.abilities).padStart(7), `${r.withAmount} ${pct(r.withAmount, r.abilities)}`.padStart(8), String(r.numeric).padStart(6), String(r.variable).padStart(5), String(r.scaled).padStart(7), String(r.unlessPays).padStart(7), String(r.may).padStart(6), String(r.xCost).padStart(6), " ", kinds);
}
await store.close();
