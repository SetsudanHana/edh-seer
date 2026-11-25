/** A COST THAT GETS CHEAPER WITH, OR IS PAID WITH, ARTIFACTS YOU CONTROL IS AN ARTIFACT DEMAND (owner ruling 2026-11-24, #1804): it pairs with artifact producers as "for each artifact you control" does.
 *
 *  - "Affinity for artifacts" (CR 702.41a: "This spell costs {1} less to cast for each [text] you control") and "Improvise" (CR 702.126a: for each generic mana in the cost, tap an untapped artifact you control rather than pay it)
 *    are filed by the store as an inert `none` action. Each is the same count of artifacts as the sentence it stands for, so the line is rewritten to that sentence as a static cost-modify clause.
 *  - "This ability costs {1} less to activate for each other artifact you control" (Etherium Pteramander, Tamiyo's Logbook) is a sentence of the activated clause that the store carries no action for: a static clause of the same sentence is added.
 *
 *  Not read: affinity for another class ("artifact creatures", "historic permanents", "Equipment"), waterbend (it taps "artifacts and creatures"; not ruled), and a cost reduction that counts anything but your artifacts.
 *  CEILING: improvise is read as the affinity count of artifacts, and no more: the tap itself (each artifact is tapped, so it cannot also attack or pay for another cost) is not modelled, nor that improvise pays only the generic part of the cost. */
import type { Action, ClauseRecord } from "../canonicalize.js";

const AFFINITY_OR_IMPROVISE = /^\s*(?:affinity for artifacts|improvise)\b/i;
const OWN_ABILITY = /\bThis ability costs (\{[^}]+\}) less to activate for each (other )?artifacts? you control\b/i;
const SPELL_SENTENCE = "this spell costs {1} less to cast for each artifact you control";

export function artifactCostClauses(clauses: ClauseRecord[], clauseTexts: Record<number, string> | undefined): { clauses: ClauseRecord[]; clauseTexts: Record<number, string> | undefined } {
  if (clauseTexts === undefined) return { clauses, clauseTexts };
  let texts = clauseTexts;
  let next = Math.max(0, ...clauses.map((c) => Number(c.id)).filter((n) => Number.isFinite(n))) + 1;
  const out: ClauseRecord[] = [];
  for (const c of clauses) {
    const text = texts[c.id as number] ?? "";
    if (c.abilityType === "none" && AFFINITY_OR_IMPROVISE.test(text)) {
      texts = { ...texts, [c.id]: SPELL_SENTENCE };
      out.push({ ...c, abilityType: "static", actions: [{ verb: "cost-modify", object: SPELL_SENTENCE } as Action] });
      continue;
    }
    out.push(c);
    const own = OWN_ABILITY.exec(text);
    if (own && c.abilityType === "activated") {
      const sentence = `this ability costs ${own[1]} less to activate for each ${own[2] ?? ""}artifact you control`;
      texts = { ...texts, [next]: sentence };
      out.push({ id: next, abilityType: "static", actions: [{ verb: "cost-modify", object: sentence } as Action] } as ClauseRecord);
      next++;
    }
  }
  return { clauses: out, clauseTexts: texts };
}
