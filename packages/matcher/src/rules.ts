import ruleSet from "./rules.json" with { type: "json" };
import type { DeckCard } from "./types.js";

/** A single test against one card. The operator set is CLOSED on purpose: `oracle`, `effectKind`,
 *  `typeLine` and an `anyOf` combinator cover every classifier that exists, and keeping it closed
 *  is what stops a config file mutating into a half-built query language. Anything graph-shaped
 *  (go-wide, recursion-in-the-dominant-chain, combo terminals) stays code and would arrive here as
 *  a named signature, not as more operators. */
export type RuleClause =
  | { op: "oracle"; pattern: string }
  /** `repeats` NARROWS the same operator rather than adding one (the set stays closed): when
   *  present, an ability counts only if its effect kind is in `in` AND its `Ability.repeats` label
   *  is in `repeats`, tested on the SAME ability -- a card with a one-shot draw and a repeatable
   *  sac outlet is not a draw engine. `null` names an ability `repeats.ts` refused to label. Owner,
   *  2026-09-05: "we count the one-off instant that draws 1 card the same way as Rhystic Study".
   *  `Ability.repeats` had sat on every derived ability since 2026-08-11 with no count reading it. */
  | { op: "effectKind"; in: string[]; repeats?: (string | null)[] }
  | { op: "typeLine"; contains: string }
  /** Card subtypes, from the tagged characteristics -- "equipment", "aura", a creature type. */
  | { op: "subtype"; in: string[] }
  /** Printed power minus mana value, at least this much. The one stat predicate the taxonomy needs
   *  (a creature bigger than it costs), written as a named comparison rather than an expression
   *  language: the moment this file can express arithmetic it stops being config and starts being
   *  a program nobody can gate. `*` power is not a number and never matches. */
  | { op: "powerOverMv"; atLeast: number }
  /** RAMP IS A NET GAIN (owner's rule, roadmap I4). A ONE-SHOT mana spell that adds no more than it
   *  costs is fixing, not acceleration: Dark Ritual is `{B}` for `{B}{B}{B}` and Manamorphose is two
   *  mana for two mana plus a cantrip. The second named comparison in this file, and written the
   *  same way `powerOverMv` is — the arithmetic lives in code and the config names only the
   *  threshold, because the moment this file can express arithmetic it stops being config.
   *
   *  IT JUDGES ONE-SHOTS ONLY, which is in the name because it is the whole subtlety. A PERMANENT
   *  mana source repeats, so Llanowar Elves nets 0 on the turn it lands and is ramp regardless —
   *  testing it would delete every mana dork in the format. */
  | { op: "oneShotNetsMana"; atLeast: number }
  /** A CREATURE WITH HEXPROOF PROTECTS ITSELF, NOT THE BOARD (roadmap I1). The `protection` pattern
   *  is matched anywhere in the oracle text, so Sylvan Caryatid — a mana dork whose printed keyword
   *  is hexproof — counted toward Interaction beside Lightning Greaves. True when EVERY protection
   *  word on the card is one of its own PRINTED KEYWORDS and nothing is granted away.
   *
   *  NARROW ON PURPOSE, and the measurement is why. Over the 71 decks the family splits 79 granted /
   *  20 self-keyword / 41 UNSPLITTABLE by any regex — "this spell can't be countered" and "phases
   *  out" are not keywords at all, and a card can grant with no cue this side of a parser
   *  (Delighted Halfling's "Legendary creature spells you cast can't be countered"). The honest fix
   *  for the residue is a derive-side read of the grant's SUBJECT, which is its own item; this
   *  clause takes only the cases the printed keyword list settles outright. */
  | { op: "protectionIsOwnKeyword" }
  | { op: "anyOf"; clauses: RuleClause[] };

export interface Rule {
  id: string;
  /** The build category this rule fills, if any. */
  category?: string;
  /** A FACET of a build category rather than a category of its own: a sub-count reported beside
   *  `of`'s count (draw engines beside draw), never a leaf, never a target. A facet rule fills no
   *  category, so `detectBuildRules` skips it and no parent union or `buildScore` can move. Data
   *  rather than code so the same op serves removal and lifegain when they ask. */
  facet?: { of: string; name: string };
  /** The wincon class this rule marks: how the card moves the game toward winning (design §12.5).
   *  A separate axis again -- a Craterhoof is a wincon and not a build category. */
  winconClass?: string;
  /** A fixed answer class this rule contributes (graveyard hate). */
  answerClass?: string;
  /** A pattern name whose `class` capture group names the answer class -- one rule covering the
   *  six types the removal regex already enumerates, rather than six near-identical rules. */
  answerClassFrom?: string;
  /** What KIND of answer this rule contributes, where the kind changes whether it answers at all
   *  (design §3.1). Absent = an ordinary one-shot answer, which is most of them. */
  mode?: "exile" | "recurring";
  /** ALL must hold. */
  match: RuleClause[];
  /** NONE may hold. */
  not?: RuleClause[];
  why?: string;
}

export interface RuleSet {
  version: number;
  patterns: Record<string, string>;
  answerClassAliases: Record<string, string[]>;
  rules: Rule[];
}

/** `rules.json`, IMPORTED RATHER THAN READ FROM DISK so the analysis path bundles for a browser
 *  (roadmap P2). It stays a plain editable artifact either way -- what changes is that an edit is
 *  picked up at build time rather than at the next process start. The cache went with the read. */
export function loadRules(): RuleSet {
  return ruleSet as RuleSet;
}

/** The rule set's version, bumped when `rules.json` changes semantics. Free to bump -- build
 *  categories are computed at analysis time and never stored, so there is no cache to invalidate
 *  and nothing to re-buy.
 *
 *  Declared AFTER `loadRules`, not beside the other exports. The temporal-dead-zone hazard this
 *  guarded against is gone with the `let cached` binding it named -- a JSON import is hoisted -- but
 *  the order costs nothing and the next `let` added above this line brings the hazard back. */
export const RULES_VERSION: number = loadRules().version;

const compiled = new Map<string, RegExp>();

/** Patterns are compiled once and case-insensitively, matching how every detector in build.ts was
 *  written and tested. Throws on an unknown name: a typo in a rule must fail loudly at load rather
 *  than silently never matching, which is the `hierarchy.json` failure mode this whole layer is
 *  supposed to avoid. */
function pattern(set: RuleSet, name: string): RegExp {
  let re = compiled.get(name);
  if (!re) {
    const src = set.patterns[name];
    if (src === undefined) throw new Error(`rules.json: unknown pattern "${name}"`);
    re = new RegExp(src, "i");
    compiled.set(name, re);
  }
  return re;
}

/** The `protection` pattern's own alternatives, as a global matcher, so `protectionIsOwnKeyword`
 *  can ask which of them a card actually says. Kept beside the op rather than read out of
 *  `rules.json` because the op's whole question is about THESE words against a printed keyword
 *  list, and a pattern edit that silently changed the question would be invisible. */
const PROTECTION_WORDS = /hexproof|indestructible|protection from|can't be countered|shroud|phases? out/gi;

/** Protection handed to something else. The templating is fixed enough to read — "creatures you
 *  control GAIN hexproof", "equipped creature HAS indestructible" — and this is the half that IS
 *  Interaction. */
/** Protection the card states about ITSELF in words that are not a printed keyword.
 *
 *  `protectionIsOwnKeyword` asks whether every protection word on a card is one of its OWN, and it
 *  answered that against the printed keyword list — so it could see "hexproof" on a Sylvan Caryatid
 *  and could not see **"This spell can't be countered"**, which is the same fact in a sentence.
 *  Measured over the 71 decks: **13 of the 113 cards the protection rule fires on say only this** —
 *  10 "this spell can't be countered" (Nezahal, Niv-Mizzet Parun, Hullbreaker Horror, Toski, Chandra
 *  Awakened Inferno, Rise of the Eldrazi, Glen Elendra's Answer, Commence the Endgame, Hexing
 *  Squelcher, Inferno of the Star Mounts) and 3 Myojin entering with an indestructible counter ON
 *  THEMSELVES. A creature that cannot be countered protects nothing but itself, and counting it as
 *  one of a deck's ten Interaction cards is the Sylvan Caryatid defect in a different sentence.
 *
 *  IT IS STRIPPED, NOT MATCHED, so a card that says both keeps its other half: the remaining words
 *  still have to clear the printed-keyword test, and a GRANT still wins before any of this runs. */
const SELF_PROTECTION =
  /\bthis spell can'?t be countered\b|\benters with an indestructible counter on it\b/gi;

/** Protection TAKEN AWAY FROM OPPONENTS, which is the opposite of protecting anything of yours.
 *
 *  Shadowspear's *"Permanents your opponents control lose hexproof and indestructible"* and Nowhere
 *  to Run's *"as though they didn't have hexproof"* are removal ENABLERS — they exist so your removal
 *  connects — and both were counted as Interaction of the PROTECTION kind, which is a true category
 *  reached by a false sentence. **12 corpus cards, 3 in the 71 decks** (those two plus The Fire
 *  Nation Drill).
 *
 *  STRIPPED BY SENTENCE, not by phrase, and the difference is load-bearing: Shadowspear names TWO
 *  protection words in one clause and a phrase-level cut would leave "indestructible" standing.
 *
 *  A CARD THAT DOES BOTH KEEPS ITS OWN HALF, which is why this is a strip and not a refusal —
 *  **Archetype of Endurance** grants hexproof to your creatures in one sentence and strips it from
 *  theirs in the next, and only the second sentence goes. */
const ANTI_PROTECTION =
  /\byour opponents control\b[^.]{0,90}?\b(?:lose|don'?t have|can'?t have|didn'?t have)\b[^.]{0,40}?\b(?:hexproof|shroud|indestructible|ward|protection from)\b/i;

/** Drop every sentence that takes protection away from an opponent. */
function withoutAntiProtection(text: string): string {
  return text.split(/(?<=[.!?])\s+|\n/).filter((line) => !ANTI_PROTECTION.test(line)).join(" ");
}

const GRANTS_PROTECTION =
  /\b(?:gains?|have|has|get|grants?)\b[^.]{0,70}?(?:hexproof|indestructible|shroud|protection from|phases? out)/i;

const NUMBER_WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** The most mana any one "Add …" sentence on the card states, or `undefined` when none of them
 *  states a fixed number.
 *
 *  THE MAXIMUM, not the sum: Cabal Ritual's second sentence is "Add {B}{B}{B}{B}{B} INSTEAD", and
 *  Rite of Flame's fixed `{R}{R}` sits beside a variable "for each card named Rite of Flame". Taking
 *  the largest readable one keeps the card whenever any branch of it accelerates, which is the
 *  lenient direction a refusal-shaped rule wants.
 *
 *  Read from ORACLE TEXT and not from the derived ability, deliberately and with a measurement
 *  behind it: `mana-generation` abilities carry NO amount and NO emit — Dark Ritual and Manamorphose
 *  derive BYTE-IDENTICALLY (`{kind: "on-cast", effect: {kind: "mana-generation"}}`) — so the fact
 *  this rule needs does not exist downstream of the clause layer. The clause DOES hold it, in
 *  `action.object` ("{B}{B}{B}", "two mana in any combination of colors", 537 add-mana actions
 *  corpus-wide), so deriving `Ability.amount` for it is the root-cause fix; it is a separate item
 *  because `Ability.amount` is read by `sentence.ts`, `lines.ts` and `supply-demand.ts` and would
 *  move reason text and threshold lines with it. → roadmap I4's own note. */
function manaAdded(oracle: string): number | undefined {
  let best: number | undefined;
  for (const m of oracle.matchAll(/\badd\s+((?:\{[^{}]+\}\s*)+|\w+ mana\b)/gi)) {
    const frag = m[1];
    let n: number | undefined;
    if (frag.trimStart().startsWith("{")) {
      n = 0;
      for (const sym of frag.matchAll(/\{([^{}]+)\}/g)) {
        if (/^\d+$/.test(sym[1])) n += Number(sym[1]);
        // A chosen amount is not a fixed one, and neither is what follows a "for each".
        else if (/^[XYZ]$/i.test(sym[1])) return undefined;
        else n += 1;
      }
    } else n = NUMBER_WORD[frag.trim().split(/\s+/)[0].toLowerCase()];
    if (n === undefined) return undefined;
    // "Add {R} FOR EACH card in target opponent's hand" states a rate, not an amount.
    if (/^\s*(?:for each|equal to|where|times)\b/i.test(oracle.slice(m.index + m[0].length))) return undefined;
    best = Math.max(best ?? 0, n);
  }
  return best;
}

function clauseHolds(clause: RuleClause, dc: DeckCard, set: RuleSet): boolean {
  switch (clause.op) {
    case "oracle":
      return pattern(set, clause.pattern).test(dc.card.oracleText ?? "");
    case "typeLine":
      return (dc.card.typeLine ?? "").toLowerCase().includes(clause.contains);
    case "effectKind":
      return (dc.tags?.abilities ?? []).some((a) =>
        clause.in.includes(a.effect.kind)
        && (clause.repeats === undefined || clause.repeats.includes(a.repeats ?? null)));
    case "subtype":
      return (dc.tags?.characteristics?.subtypes ?? []).some((s) => clause.in.includes(s.toLowerCase()));
    case "powerOverMv": {
      const power = Number(dc.card.power);
      // `*`, `1+*` and a missing power are all NaN, and a comparison against NaN is false -- which
      // is the answer we want: a creature whose power is defined by the board is not a beater whose
      // size can be read off the card.
      return power - dc.card.manaValue >= clause.atLeast;
    }
    case "oneShotNetsMana": {
      const line = (dc.card.typeLine ?? "").toLowerCase();
      // A card with a PERMANENT face is not a one-shot however its other half is typed. Bramble
      // Familiar // Fetch Quest is a Creature with a Sorcery Adventure and its `{T}: Add {G}` is a
      // mana DORK; Blazing Firesinger // Seething Song is the same shape. Reading the type-line
      // union alone cut both, which is the `isLand` mistake one card layout over.
      if (!/\b(instant|sorcery)\b/.test(line)) return true;
      if (/\b(creature|artifact|enchantment|land|planeswalker|battle)\b/.test(line)) return true;
      const added = manaAdded(dc.card.oracleText ?? "");
      // Unreadable means the card does not state a fixed number — "Add {R} for each card in target
      // opponent's hand" (Jeska's Will, Rousing Refrain, Path of the Pyromancer). Those are the most
      // explosive rituals in the format, so a missing answer must keep the card rather than cut it.
      if (added === undefined) return true;
      return added - (dc.card.manaValue ?? 0) >= clause.atLeast;
    }
    case "protectionIsOwnKeyword": {
      const txt = dc.card.oracleText ?? "";
      // A GRANT WINS, always: a card can print a keyword AND hand it out, and handing it out is the
      // Interaction fact. Checked first so the keyword list can never overrule it.
      // THE GRANT TEST READS THE SAME TEXT THE WORD COUNT DOES. Shadowspear's "Permanents your
      // opponents control LOSE hexproof" has no grant verb, but a sentence like "creatures your
      // opponents control don't HAVE hexproof" does — and `GRANTS_PROTECTION` matches on "have".
      // Asking both questions of the same stripped text is what keeps them from disagreeing.
      const granting = withoutAntiProtection(txt);
      if (GRANTS_PROTECTION.test(granting)) return false;
      const found = (t: string): Set<string> =>
        new Set([...t.matchAll(PROTECTION_WORDS)].map((m) => m[0].toLowerCase()));
      // NO PROTECTION AT ALL IS NOT SELF-PROTECTION. UNREACHABLE through the shipped rule — the op
      // only runs once the protection pattern has matched — and mutating it away changes no test,
      // which is stated rather than left for someone to discover. Kept because the op reads under
      // `not:`, so a wrong answer here SUPPRESSES the rule, and under-claiming is the direction.
      if (found(txt).size === 0) return false;
      // WHAT IS LEFT AFTER THE CARD'S CLAIMS ABOUT ITSELF. If nothing is, every cue was about the
      // card itself and it protects nothing else.
      const rest = found(withoutAntiProtection(txt).replace(SELF_PROTECTION, " "));
      if (rest.size === 0) return true;
      // "protection from Humans" is the printed keyword `protection`; the rest are their own word.
      const keywords = new Set((dc.tags?.characteristics?.keywords ?? []).map((k) => k.toLowerCase()));
      return [...rest].every((w) => keywords.has(w === "protection from" ? "protection" : w));
    }
    case "anyOf":
      return clause.clauses.some((c) => clauseHolds(c, dc, set));
  }
}

export function ruleMatches(rule: Rule, dc: DeckCard, set: RuleSet = loadRules()): boolean {
  return (
    rule.match.every((c) => clauseHolds(c, dc, set)) &&
    !(rule.not ?? []).some((c) => clauseHolds(c, dc, set))
  );
}

/** The type words a removal clause can name, and what each answers. `permanent` is not a class of
 *  its own -- it expands through `answerClassAliases`, because a card that destroys any permanent
 *  answers every class, and treating it as a sixth would report a Vindicate deck as having no
 *  enchantment removal. */
const KNOWN_CLASSES: Record<string, true> = {
  creature: true, permanent: true, artifact: true, enchantment: true, planeswalker: true, land: true,
};

/** What a matched rule says about the KIND of answer it contributes, per class.
 *
 *  Both default to false, which is the ordinary case: a destroy is an answer that is not
 *  recursion-proof, and a one-shot graveyard exile answers a card rather than an engine. */
export interface AnswerMarks {
  /** The threat is EXILED. The owner's ruling (design §2.1): a tuck can be drawn or tutored again
   *  and a destroyed permanent can be reanimated, so exile is the only recursion-proof answer. */
  exile: boolean;
  /** The answer keeps answering -- a replacement effect, a static prohibition, or an activated
   *  ability that can be used again. Only graveyard hate carries this today, because it is the one
   *  class §12.3 says does not score on count at all. */
  recurring: boolean;
}

/** Which answer classes a card covers, per `answerClass` / `answerClassFrom`.
 *
 *  `permanent` is expanded through `answerClassAliases`: a card that destroys any permanent answers
 *  every class, and treating it as its own sixth class would report a Vindicate deck as having no
 *  enchantment removal. */
export function answerClassesOf(dc: DeckCard, set: RuleSet = loadRules()): Map<string, AnswerMarks> {
  const out = new Map<string, AnswerMarks>();
  // A class can be reached by several rules -- every exile removal matches both `answers.typed` and
  // `answers.typed.exile` -- so marks are OR-ed onto the existing entry, never overwritten.
  const mark = (cls: string, mode: Rule["mode"]): void => {
    const m = out.get(cls) ?? { exile: false, recurring: false };
    if (mode === "exile") m.exile = true;
    if (mode === "recurring") m.recurring = true;
    out.set(cls, m);
  };
  for (const rule of set.rules) {
    if (!ruleMatches(rule, dc, set)) continue;
    if (rule.answerClass) mark(rule.answerClass, rule.mode);
    if (rule.answerClassFrom) {
      // Global sweep, not a single test: "destroy target artifact or enchantment" and cards with
      // two removal sentences each cover several classes, and one match would keep only the first.
      const re = new RegExp(set.patterns[rule.answerClassFrom], "gi");
      for (const m of (dc.card.oracleText ?? "").matchAll(re)) {
        // The capture is the whole OBJECT PHRASE after "target", not one type word: "destroy
        // target artifact or enchantment" answers two classes, and a single-word capture keeps
        // whichever came first. Every class named anywhere in the phrase counts.
        const phrase = m.groups?.class?.toLowerCase();
        if (!phrase) continue;
        // An answer aims at something you do NOT control. "Exile target creature you control, then
        // return it" is a blink (Essence Flux, Ghostly Flicker) and reads as removal to every
        // pattern here; measured on the calibration decks it was inflating Inalla's creature
        // answers from 3 to 4. "you don't control" does not contain "you control", so the negation
        // survives this check without needing its own clause.
        if (/\byou control\b/.test(phrase)) continue;
        // "You own" is the same claim in different words -- a permanent can be controlled by
        // someone else while still owned by you, and a planeswalker's own-permanent blink says it
        // that way (Venser, the Sojourner's +2; Slip On the Ring). Scoped to the EXILE mode only,
        // not to every rule sharing this sweep: `answers.typed`'s count must not move (measured --
        // "target permanent you own" also reaches Staff of Compleation, a plain self-destroy with no
        // return clause, which is real removal and a pre-existing count member; excluding it here
        // would drop a card the gate says can never leave a class).
        if (rule.mode === "exile" && /\byou own\b/.test(phrase)) continue;
        for (const word of Object.keys(KNOWN_CLASSES)) {
          if (!new RegExp(`\\b${word}\\b`).test(phrase)) continue;
          for (const cls of set.answerClassAliases[word] ?? [word]) {
            // "nonland permanent" answers everything except a land, and `permanent` alone expands
            // to all five. Without this a Pongify reads as land interaction.
            if (cls === "land" && /\bnonland\b/.test(phrase)) continue;
            mark(cls, rule.mode);
          }
        }
      }
    }
  }
  return out;
}
