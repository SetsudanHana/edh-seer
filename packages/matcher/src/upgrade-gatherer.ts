/** THE GATHERER (#767, task 6): one upgrade package per bracket target, from the options the
 *  sections ranked. What it adds over the options is the whole deck's view: the bracket guard on
 *  every take, and each card cut or added once.
 *
 *  ORDER. The bring-down cuts come first, all of them at once, so each one's replacement is checked
 *  against the deck with every bring-down cut already made; checked one at a time, the deck would
 *  still be above the target and the guard would refuse every replacement. Then the sections in the
 *  page's order -- Lands, Ramp, Consistency, Interaction, Board wipes, Synergy -- each taking its
 *  ranked options while the guard passes, up to `SECTION_MAX`. A section's later option for a cut is
 *  tried when an earlier one is refused, which is why the sections keep every option. */
import type { Card, Combo } from "@edh-seer/engine";
import { fitsTarget, type BringDown } from "./bracket-guard.js";
import type { DeckBracket } from "./brackets.js";
import { bringDownInReason, bringDownReason, gameChangerReasons, jobOf, landReasons, roleReasons } from "./upgrade-reasons.js";
import { ROLE_SECTIONS, type CutOptions, type LandOption, type Replacement, type RoleOption, type RoleSectionId } from "./upgrade-sections.js";
import { SECTION_MAX, UPGRADE_SECTIONS, type BracketTarget, type UpgradePackage, type UpgradeSection, type UpgradeSwap } from "./upgrade-package.js";

/** A synergy pair as the report's suggestions made it, with both reasons already written. */
export interface SynergySwap { out: string; in: string; outReason: string; inReason: string }

export interface GatherInput {
  target: BracketTarget;
  from: DeckBracket["band"];
  /** The deck as the guard reads it, commanders included. */
  deck: readonly Card[];
  /** Every combo anchored on the deck's cards and on every candidate, so a combo an add completes is seen. */
  combos: readonly Combo[];
  /** The card behind any add's name, for the guard (its Game Changer flag and mana value). */
  cardOf: (name: string) => Card | undefined;
  /** Every name on the precon's own list, commanders included: an add is never one of them, even when
   *  the card did not resolve (a card the lookup missed is still in the box). */
  inDeck: ReadonlySet<string>;
  bringDown: BringDown;
  replacements: ReadonlyMap<string, readonly Replacement[]>;
  roles: Record<RoleSectionId, readonly CutOptions<RoleOption>[]>;
  lands: readonly CutOptions<LandOption>[];
  synergy: readonly SynergySwap[];
}

/** One package, or `null` when no cut can bring the deck down to the target (its commander is a Game
 *  Changer, or a forbidden combo is made of commanders alone). */
export function gatherPackage(g: GatherInput): UpgradePackage | null {
  if (!g.bringDown.reachable) return null;
  const cuts: string[] = g.bringDown.cuts.map((c) => c.name);
  const adds: Card[] = [];
  const added = new Set<string>();
  const cutSet = new Set(cuts);
  /** Take a swap if both cards are free and the deck with it still fits the target. */
  const take = (cut: string | null, add: string): boolean => {
    if ((cut && cutSet.has(cut)) || added.has(add) || g.inDeck.has(add)) return false;
    const card = g.cardOf(add);
    if (!card) return false;
    if (!fitsTarget(g.deck, g.combos, cut ? [...cuts, cut] : cuts, [...adds, card], g.target)) return false;
    if (cut) { cuts.push(cut); cutSet.add(cut); }
    adds.push(card);
    added.add(add);
    return true;
  };

  const bringDown: UpgradeSwap[] = [];
  for (const c of g.bringDown.cuts) {
    const role = g.replacements.get(c.name)?.find((r) => take(null, r.add));
    const synergy = role ? undefined : g.synergy.find((s) => !cutSet.has(s.out) && take(null, s.in));
    const add = role?.add ?? synergy?.in;
    // NO CARD FITS THE SLOT UNDER THIS TARGET: the cut alone cannot make a package, so none is offered.
    if (!add) return null;
    bringDown.push({
      kind: "bring-down",
      out: { name: c.name, reason: bringDownReason(c, g.target) },
      in: { name: add, reason: role ? bringDownInReason(add, c, jobOf(role.role)) : synergy!.inReason },
      ...(role ? { role: role.role } : {}),
    });
  }

  const sections: UpgradeSection[] = [];
  for (const id of UPGRADE_SECTIONS) {
    const swaps: UpgradeSwap[] = [];
    if (id === "lands") {
      // GREEDY, WORST CUT FIRST, ON PURPOSE (owner 2026-10-08, #966): the worst land takes the best add
      // even when that leaves a later cut with nothing. The swaps are suggestions, not a binding
      // assignment -- "if they do the modification and reanalyze the swap will recalculate". Measured
      // on the 197 precons: 68 swaps fewer per page than the old deck-order pass (e.g. Abzan Armor's
      // Sunpetal Grove waits for Temple of Plenty to take Temple Garden); a maximum matching that kept
      // them was built and reverted as solving a problem the product does not have.
      for (const c of g.lands) {
        if (swaps.length >= SECTION_MAX) break;
        const o = c.options.find((x) => take(c.cut, x.add));
        if (o) { const r = landReasons(o); swaps.push({ kind: "land", out: { name: c.cut, reason: r.out }, in: { name: o.add, reason: r.in } }); }
      }
    } else if (id === "synergy") {
      for (const s of g.synergy) {
        if (swaps.length >= SECTION_MAX) break;
        if (take(s.out, s.in)) swaps.push({ kind: "synergy", out: { name: s.out, reason: s.outReason }, in: { name: s.in, reason: s.inReason } });
      }
    } else if ((ROLE_SECTIONS as readonly string[]).includes(id)) {
      for (const c of g.roles[id as RoleSectionId]) {
        if (swaps.length >= SECTION_MAX) break;
        const o = c.options.find((x) => take(c.cut, x.add));
        if (o) {
          const r = o.upgrade ? gameChangerReasons(c.cut, o) : roleReasons(c.cut, o);
          swaps.push({ kind: o.upgrade ?? "role", role: o.role, out: { name: c.cut, reason: r.out }, in: { name: o.add, reason: r.in } });
        }
      }
    }
    sections.push({ id, swaps });
  }
  return { target: g.target, from: g.from, bringDown, sections };
}
