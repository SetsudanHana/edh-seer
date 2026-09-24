/** THE SIZE OF THE TRIGGERING EVENT (2026-09-25): Ghyrson Starn's "whenever another source you
 *  control deals EXACTLY 1 damage", Dragonborn Champion's "deals 5 OR MORE damage".
 *
 *  DIFFERENT FROM `Ability.threshold` and from `Ability.amount`. The threshold is how many of
 *  something must exist before the ability is on; the amount is how big its own effect is; this is
 *  how big the EVENT it watches must be. Without it the engine joined every pinger to Ghyrson --
 *  Eidolon of the Great Revel's 2, Flame-Kin War Scout's 4 -- and the clause layer cannot carry it
 *  (it records the trigger as `damage-dealt` by "another source you control"), so it is read off the
 *  printed trigger head, as `threshold` is.
 *
 *  DAMAGE ONLY, because damage is where the corpus prints it: seven trigger heads, measured
 *  2026-09-25 (Ghyrson and Sahir "exactly 1"; Pain Magnification and Innocent Bystander "3 or more";
 *  Spinneret and Spiderling 4, Dragonborn Champion 5, Deus of Calamity 6). A shape this does not
 *  recognise leaves the field unset -- the trigger reads wider than printed, as it did before. */

const WORD_NUMBER: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const N = `(\\d+|${Object.keys(WORD_NUMBER).join("|")})`;
/** "exactly N damage" or "N or more/greater damage", a combat qualifier allowed between. */
const SIZE = new RegExp(`\\b(?:exactly\\s+${N}|${N}\\s+or\\s+(?:more|greater))\\s+(?:noncombat\\s+|combat\\s+)?damage\\b`, "i");

const valueOf = (raw: string): number => WORD_NUMBER[raw.toLowerCase()] ?? Number(raw);

export interface EventAmount { op: "eq" | "gte"; value: number }

/** The size the trigger in `text` requires of its event, or undefined. Reads only the trigger head
 *  -- from "when"/"whenever" to the first comma -- so an effect's own "deals 2 damage" is never
 *  mistaken for the condition. */
export function eventAmountFor(text: string): EventAmount | undefined {
  const head = text.match(/\b(?:whenever|when)\b[^,]*/i)?.[0];
  const m = head?.match(SIZE);
  if (!m) return undefined;
  if (m[1] !== undefined) return { op: "eq", value: valueOf(m[1]) };
  const value = valueOf(m[2]!);
  // "1 or more damage" is any damage: no condition at all.
  return value > 1 ? { op: "gte", value } : undefined;
}
