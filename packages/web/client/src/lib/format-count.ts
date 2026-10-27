import type { DeckReport } from "@edh-seer/engine";

/** A ROLE COUNT AS A PLAYER READS IT (owner ruling 2026-10-27): one decimal place, and no ".0" on a whole number. A card that only half works counts half, so 9.5 of 10 stays 9.5 and is never rounded up into a sure card. */
export const fmtCount = (n: number): string => String(Math.round(n * 10) / 10);

type Conditional = NonNullable<DeckReport["conditionalRoles"]>[number];

/** THE CARDS THAT COUNT FOR LESS THAN ONE IN THESE ROLES, named with what they need: "Garna, Bloodfist of Keld counts half: it only works if it was attacking." A card that answers only a narrow set of targets (`target`) counts whole
 *  and is not listed. Three at most, then how many more. Empty when nothing in the role is conditional. */
export function conditionalNote(rows: readonly Conditional[] | undefined, leaves: readonly string[]): string {
  const seen = new Set<string>();
  const mine = (rows ?? []).filter((r) => r.basis !== "target" && r.weight < 1 && leaves.includes(r.category) && !seen.has(r.card) && (seen.add(r.card), true));
  if (mine.length === 0) return "";
  const how = (w: number): string => (w === 0 ? "for nothing" : w === 0.5 ? "half" : `as ${fmtCount(w)}`);
  const said = mine.slice(0, 3).map((r) => `${r.card} counts ${how(r.weight)}: it only works if ${r.needs.replace(r.card.toLowerCase(), r.card)}.`);
  if (mine.length > 3) said.push(`${mine.length - 3} more count for less than a whole card.`);
  return said.join(" ");
}
