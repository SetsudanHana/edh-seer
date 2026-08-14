/** Enumerate every derived-corpus clause carrying an extra-turn / extra-phase verb, with its object
 *  and the kind it derives TODAY. This sizes the only non-inert change in the threshold-lines spec
 *  (§4.2): `SIMPLE` maps `extra-phase` to `extra-combat` and has no `extra-turn` row at all, so the
 *  family is currently split between a wrong label and no label. Free to run — read-only.
 *
 *  Clause text is NOT stored on `cardClauses` records (`ClauseRecord` carries only `id`,
 *  `abilityType`, `trigger`, `actions` — see `canonicalize.ts`). Following `ledger-coverage.ts`'s
 *  pattern, the text is recomputed by re-running `segment()` over the card's own oracle text and
 *  keying the result by clause id.
 *
 *  EXPOSURE: that reconstruction keys a FRESH segment() by the STORED clause id, which is only
 *  correct when the two segmentations agree on clause count. They don't always — 84 of 2,541 cards
 *  (3.3%) have a fresh/stored clause-count mismatch that slides the ids, documented in
 *  `docs/superpowers/specs/2026-08-14-resource-ledger-design.md` §10 and named again for this card
 *  family in `docs/superpowers/specs/2026-08-14-threshold-lines-design.md`. Rather than trust a
 *  reconstructed text on a card where that could have happened, each card's stored `canonical.length`
 *  is compared against the fresh count and a mismatch is marked `MISALIGNED` on its rows — refuse to
 *  guess, per this repo's standing rule, rather than print a text that may belong to a different id. */
import { connect, loadConfig } from "@mtg/data";
import { segment } from "../segment.js";
import { CLAUSES_COLLECTION, DERIVED_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import type { Ability } from "../schema.js";

const store = await connect(loadConfig());

interface Row { name: string; verb: string; object: string; clause: string; derivedKinds: string[]; misaligned: boolean }

const rows: Row[] = [];
const clauseDocs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();
for (const doc of clauseDocs) {
  const card = await store.cards.findOne({ _id: doc.oracleId } as never);
  const texts: Record<number, string> = {};
  let freshLen = 0;
  if (card) {
    const fresh = segment(card.oracleText ?? "", card.keywords ?? [], card.typeLine ?? "");
    freshLen = fresh.length;
    for (const c of fresh) texts[c.id] = c.text;
  }
  const misaligned = doc.canonical.length !== freshLen;
  const hits = doc.canonical.flatMap((c) =>
    (c.actions ?? []).filter((a) => a.verb === "extra-turn" || a.verb === "extra-phase")
      .map((a) => ({ clause: texts[c.id] ?? "", verb: String(a.verb), object: String(a.object ?? "") })));
  if (!hits.length) continue;
  const derived = await store.db.collection(DERIVED_COLLECTION).findOne({ oracleId: doc.oracleId } as never);
  const kinds = ((derived as unknown as { abilities?: Ability[] } | null)?.abilities ?? [])
    .map((a) => String(a.effect?.kind ?? "")).filter(Boolean);
  for (const h of hits) rows.push({ name: String((card as Record<string, unknown> | null)?.name ?? "?"), ...h, derivedKinds: kinds, misaligned });
}

rows.sort((a, b) => a.name.localeCompare(b.name));
for (const r of rows) {
  console.log(`${r.name}${r.misaligned ? "  [MISALIGNED — stored/fresh clause count disagree, text untrustworthy]" : ""}\n   verb=${r.verb} object=${JSON.stringify(r.object)}\n   derives: ${r.derivedKinds.join(", ") || "(nothing)"}\n   clause: ${JSON.stringify(r.clause.slice(0, 160))}`);
}

const byVerb = new Map<string, number>();
for (const r of rows) byVerb.set(r.verb, (byVerb.get(r.verb) ?? 0) + 1);
const skips = rows.filter((r) => /\bskip\b/i.test(r.clause)).length;
const combat = rows.filter((r) => /\bcombat\b/i.test(r.clause + r.object)).length;
console.log(`\nactions: ${rows.length} over ${new Set(rows.map((r) => r.name)).size} cards`);
console.log(`by verb: ${[...byVerb].map(([v, n]) => `${v} ${n}`).join(" · ")}`);
console.log(`clauses saying "skip": ${skips}   naming combat: ${combat}`);
console.log(`cards currently deriving extra-combat: ${rows.filter((r) => r.derivedKinds.includes("extra-combat")).length}`);
console.log(`MISALIGNED (stored/fresh clause count disagree): ${new Set(rows.filter((r) => r.misaligned).map((r) => r.name)).size} card(s)`);

await store.close();
process.exit(0);
