/** THE PRECON UPGRADE PACKAGE'S SHAPE (#767, plan `docs/plans/2026-09-30-precon-upgrade-package.md`).
 *
 *  For each bracket target a precon page offers one package: the cuts that bring the deck down to
 *  that target when it starts above it, then role sections of paired swaps. Every swap carries a
 *  reason on both sides. Price is ignored (owner, 2026-09-28).
 *
 *  Only the shape and the target table live here, so the builder (`build-precons`) and the
 *  instrument that checks it (`precon-package-score`) read one definition. */
import type { DeckBracket } from "./brackets.js";

export type BracketTarget = 2 | 3 | 4;
export const BRACKET_TARGETS: readonly BracketTarget[] = [2, 3, 4];

export type UpgradeSectionId = "lands" | "ramp" | "consistency" | "interaction" | "wipes" | "synergy";
/** The order the page reads and the gatherer takes them in. */
export const UPGRADE_SECTIONS: readonly UpgradeSectionId[] = ["lands", "ramp", "consistency", "interaction", "wipes", "synergy"];

export interface UpgradeSide {
  name: string;
  /** Why this card goes (on `out`) or comes in (on `in`), in player words. Never empty. */
  reason: string;
}

export interface UpgradeSwap {
  out: UpgradeSide;
  in: UpgradeSide;
  /** `role`: a strictly better card in the same role. `land`: a better land. `synergy`: an on-plan
   *  card for a loose one. `bring-down`: a cut that puts the deck under a lower target. */
  kind: "role" | "land" | "synergy" | "bring-down";
  /** For `role` swaps, the build category (`BUILD_CATEGORIES`) the two cards are compared in. */
  role?: string;
}

export interface UpgradeSection {
  id: UpgradeSectionId;
  /** Ranked, at most `SECTION_MAX`; the page shows the first `SECTION_SHOWN`. */
  swaps: UpgradeSwap[];
}

export interface UpgradePackage {
  target: BracketTarget;
  /** The precon's own band before any swap. */
  from: DeckBracket["band"];
  /** Cuts first, when `from` is above the target (owner, 2026-09-30). Empty otherwise. */
  bringDown: UpgradeSwap[];
  sections: UpgradeSection[];
  /** THE DECK AFTER THE SWAPS, as the report reads it (#767, persona re-run 2026-09-30: "would I keep
   *  up?"): its band, its synergy score and its mana base total. Absent when the builder had no
   *  analysis to hand. */
  after?: { band: DeckBracket["band"]; synergy: number; mana: number };
}

export const SECTION_SHOWN = 3;
export const SECTION_MAX = 5;

/** THE TARGET TABLE. The bands cannot tell 1 from 2 or 4 from 5 (`brackets.ts`), so neither can the
 *  targets: 2 is band 1-2, 3 is band 3 or lower, and 4 takes any band. */
export function bandFits(band: DeckBracket["band"], target: BracketTarget): boolean {
  if (target === 2) return band === "1-2";
  if (target === 3) return band !== "4-5";
  return true;
}
