import type { Clause } from "../segment.js";
import type { Marker, Requirement } from "../schema.js";

/** ABILITY WORDS THAT NAME A GAME-STATE MARKER. The segmenter strips every ability word off a clause
 *  (`ABILITY_WORD`, segment.ts), which is right for the model -- "Landfall" is flavour to a clause
 *  that already says "whenever a land enters" -- and wrong for the ones that carry a CONDITION the
 *  clause does not restate. "Max speed —" is the first: its ability exists only while the player's
 *  speed is 4 (CR 702.179), and 34 commander-legal cards derived it unconditional. The marker is
 *  the PLAYER's, so the requirement is evaluated against a state the owner supplies (roadmap W18),
 *  never against a card. Grows one row per marker; the union in `schema.ts` grows with it. */
const MARKER_WORDS: [RegExp, Requirement][] = [
  [/^Max speed\s*—\s*/i, { marker: "speed", min: 4 }],
];

/** Clause id -> the requirement its printed line carries. Matched by the line's tail: the clause
 *  text is the line with the ability word, and the activation cost, already taken off it. */
export function clauseRequiresOf(oracleText: string, clauses: readonly Clause[]): Record<number, Requirement> {
  const out: Record<number, Requirement> = {};
  for (const line of oracleText.split("\n")) {
    for (const [word, requirement] of MARKER_WORDS) {
      if (!word.test(line)) continue;
      const body = line.replace(word, "").trim();
      const hit = clauses.find((c) => c.text && body.endsWith(c.text.trim()));
      if (hit) out[hit.id] = requirement;
    }
  }
  return out;
}

/** THE BOOLEAN MARKERS live inside the clause text: "if you're the monarch", "as long as you have
 *  the city's blessing", "if you have the initiative", "as long as you've completed a dungeon",
 *  "as long as it's night". Read only where the condition governs the WHOLE clause -- at its head
 *  (after the trigger opener) or trailing on a one-sentence clause -- so a mid-clause alternative
 *  ("create X. If you're the monarch, create Y instead") keeps both branches unconditional, which
 *  is what the clause records today. Day is not here: no commander-legal card conditions on it. */
const CONDITIONS: [RegExp, Marker][] = [
  [/\byou.?re the monarch\b/i, "monarch"],
  [/\byou have the initiative\b/i, "initiative"],
  [/\byou have the city.s blessing\b/i, "blessing"],
  [/\byou.?ve completed a dungeon\b/i, "dungeon"],
  [/\bit.?s night\b/i, "night"],
];
// NO OVERLAPPING WHITESPACE TOKENS: a lazy `[^,.]+?` beside `\s*` is polynomial on a run of
// spaces (CodeQL js/polynomial-redos, PR #197). The capture may carry its edge spaces; it is
// trimmed below.
const HEAD = /^(?:(?:whenever|when|at the beginning of|at end of)[^,]*, )?(?:if|as long as) ([^,.]+),/i;
const TAIL = /(?:^| )(?:if|as long as) ([^,.]+)\.?$/i;

/** CEILING: ONE REQUIREMENT PER CLAUSE. A condition on a clause's SECOND sentence -- Radiant
 *  Destiny's "Creatures ... get +1/+1. As long as you have the city's blessing, they also have
 *  vigilance." -- cannot be attached without silencing the first sentence too, so it is not read
 *  and the whole clause stays unconditional. Measured 2026-09-06: monarch 11 cards read of 25
 *  printed conditions, blessing 6 of 25, dungeon 5 of 15. The upgrade is a requirement per action. */
export function requiresOf(text: string): Requirement | undefined {
  const sentences = text.split(/\.\s+/).filter(Boolean).length;
  const trimmed = text.trim();
  const cond = (HEAD.exec(trimmed)?.[1] ?? (sentences <= 1 ? TAIL.exec(trimmed)?.[1] : undefined))?.trim();
  if (!cond) return undefined;
  for (const [re, marker] of CONDITIONS) if (re.test(cond)) return { marker, min: 1 };
  return undefined;
}
