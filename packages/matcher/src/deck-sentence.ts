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

export function deckSentence(
  cohesion: Cohesion | null | undefined,
  wincons: WinconReport | undefined,
  interaction: { count: number; target: number } | undefined,
): DeckSentence {
  const top = wincons?.classes?.[0];
  const phrase = top ? WIN_PHRASE[top.class] : undefined;
  // A class with no phrase is DROPPED, never printed raw: `winconReport`'s vocabulary can grow, and
  // a report saying "wins by stompy" is worse than a report saying nothing about how it wins.
  const win = top && phrase ? `wins by ${phrase} (${top.count} cards)` : null;
  const engine = cohesion && cohesion.dominant !== false
    ? `fueled by ${cohesion.theme} (${Math.round(cohesion.score * 100)}% of nonlands)`
    : null;
  const means = interaction
    ? `${interaction.count} interaction ${interaction.count === 1 ? "card" : "cards"} against a target of ${interaction.target}`
    : null;
  return { win, engine, means };
}
