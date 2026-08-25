import type { DeckCard } from "./types.js";

/** COMMANDER DAMAGE IS TWENTY-ONE, AND IT MUST COME FROM ONE CREATURE (CR 903.10a, 704.6c).
 *
 *  THE OBVIOUS FIX IS REFUTED BY MEASUREMENT AND THIS MODULE EXISTS BECAUSE OF IT (roadmap J2).
 *  Swapping `STARTING_LIFE` from 40 to 21 in `pressure.ts` moves the clock about two turns earlier on
 *  every deck that detects voltron — and the number would be a LIE, because `pressureCurve` is TOTAL
 *  BOARD POWER while commander damage comes from ONE creature. **Base commander power across those
 *  decks is 2, 3, 3, 3, 3, 2, 5, 10 and 2**, so a bare commander needs five to eleven connections.
 *  Nothing here touches the clock; this is a separate, commander-only number.
 *
 *  A RANGE AND NEVER A POINT, for the reason `castability.ts` and the goldfish model both reached
 *  independently: the two ends are two different assumptions and the truth is between them.
 *  - **bare** — the commander connects alone, carrying nothing. A floor.
 *  - **kitted** — the commander carries EVERYTHING the deck can attach to one creature. A ceiling,
 *    and a wild one: `nashi-sole-survivor` runs 21 attachables, and drawing, casting and equipping
 *    all of them is not a game anyone plays.
 *
 *  IT REPORTS ONLY WHERE THE DECK IS ACTUALLY TRYING, and the gate is an EXISTING decision rather
 *  than a new threshold: the caller passes the deck's detected archetype, and a deck that is not
 *  voltron gets nothing. Otherwise a 1-power commander in a spellslinger deck is told it needs
 *  twenty-one connections, which is true, useless and noise.
 *
 *  MEASURED over the 71 calibration decks — and the separation is sharp enough to read at a glance:
 *  `who-is-the-reddest-of-them-all` 23 attachables (11 bare -> 1 kitted) · `nashi-sole-survivor` 21
 *  (11 -> 1) · `voltron-mill` 11, on a 10-power commander (3 -> 1) · `obeka-upkeep-shenanigans` 5
 *  (11 -> 3). **Those are exactly the four decks J3's fix leaves in the `voltron-auras` edge group**,
 *  reached by a different table, which is the only cross-check available here. */
export const COMMANDER_DAMAGE = 21;

/** What the deck can bolt onto one creature: Equipment, and Auras that enchant a creature. The same
 *  pair `ARCHETYPE_SIGNATURE`'s voltron row keys on, and the same "aura only when it enchants a
 *  creature" qualifier — an Aura on a land is not carrying anyone into combat. */
const ENCHANTS_CREATURE = /enchant creature/i;
/** A FLAT printed bonus, and A RATE IS NOT AN AMOUNT — the same distinction I4's `manaAdded` needed
 *  one subsystem over, and it bit here too: Ethereal Armor's *"gets +1/+1 FOR EACH enchantment you
 *  control"* contains the literal `+1/+1` and is not a `+1`. A bonus this cannot put a number on
 *  contributes ZERO, which under-states the ceiling rather than inventing a board state. */
const FLAT_BONUS = /\+(\d+)\/\+\d+/;
const A_RATE = /\+\d+\/\+\d+\s+(?:for each|equal to)\b|\+X\/\+X/i;

export interface CommanderDamage {
  commander: string;
  /** Printed power. `*` and a missing power are not numbers and yield no row at all. */
  power: number;
  /** Total flat power the deck could attach to one creature. */
  attachable: number;
  /** How many Equipment and creature-Auras the deck runs. The count is the honest signal — 23 is a
   *  voltron deck and 1 is a Lightning Greaves. */
  attachableCount: number;
  /** Connections to deal 21 with the commander carrying nothing. */
  bare: number;
  /** …and carrying everything the deck can attach. A ceiling, and a wild one. */
  kitted: number;
}

/** The commander-damage requirement, or an empty list when the deck is not trying for it.
 *
 *  `archetype` is the deck's own detected top archetype — passed in rather than recomputed, so this
 *  module cannot disagree with `detectArchetypes` about what the deck is. */
export function commanderDamage(
  deck: readonly DeckCard[],
  commanderNames: readonly string[],
  archetype: string | undefined,
): CommanderDamage[] {
  if (archetype !== "voltron") return [];
  const commanders = new Set(commanderNames);

  let attachable = 0;
  let attachableCount = 0;
  for (const dc of deck) {
    if (commanders.has(dc.card.name)) continue;
    const line = (dc.card.typeLine ?? "").toLowerCase();
    const text = dc.card.oracleText ?? "";
    if (!line.includes("equipment") && !(line.includes("aura") && ENCHANTS_CREATURE.test(text))) continue;
    attachableCount++;
    const m = A_RATE.test(text) ? null : FLAT_BONUS.exec(text);
    if (m) attachable += Number(m[1]);
  }

  const out: CommanderDamage[] = [];
  for (const dc of deck) {
    if (!commanders.has(dc.card.name)) continue;
    const power = Number(dc.card.power);
    // A `*` power is defined by the board and is not a number this can divide by — no row rather
    // than a guess, the same answer `powerOverMv` gives for the same reason.
    if (!Number.isFinite(power) || power <= 0) continue;
    out.push({
      commander: dc.card.name,
      power,
      attachable,
      attachableCount,
      bare: Math.ceil(COMMANDER_DAMAGE / power),
      kitted: Math.ceil(COMMANDER_DAMAGE / (power + attachable)),
    });
  }
  return out;
}
