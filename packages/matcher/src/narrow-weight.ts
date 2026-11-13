/** WHAT A CARD COUNTS FOR WHEN IT DOES ITS JOB ONLY PART OF THE TIME BECAUSE OF A RESTRICTION IT CARRIES: ONE NUMBER, SHARED.
 *
 *  Two owner rulings of 2026-11-13 name it:
 *   - a COLOUR-LOCKED ANSWER (Combust "target white or blue creature", Pyroblast, Soul Rend, King Crab, Aether Gust, Western Paladin) counts as an answer with a weaker effect because of its restriction (#1266; it reverses the
 *     colour part of the 2026-10-27 #1357 ruling, which dropped colour hosers from answer coverage);
 *   - "WEAK STAX" counts the same way (small land destruction: two or X target lands; Urza's Sylex). A later PR applies it to the stax role; it imports this constant and does not restate the number.
 *
 *  The owner gave no figure. 0.5 is the repo's existing fixed partial weight for a restriction nothing here can read (`UNREAD_WEIGHT`, effect-gate-weight.json: a coin flip is the honest prior), and it is not fitted.
 *  A stat or state condition on the target (Fatal Push, Deathbringer Liege) is NOT this weight: it still covers fully and is marked `narrow`.
 *
 *  Kept apart from effect-gate-weight.ts on purpose: that module pulls in the gate evaluator and deck-fit, and `rules.ts` / `answer-coverage.ts` must stay light. */
export const NARROW_WEIGHT = 0.5;
