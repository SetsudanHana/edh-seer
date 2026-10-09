/** THE UPGRADE PACKAGES' WORDS (#767, task 8), shared by the React page and the crawler HTML so the
 *  two never say different things about one package. Player words only (DESIGN.md, "Words"); the
 *  precon seat does not know "Game Changer" unexplained, so the one place it is named says what it is. */
import { TARGET_LABEL, type BracketTarget, type UpgradePackage, type UpgradeSectionId, type UpgradeSwap } from "@edh-seer/matcher/upgrade-package";
import type { PreconPage } from "./precon-page.js";

export const SECTION_TITLE: Record<UpgradeSectionId, string> = {
  lands: "Lands", ramp: "Ramp", consistency: "Card draw", interaction: "Removal and protection",
  wipes: "Board wipes", synergy: "Cards that work together",
};

/** WHAT EACH TARGET MEANS AT THE TABLE, as WotC's published limits read (`brackets.ts`). */
export const TARGET_MEANING: Record<BracketTarget, string> = {
  2: "No Game Changers and no infinite combos: the level of an unchanged precon.",
  3: "Up to three Game Changers, and no two-card infinite combo that costs 6 or less.",
  4: "No limits on Game Changers or combos.",
};
/** The one place the phrase is explained. */
export const GAME_CHANGER = "Game Changers are cards on WotC's official list of cards that make a deck much stronger.";

/** WHAT THE HERO'S NUMBER COUNTS (#991): every swap of the package it opens on, the folded ones too,
 *  for the bracket it names. `word` is the count spelled out. */
export function heroUpgradesLine(word: string, n: number, target: BracketTarget): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} ${n === 1 ? "swap" : "swaps"} below ${n === 1 ? "upgrades" : "upgrade"} it for bracket ${TARGET_LABEL[target]}; switch the bracket to see the others.`;
}
/** The report ranks the deck's gaps; the page is an upgrade package, so the two lists differ. */
export const REPORT_DIFFERS = "The full report is a different list: it ranks what the deck is short on, so its counts differ.";

export const swapsOf = (p: UpgradePackage): UpgradeSwap[] => [...p.bringDown, ...p.sections.flatMap((s) => s.swaps)];

/** THE TAB THE PAGE OPENS ON: the target the precon already sits in, so the first package keeps the
 *  game the owner is playing; the others are one click away. */
export function defaultTarget(page: Pick<PreconPage, "bracket" | "packages">): BracketTarget | null {
  const have = (page.packages ?? []).map((p) => p.target);
  if (have.length === 0) return null;
  const own: BracketTarget = page.bracket?.band === "4-5" ? 4 : page.bracket?.band === "3" ? 3 : 2;
  return have.includes(own) ? own : have[0]!;
}

/** "It starts at bracket 3, so the first swap brings it down." -- or nothing when it starts there. */
export function startsAbove(p: UpgradePackage): string {
  if (p.bringDown.length === 0) return "";
  const n = p.bringDown.length;
  return `It starts at bracket ${p.from.replace("-", "–")}, so the first ${n === 1 ? "swap brings" : `${n} swaps bring`} it down.`;
}

/** THE ANSWER TO "WOULD I KEEP UP?" THE PAGE CAN GIVE (persona re-run 2026-09-30): the bracket the deck
 *  still fits, and what the swaps do to its synergy score, as the report reads the swapped list. */
export function afterLine(p: UpgradePackage, before: number | null): string {
  const n = swapsOf(p).length;
  // THE BAND THE REPORT READS THE SWAPPED DECK AT, not the target: a target-4 package only has to fit
  // "any band", and 102 of 197 shipped ones end at 3 or 1-2 (#991 review).
  const head = p.after
    ? `${n} ${n === 1 ? "swap" : "swaps"}, and after them the report reads the deck at bracket ${p.after.band.replace("-", "–")}`
    : `${n} ${n === 1 ? "swap" : "swaps"}, and after them the deck still fits bracket ${TARGET_LABEL[p.target]}`;
  const s = p.after?.synergy;
  if (s === undefined || before === null) return `${head}.`;
  const from = before.toFixed(1);
  const to = s.toFixed(1);
  return to === from ? `${head}, and its synergy score stays at ${from} of 5.` : `${head}, and its synergy score goes from ${from} to ${to} of 5.`;
}

/** THE SAME SWAPS AS THE BRACKET BELOW, said, so a reader who switches up does not think the page
 *  ignored them (persona re-run 2026-09-30: "Bracket 3 gave me the exact same 9 swaps"). */
export function sameAsBelow(p: UpgradePackage, packages: readonly UpgradePackage[]): string {
  const below = packages.find((k) => k.target === p.target - 1);
  if (!below) return "";
  const key = (k: UpgradePackage) => swapsOf(k).map((s) => `${s.out.name}>${s.in.name}`).sort().join("|");
  if (key(below) !== key(p)) return "";
  return `These are the same swaps as at bracket ${TARGET_LABEL[below.target]}: none of the stronger cards bracket ${TARGET_LABEL[p.target]} allows does any of these jobs strictly better, so aiming higher changes nothing for this deck.`;
}
