import type { Ability, SubjectFilter } from "@edh-seer/tagger";

/** IS THIS SACRIFICE YOUR OWN COST? (#1805, owner ruling 2026-11-24: "it is not an answer it is part of the cost of the spell".) Derive files "Each foe sacrifices an artifact or enchantment" (Pir's Whim), "that creature's controller sacrifices" (Maarika), "unless they sacrifice" (Torment of Venom)
 *  and "Sacrifice them" (Devastating Onslaught's own copies) as a sacrifice of `control: "you"`, so the control says nothing. What does:
 *   - an ACTIVATION COST pays it (`payment.sacrifice` names the same types): the structural signal, read first;
 *   - a victim's option (`victimMay`, "unless they sacrifice") is never your cost. (A `token` subject is NOT read: "an artifact, enchantment, or token" and "Sacrifice them" both derive `token: true`; the printed words tell them apart);
 *   - a COUNT of "nonland permanent" (`notType`) is no named "X or Y", ruled or not;
 *   - the rest (an additional cost, "you may sacrifice", Kicker) have NO derived signal on the ability (the on-cast ability carries no cost), so the printed words decide: the sentence must hold a bare "sacrifice" in the imperative or after "you may" / an
 *     additional cost / Kicker. Third person ("sacrifices") is another player's, and a pronoun ("them", "it") is a thing already named.
 *  CEILING: the printed-words test is per card, not per sentence: a card with both an edict and a cost of the same types is read by its cost.
 *  The derive's control misread ("each foe sacrifices" as `you`) is the root cause and is NOT changed here. */
const OWN_PRINTED = /\badditional cost[^.]{0,200}?\bsacrifice\b|\bkicker\s*—\s*sacrifice\b|\byou may sacrifice\b|\b(?:by|and) sacrificing (?:an?|another|one|two|three|x|any number of)\b|(?:^|\n|[.:,—]\s*|\bthen |\bunless you |\bor )sacrifice (?:an?|another|one|two|three|x|any number of)\b/i;

const typesOf = (s: Partial<SubjectFilter> | undefined): string[] => (Array.isArray(s?.type) ? [...s!.type] : s?.type ? [s.type] : []).sort();

export function ownSacrificeCost(a: Ability, e: { subject: SubjectFilter; victimMay?: boolean }, oracleText: string | undefined): boolean {
  const s = e.subject;
  if (s.control !== "you" || s.self === true || s.notType !== undefined || e.victimMay === true) return false;
  const want = typesOf(s).join();
  if (a.payment?.sacrifice?.some((x) => typesOf(x.subject as SubjectFilter).join() === want)) return true;
  return OWN_PRINTED.test(oracleText ?? "");
}
