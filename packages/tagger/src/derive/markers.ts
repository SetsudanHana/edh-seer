import type { Clause } from "../segment.js";
import type { Requirement } from "../schema.js";

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
