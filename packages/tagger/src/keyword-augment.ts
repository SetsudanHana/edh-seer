import type { Ability, Control, StatPredicate, SubjectFilter, Verb } from "./schema.js";

interface KeywordRule {
  pattern: RegExp;
  /** connive-style: ensure these emit verbs exist somewhere. */
  ensureEmits?: { verb: Verb; control: Control }[];
  /** toughness-matters-style: ensure a static ability with this effect.subject (stats marker) exists. */
  ensureStaticStats?: { effectKind: string; subject: SubjectFilter };
}

const TOUGHNESS_MARKER_STATS: StatPredicate[] = [{ metric: "toughness", op: "gte", vs: "power" }];

/** Keywords/phrases with a fixed rules-text expansion the LLM tends to drop. Table is built to
 *  grow; connive is the one confirmed-broken keyword (its "then discard a card" clause is dropped
 *  even by a fresh single-card call), so only its discard signal is populated via `ensureEmits`.
 *  The toughness-matters phrase ("assigns combat damage equal to its toughness rather than its
 *  power") instead needs a synthetic static ability carrying a stats marker, via `ensureStaticStats`. */
const KEYWORD_RULES: KeywordRule[] = [
  { pattern: /\bconnives?\b/i, ensureEmits: [{ verb: "discard", control: "you" }] },
  {
    // Doran / Assault Formation / Bedrock Tortoise / Felothar — the fixed toughness-matters phrase.
    pattern: /assigns combat damage equal to its toughness rather than its power/i,
    ensureStaticStats: {
      effectKind: "damage-multiplier",
      subject: { type: "creature", control: "you", token: null, stats: TOUGHNESS_MARKER_STATS },
    },
  },
];

/** True if some ability already carries a static effect.subject with the given stats marker. */
function hasStaticStats(abilities: Ability[], want: StatPredicate[]): boolean {
  return abilities.some(
    (a) =>
      a.kind === "static" &&
      a.effect.subject?.stats?.some((p) => want.some((w) => p.metric === w.metric && p.op === w.op && p.vs === w.vs)),
  );
}

/** Deterministically add keyword-implied signals the LLM tends to drop. For each rule in
 *  `KEYWORD_RULES` whose pattern matches the oracle text, ensure its required effect is present
 *  somewhere in the card's abilities — either an emit verb (`ensureEmits`) or a static ability
 *  carrying a stats marker (`ensureStaticStats`) — adding one synthetic static ability per missing
 *  effect. Idempotent and non-mutating: a card that already satisfies a rule's effect is returned
 *  unchanged for that rule (safe to re-run, including by the `augment-existing.ts` migration script). */
export function augmentKeywordAbilities(oracleText: string, abilities: Ability[]): Ability[] {
  const present = new Set<string>();
  for (const a of abilities) for (const e of a.emits ?? []) present.add(e.verb);

  const additions: Ability[] = [];
  for (const rule of KEYWORD_RULES) {
    if (!rule.pattern.test(oracleText)) continue;
    for (const { verb, control } of rule.ensureEmits ?? []) {
      if (present.has(verb)) continue;
      present.add(verb);
      additions.push({ kind: "static", effect: { kind: "draw-card" }, emits: [{ verb, subject: { control, token: null } }] });
    }
    if (rule.ensureStaticStats) {
      const want = rule.ensureStaticStats.subject.stats ?? [];
      if (!hasStaticStats([...abilities, ...additions], want)) {
        additions.push({ kind: "static", effect: { kind: rule.ensureStaticStats.effectKind, subject: rule.ensureStaticStats.subject } });
      }
    }
  }
  return additions.length ? [...abilities, ...additions] : abilities;
}
