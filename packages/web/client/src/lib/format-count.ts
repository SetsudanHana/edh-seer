import type { DeckReport } from "@edh-seer/engine";

/** A COUNT AS A PLAYER READS IT, AND NEVER ROUNDED UP (owner ruling 2026-10-27 B): FLOORED to one decimal, so 9.96 prints 9.9 and a deck a hair under its target never reads as on it; a whole number prints without
 *  ".0". Every gap is taken from the SHOWN count, in tenths of a card, so "9.9 of 10" and "0.1 short" cannot disagree. A copy of the matcher's `format-count.ts` (a client may not value-import a matcher subpath), with
 *  the same tests. */
export const tenths = (n: number): number => Math.floor(n * 10 + 1e-9);
export const fmtCount = (n: number): string => String(tenths(n) / 10);
/** How far a count sits under its target, from the shown count. */
export const gapShort = (count: number, target: number): number => Math.max(0, (Math.round(target * 10) - tenths(count)) / 10);
/** How far a count sits over its target, from the shown count; 0 when it exceeds it by less than a tenth. */
export const gapOver = (count: number, target: number): number => Math.max(0, (tenths(count) - Math.round(target * 10)) / 10);

type Conditional = NonNullable<DeckReport["conditionalRoles"]>[number];

/** A name as the gate text shows it: lowercase, with every face of a two-faced card. Put back in its printed case, by position, so no character in a name is read as a pattern. */
function restoreNames(needs: string, card: string): string {
  let out = needs;
  for (const name of [card, ...card.split(" // ")].sort((a, b) => b.length - a.length)) {
    const lower = name.toLowerCase();
    for (let from = 0, at = out.toLowerCase().indexOf(lower); at >= 0; at = out.toLowerCase().indexOf(lower, from)) {
      out = out.slice(0, at) + name + out.slice(at + name.length);
      from = at + name.length;
    }
  }
  return out;
}

/** A condition that reads as a sentence: no mana symbol and no second "if" (a gate cut in the wrong place carries the next effect). Those are said without it. */
const readable = (needs: string): boolean => !/[{}]| if /.test(needs);

/** THE CARDS THAT COUNT FOR LESS THAN ONE IN THESE ROLES, named with what they need: "Garna, Bloodfist of Keld counts half: it only works if it was attacking." A weight that is not exactly 0 or a half is "partly": no
 *  number here can round to a sure one. A card that answers only a narrow set of targets (`target`) counts whole and is not listed. Three at most, then how many more. Empty when nothing in the role is conditional. */
export function conditionalNote(rows: readonly Conditional[] | undefined, leaves: readonly string[]): string {
  const seen = new Set<string>();
  // An optional-cost choice (kicked, bargained, a promised gift) counts whole and is said as the choice it is, after the chances.
  const chosen = (rows ?? []).filter((r) => r.basis === "choice" && leaves.includes(r.category) && !seen.has(`${r.card}|choice`) && (seen.add(`${r.card}|choice`), true));
  const mine = (rows ?? []).filter((r) => r.basis !== "target" && r.weight < 1 && leaves.includes(r.category) && !seen.has(r.card) && (seen.add(r.card), true));
  const choices = chosen.slice(0, 3).map((r) => `${r.card} counts whole ${choiceWords(r.needs)}.`);
  if (mine.length === 0) return choices.join(" ");
  const how = (w: number): string => (w === 0 ? "for nothing" : w === 0.5 ? "half" : "partly");
  const said = mine.slice(0, 3).map((r) => `${r.card} counts ${how(r.weight)}: ${readable(r.needs) ? `it only works if ${restoreNames(r.needs, r.card)}` : "it only works under a condition on the card"}.`);
  if (mine.length > 3) said.push(`${mine.length - 3} more count for less than a whole card.`);
  return [...said, ...choices].join(" ");
}

/** "when kicked": the choice a condition names (the report's wording; the matcher flags the basis `choice`). */
function choiceWords(needs: string): string {
  const t = needs.toLowerCase();
  if (t.includes("gift was promised")) return "when the gift is promised";
  const m = /\b(?:was|were) (kicked|multikicked|bargained|overloaded|evoked)\b/.exec(t);
  return m ? `when ${m[1]}` : "when the extra cost is paid";
}
