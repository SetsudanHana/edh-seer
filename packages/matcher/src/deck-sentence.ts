import type { Cohesion } from "@mtg/engine";
import type { WinconReport } from "./wincon.js";

/** "WHAT IS THIS DECK" IS A THREE-SLOT SENTENCE, NOT A WORD (roadmap A16, Fable's framing after the
 *  owner's ruling that "the theme of the deck is what wins you a game… control is a means").
 *
 *  Win route ends the game · engine fuels it · means buys the time. Each slot is already computed by
 *  a different instrument, and every grading exercise this project ran until 2026-08-21 collapsed
 *  the three and scored a one-slot instrument against the composite: the theme headline agrees with
 *  the owner's own deck names 17 of 37 times, which is ~68% WITHIN the engine slot and 0% outside it
 *  BY CONSTRUCTION, because "Acererak Combo" names a win route and "Fandaniel Mono Black Control"
 *  names a means. Four naming designs were refused trying to make one argmax carry all three.
 *
 *  A JOIN, NEVER NEW ANALYSIS. Every clause reads a field the report already carries; a slot with
 *  nothing to say is null, and the renderers drop it rather than inventing a phrase. */
export interface DeckSentence {
  /** How the deck actually ends the game. Null when no win class was detected at all. */
  win: string | null;
  /** What the deck's cards watch for. Null when the theme layer DECLINED to name the deck (A15's
   *  `Cohesion.dominant`), which is the whole point of that flag reaching here. */
  engine: string | null;
  /** How much of the deck buys time. Null when no Interaction parent was computed. */
  means: string | null;
}

/** English for a wincon class. `burn` is deliberately "damage or drain" and not "burn": the class
 *  holds a Zulaport Cutthroat and a Lightning Bolt alike (roadmap A14 measured it primary in 27 of
 *  71 decks), and naming it "burn" would assert the narrower of the two on most of them. */
const WIN_PHRASE: Record<string, string> = {
  burn: "damage or drain",
  "go-wide": "attacking with a wide board",
  voltron: "one big creature",
  mill: "milling them out",
  combo: "a combo",
  "alt-win": "an alternate win condition",
  stompy: "attacking with big creatures",
};

/** THE WIN SLOT IS NOT AN ARGMAX, AND THE ARGMAX IS THE DEFECT (roadmap K4). A deck holding
 *  Thassa's Oracle wins with Thassa's Oracle, whatever 30 creatures it also plays — `winconReport`
 *  already knows this, which is why `combo` and `alt-win` are exempt from its FLOOR, and the
 *  sentence then threw the knowledge away by taking `classes[0]`.
 *
 *  **COMBO IS GATED ON THE ARCHETYPE, AND THE UNGATED RULE IS REFUSED ON MEASUREMENT.** 29 of the 71
 *  decks contain a known combo and `dominantArchetype === "combo"` on only **6**. Letting mere
 *  PRESENCE take the slot headlines "wins by a combo" on decks holding one two-card interaction —
 *  `bello-enchantress` (1 piece, a tokens deck), `flashy-azula` (1, spellslinger), `yuna-hope-of-
 *  spira` (1, counters) — which is the registered falsifier firing, and it agrees with the standing
 *  measurement that the 14 decks with <= 4 pieces are not combo decks at all.
 *
 *  THE GATE REMOVES COMBO FROM THE ARGMAX TOO, not just from the preference. Both routes produce the
 *  identical wrong sentence, so gating only the preference would leave `armies-of-saruman` (3
 *  pieces, a counters deck) still reading "wins by a combo" because combo happened to out-count
 *  everything else. A class the deck is not allowed to be named by is not a candidate.
 *
 *  ALT-WIN NAMES THE CARD. "An alternate win condition" hides a wrong detection; "(Thassa's Oracle)"
 *  exposes it, which is the cut list's discipline — print the fact and let the reader judge. */
export function deckSentence(
  cohesion: Cohesion | null | undefined,
  wincons: WinconReport | undefined,
  interaction: { count: number; target: number } | undefined,
  dominantArchetype?: string,
): DeckSentence {
  const classes = wincons?.classes ?? [];
  const comboEligible = dominantArchetype === "combo";
  const eligible = classes.filter((c) => c.class !== "combo" || comboEligible);
  // Combo first when the deck really is a combo deck — in one, an alt-win card is usually the
  // combo's own finisher (Thassa's Oracle is the archetypal case), so naming the combo is the
  // truer sentence. Then alt-win, then whatever is largest.
  const top = eligible.find((c) => c.class === "combo")
    ?? eligible.find((c) => c.class === "alt-win")
    ?? eligible[0];
  const phrase = top ? WIN_PHRASE[top.class] : undefined;
  // A class with no phrase is DROPPED, never printed raw: `winconReport`'s vocabulary can grow, and
  // a report saying "wins by stompy" is worse than a report saying nothing about how it wins.
  // ONLY ALT-WIN NAMES ITS CARDS. A combo deck's piece list is 28 names on `acererak-combo`, and a
  // sentence that recites them is not a sentence — the count is what a reader can use. An alternate
  // win condition is one or two cards and naming them is the whole point (criterion ii).
  const named = top?.class === "alt-win" && top.cards?.length
    ? ` (${top.cards.join(", ")})`
    : ` (${top?.count} ${top?.count === 1 ? "card" : "cards"})`;
  const win = top && phrase ? `wins by ${phrase}${named}` : null;
  const engine = cohesion && cohesion.dominant !== false
    ? `fueled by ${cohesion.theme} (${Math.round(cohesion.score * 100)}% of nonlands)`
    : null;
  const means = interaction
    ? `${interaction.count} interaction ${interaction.count === 1 ? "card" : "cards"} against a target of ${interaction.target}`
    : null;
  return { win, engine, means };
}
