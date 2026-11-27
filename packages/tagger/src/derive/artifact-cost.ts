/** A COST THAT GETS CHEAPER WITH, OR IS PAID WITH, ARTIFACTS YOU CONTROL IS AN ARTIFACT DEMAND (owner ruling 2026-11-24, #1804): it pairs with artifact producers as "for each artifact you control" does.
 *
 *  - "Affinity for artifacts" (CR 702.41a: "This spell costs {1} less to cast for each [text] you control") and "Improvise" (CR 702.126a: for each generic mana in the cost, tap an untapped artifact you control rather than pay it)
 *    are filed by the store as an inert `none` action. Each is the same count of artifacts as the sentence it stands for, so the line is rewritten to that sentence as a static cost-modify clause.
 *  - "This ability costs {1} less to activate for each other artifact you control" (Etherium Pteramander, Tamiyo's Logbook) is a sentence of the activated clause that the store carries no action for: a static clause of the same sentence is added.
 *
 *  Waterbend (#1815) is both: a cost the card pays itself reads as a count of artifacts you control plus creatures you control (`WATERBEND_SENTENCE`), once per card.
 *  Not read: affinity for another class ("artifact creatures", "historic permanents", "Equipment"), and a cost reduction that counts anything but your artifacts.
 *  CEILING: a waterbend cost is read as one static count on the card, whether it is an additional cost, an activated ability's cost or a "unless you waterbend" payment, and the tap itself is not modelled, nor that only the generic part of the waterbend amount can be paid with it (CR 701.67b).
 *  CEILING: improvise is read as the affinity count of artifacts, and no more: the tap itself (each artifact is tapped, so it cannot also attack or pay for another cost) is not modelled, nor that improvise pays only the generic part of the cost. */
import type { Action, ClauseRecord } from "../canonicalize.js";

const AFFINITY_OR_IMPROVISE = /^\s*(?:affinity for artifacts|improvise)\b/i;
const OWN_ABILITY = /\bThis ability costs (\{[^}]+\}) less to activate for each (other )?artifacts? you control\b/i;
export const SPELL_SENTENCE = "this spell costs {1} less to cast for each artifact you control";
/** A WATERBEND COST THE CARD PAYS ITSELF (#1815, owner ruling 2026-11-26; CR 701.67a: "Waterbend [cost]" means "Pay [cost]. For each generic mana in that cost, you may tap an untapped artifact or creature you control rather than pay that mana."). The cost is printed with its amount ("Waterbend {5}:",
 *  "waterbend {X}", "by waterbending {X}"). A trigger ("Whenever you waterbend", Avatar Aang) pays nothing, and a ward the OPPONENT pays ("Ward--Waterbend {4}", The Unagi of Kyoshi Island) taps the opponent's board, so neither is read. The count is of artifacts you control PLUS creatures you control (the summed-count reader, #811). */
const WATERBEND_COST = /\bwaterbend(?:ing)?\s*\{[^}]+\}/i;
const WARD_WATERBEND = /\bward\s*[-\u2014\u2013]\s*waterbend(?:ing)?\s*\{[^}]+\}/gi;
export const WATERBEND_SENTENCE = "this spell costs {1} less to cast for each artifact you control plus the number of creatures you control";

export function artifactCostClauses(clauses: ClauseRecord[], clauseTexts: Record<number, string> | undefined): { clauses: ClauseRecord[]; clauseTexts: Record<number, string> | undefined; sourceOf: Map<number, number> } {
  const sourceOf = new Map<number, number>();
  if (clauseTexts === undefined) return { clauses, clauseTexts, sourceOf };
  let texts = clauseTexts;
  let next = Math.max(0, ...clauses.map((c) => Number(c.id)).filter((n) => Number.isFinite(n))) + 1;
  const out: ClauseRecord[] = [];
  let waterbendRead = false;
  for (const c of clauses) {
    const text = texts[c.id as number] ?? "";
    if (c.abilityType === "none" && AFFINITY_OR_IMPROVISE.test(text)) {
      texts = { ...texts, [c.id]: SPELL_SENTENCE };
      out.push({ ...c, abilityType: "static", actions: [{ verb: "cost-modify", object: SPELL_SENTENCE } as Action] });
      continue;
    }
    out.push(c);
    if (!waterbendRead && WATERBEND_COST.test(text.replace(WARD_WATERBEND, ""))) {
      waterbendRead = true;
      texts = { ...texts, [next]: WATERBEND_SENTENCE };
      out.push({ id: next, abilityType: "static", actions: [{ verb: "cost-modify", object: WATERBEND_SENTENCE } as Action] } as ClauseRecord);
      // Stamped with the clause that prints the cost (see the ability discount below).
      sourceOf.set(next, Number(c.id));
      next++;
    }
    const own = OWN_ABILITY.exec(text);
    if (own && c.abilityType === "activated") {
      const sentence = `this ability costs ${own[1]} less to activate for each ${own[2] ?? ""}artifact you control`;
      texts = { ...texts, [next]: sentence };
      out.push({ id: next, abilityType: "static", actions: [{ verb: "cost-modify", object: sentence } as Action] } as ClauseRecord);
      // THE ROW SITS UNDER THE CLAUSE THAT PRINTS THE SENTENCE (the card page joins rows to clauses by id, and `next` has no printed segment): derive keeps `next` apart so the clauses stay two, and stamps this id on the ability.
      sourceOf.set(next, Number(c.id));
      next++;
    }
  }
  return { clauses: out, clauseTexts: texts, sourceOf };
}

/** What a cost-modify object derived from the lines above makes cheaper: the card's own cast, or one of its abilities. Undefined for any other cost-modify. */
export function costOfSentence(object: string | undefined): "spell" | "ability" | "waterbend" | undefined {
  if (object === SPELL_SENTENCE) return "spell";
  if (object === WATERBEND_SENTENCE) return "waterbend";
  return /^this ability costs \{[^}]+\} less to activate for each (?:other )?artifact you control$/.test(object ?? "") ? "ability" : undefined;
}
