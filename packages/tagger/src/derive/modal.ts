/** THE CLAUSES THAT ARE A MODAL SPELL'S OR ABILITY'S HEADER, for "face a dilemma" (Star Trek; owner ruling 2026-10-26, #1349).
 *
 *  "You face a dilemma as you choose one or more modes for a spell or ability" (the reminder of Seven of Nine, Elim Garak, Obsidian Order Operative and
 *  Tinkerer; the term is not in the Comprehensive Rules copy of 2026-09-25, so the reminder is its whole definition). A spell or ability is MODAL when it "has two
 *  or more options in a bulleted list preceded by instructions for a player to choose a number of those options" (CR 700.2), and the choice is made as it is cast,
 *  activated or put on the stack (CR 700.2a, 700.2b). The owner's ruling: EVERY such spell or ability is a producer, "choose one", "choose one or more", "choose two",
 *  "choose up to N", Escalate, Spree, Tiered and the rest, not only "choose one or more".
 *
 *  A HEADER is a clause the segmenter gave modes (`parentId`) whose own words choose a number of them, plus the Spree keyword line (CR 702.172a: "Choose one or more
 *  modes"; its modes carry a plus sign, not a bullet, so the segmenter gives them no parent) and the Tiered keyword line (CR 702.183a: "Choose one"). One header is one
 *  modal ability, so a card with two modal abilities emits twice and a card with one emits once, however many modes it prints.
 *
 *  NOT A DILEMMA, each by its words:
 *   - the choice is no number of modes: "choose Abzan or Mardu" (a Siege, made as it enters), "choose a color";
 *   - nobody chooses: "choose one at random" (Umaro, Raging Yeti);
 *   - ANOTHER player chooses (CR 700.2e): "an opponent chooses one" (Library of Lat-Nam). CEILING: the actor of the dilemma is then that player and "whenever YOU face a
 *     dilemma" is not heard; the opponent's side of it is not read.
 *  CEILING: the header is judged by its own words. A modal ability whose choice is made in a clause the segmenter did not give modes (a pre-Khans card, an inline
 *  "choose one; or ..." with no bullets) is not a header, so it emits nothing: a missing edge, never a wrong one. */
import type { Clause } from "../segment.js";

/** "choose one", "choose one or more", "choose any number", "choose up to two", "choose X", "choose three"... : the choice of a number of modes. */
const CHOOSES_MODES = /\bchoose (?:one|two|three|four|five|x|any number|up to \w+|one or (?:more|both))\b(?! at random)/i;

export function modalHeaderIds(clauses: readonly Clause[]): Set<number> {
  const heads = new Set<number>();
  const byId = new Map(clauses.map((c) => [c.id, c] as const));
  for (const c of clauses) {
    // The keyword line itself, whatever the segmenter hung the modes on (Vincent's Limit Break's are attached to its granted-ability clause, not to "Tiered").
    if (c.kind === "keyword" && /^(?:spree|tiered)$/i.test(c.text.trim())) heads.add(c.id);
    if (c.kind !== "mode" || c.parentId === undefined) continue;
    const parent = byId.get(c.parentId);
    if (!parent) continue;
    // A modal spell's header has no text of its own: its words ("Choose two") are the marker.
    const words = parent.kind === "modal" ? parent.marker ?? "" : parent.text;
    if (parent.kind !== "keyword" && CHOOSES_MODES.test(words)) heads.add(parent.id);
  }
  return heads;
}
