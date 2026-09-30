/** WHAT A COST REDUCTION TAKES OFF, AND WHETHER IT DISCOUNTS ONLY ITS OWN CARD (#804).
 *
 *  A recast loop balances only if its mana covers the recast, so a reducer's size is part of the
 *  loop: Heartless Summoning takes Gravecrawler from {B} to nothing. The clause's `amount` states
 *  it on 201 of 518 corpus reducers, in four spellings ("-2", "{2}", "{2} less", "-{2}"), and not at
 *  all on Urza's Incubator. The printed text says it on every one that has a number, so the text
 *  is read first and the amount is the fallback.
 *
 *  `self`: "This spell costs {3} less" discounts Bone Picker and nothing else. Those abilities
 *  derive with NO subject (the static guard drops a bare singular) or a wildcard one (an on-cast
 *  whose object lost "this spell"), and a reader of the subject alone would apply them to every
 *  spell in the deck. Kept here rather than as `subject.self`, because `subjectMatches` does not
 *  know `self` and a static subject it cannot read matches every card.
 *
 *  CEILING: "{1} less for each ..." records the {1} per unit, and "if ..." the unconditional
 *  amount; the count and the condition are the ability's `threshold` and the text's. */
export type Reduction = { mana: string; self?: true };

const PRINTED = /\bcosts?\s+((?:\{[^}]+\})+)\s+less\b/i;
const SELF = /\bthis (?:spell|ability|card)\s+costs?\b/i;
const AMOUNT = /^-?\s*\{?(\d+|X)\}?/i;

export function reductionOf(text: string, amount: string | undefined): Reduction | undefined {
  const printed = PRINTED.exec(text)?.[1]?.toUpperCase();
  const stated = AMOUNT.exec(amount?.trim() ?? "")?.[1]?.toUpperCase();
  const mana = printed ?? (stated ? `{${stated}}` : undefined);
  if (!mana) return undefined;
  return SELF.test(text) ? { mana, self: true } : { mana };
}
