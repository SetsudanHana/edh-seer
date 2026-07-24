import type { Ability, Control, Verb } from "./schema.js";

interface KeywordRule {
  /** Matches the card's oracle text. */
  pattern: RegExp;
  /** Emit signals that must exist on the card's tags when the pattern matches. */
  ensureEmits: { verb: Verb; control: Control }[];
}

/** Keywords with a fixed rules-text expansion the LLM tends to drop. Table is built to grow;
 *  connive is the one confirmed-broken keyword (its "then discard a card" clause is dropped even
 *  by a fresh single-card call), so only its discard signal is populated. */
const KEYWORD_RULES: KeywordRule[] = [
  { pattern: /\bconnives?\b/i, ensureEmits: [{ verb: "discard", control: "you" }] },
];

/** Deterministically add keyword-implied emit signals the LLM tends to drop. For each rule whose
 *  pattern matches the oracle text, ensure every required emit verb is present somewhere in the
 *  card's abilities; a missing verb is added via one synthetic static ability. Idempotent and
 *  non-mutating: a card that already emits the verb is returned unchanged for that rule. */
export function augmentKeywordAbilities(oracleText: string, abilities: Ability[]): Ability[] {
  const present = new Set<string>();
  for (const a of abilities) for (const e of a.emits ?? []) present.add(e.verb);

  const additions: Ability[] = [];
  for (const rule of KEYWORD_RULES) {
    if (!rule.pattern.test(oracleText)) continue;
    for (const { verb, control } of rule.ensureEmits) {
      if (present.has(verb)) continue;
      present.add(verb); // guard against duplicate additions within this call
      additions.push({
        kind: "static",
        effect: { kind: "draw-card" },
        emits: [{ verb, subject: { control, token: null } }],
      });
    }
  }
  return additions.length ? [...abilities, ...additions] : abilities;
}
