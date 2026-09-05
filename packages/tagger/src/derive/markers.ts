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
// NO REGEX SCAN OVER THE CLAUSE. Two cuts flagged as polynomial by CodeQL (js/polynomial-redos,
// PR #197): a lazy class beside `\s*`, then an anchored tail whose class could span " if " again.
// The condition is found by index -- an opener cut at its first comma, a tail cut at the LAST
// "if"/"as long as" -- and only the short condition itself meets a regex.
const OPENERS = ["whenever ", "when ", "at the beginning of ", "at end of "];
const CONDITION_WORDS = ["if ", "as long as "];

/** The head condition: "[opener,] if COND, ..." -> COND. */
function headCondition(text: string): string | undefined {
  const lower = text.toLowerCase();
  let rest = text;
  if (OPENERS.some((o) => lower.startsWith(o))) {
    const comma = text.indexOf(",");
    if (comma < 0) return undefined;
    rest = text.slice(comma + 1).trimStart();
  }
  const word = CONDITION_WORDS.find((w) => rest.toLowerCase().startsWith(w));
  if (!word) return undefined;
  const body = rest.slice(word.length);
  const comma = body.indexOf(",");
  if (comma < 0) return undefined;
  const cond = body.slice(0, comma);
  return cond.includes(".") ? undefined : cond.trim();
}

/** The tail condition on a one-sentence clause: "... if COND." -> COND, taken at the LAST "if". */
function tailCondition(text: string): string | undefined {
  const body = text.endsWith(".") ? text.slice(0, -1) : text;
  const lower = body.toLowerCase();
  const at = Math.max(...CONDITION_WORDS.map((w) => lower.lastIndexOf(` ${w}`)));
  if (at < 0) return undefined;
  const word = CONDITION_WORDS.find((w) => lower.startsWith(` ${w}`, at))!;
  const cond = body.slice(at + 1 + word.length);
  return cond.includes(",") || cond.includes(".") ? undefined : cond.trim();
}

export function requiresOf(text: string): Requirement | undefined {
  const trimmed = text.trim();
  const sentences = trimmed.split(". ").filter(Boolean).length;
  const cond = headCondition(trimmed) ?? (sentences <= 1 ? tailCondition(trimmed) : undefined);
  if (!cond) return undefined;
  for (const [re, marker] of CONDITIONS) if (re.test(cond)) return { marker, min: 1 };
  return undefined;
}
