/** WHO an action's payout goes to, read mechanically off the clause text.
 *
 *  The normalizer records what an action DOES and what it does it to, but not who performs it. When
 *  the actor is also the object ("target player loses 1 life") nothing is lost, because `parseSubject`
 *  reads the control straight out of the object text. When the actor is the SUBJECT of the verb
 *  ("its controller creates a 3/3 green Ape") the object is the created thing and the actor is gone:
 *  Pongify's Ape derives control "any", and `any` matches `you` on either side (matcher/src/subject.ts),
 *  so a removal spell reads as a token producer for your own token payoffs.
 *
 *  Done here rather than by asking the model for a recipient field, for the same reason
 *  `effectActions` and `costActions` are: it is mechanical, so it is free, deterministic, and costs
 *  no re-buy of the corpus. It also reaches the cards the persist gate refuses, which a prompt change
 *  never would.
 *
 *  Measured over the 2,539 persisted clause docs: 86 actions across 80 cards name their own actor and
 *  drop it. 50 of those name a plain PLAYER and are already right — `any` is the true answer there,
 *  and claiming `opp` would be a wrong answer rather than a sharper one. This table speaks only for
 *  the other 36. */
import type { Control } from "../schema.js";

/** Every way the corpus names an actor before a verb. Kept as one alternation so the cue table below
 *  stays one line per verb. */
const WHO = "its controller|their controller|target opponent|each opponent|each other player|that player|target player|each player|those players";

/** The actor must sit immediately against its OWN verb. "each opponent loses 1 life and you gain 1
 *  life" is the commonest drain wording in the corpus, and reading its recipient onto the gain would
 *  hand your own lifegain payoffs to the opponent — the exact false-edge shape this exists to remove.
 *  Only `may` is allowed to intervene, because only `may` never changes who acts. */
const CUES: [string, RegExp][] = [
  ["create", new RegExp(`\\b(${WHO})\\s+(?:may\\s+)?creates?\\b`, "i")],
  ["draw", new RegExp(`\\b(${WHO})\\s+(?:may\\s+)?draws?\\b`, "i")],
  ["search", new RegExp(`\\b(${WHO})\\s+(?:may\\s+)?searc(?:h|hes)\\b`, "i")],
  ["mill", new RegExp(`\\b(${WHO})\\s+(?:may\\s+)?mills?\\b`, "i")],
  ["lose-life", new RegExp(`\\b(${WHO})\\s+(?:may\\s+)?loses?\\s+\\S+\\s+life\\b`, "i")],
  ["gain-life", new RegExp(`\\b(${WHO})\\s+(?:may\\s+)?gains?\\s+\\S+\\s+life\\b`, "i")],
  ["add-counter", new RegExp(`\\b(${WHO})\\s+(?:may\\s+)?puts?\\b[^.]{0,40}?counters?\\s+on\\b`, "i")],
];

/** An actor phrase to the control it states, or undefined when it states nothing sharper than "any".
 *
 *  "its controller" is a DECISION, not a reading: the rules let you point Pongify at your own
 *  creature, so the honest rules answer is "any". It is called `opp` because these are removal spells
 *  and that is where they get pointed, and because being wrong here only ever removes an edge. */
function controlOf(phrase: string, text: string, at: number): Control | undefined {
  const p = phrase.toLowerCase();
  if (p === "its controller" || p === "their controller") return "opp";
  if (p === "target opponent" || p === "each opponent" || p === "each other player") return "opp";
  // "that player" points back at whoever the clause already named. The antecedent is in the same
  // clause, so this one needs no judgment: Massacre Wurm's "a creature an opponent controls dies,
  // that player..." is an opponent, while "choose target player. That player..." is not.
  if (p === "that player") return /\bopponents?\b/i.test(text.slice(0, at)) ? "opp" : undefined;
  return undefined; // target player, each player, those players — "any" is already the right answer
}

/** Verb -> the control its actor states, for the verbs whose actor the clause names. Absent verbs are
 *  left exactly as the object text parsed them. */
export function actionRecipients(clauseText: string): Record<string, Control> {
  const out: Record<string, Control> = {};
  for (const [verb, re] of CUES) {
    const m = re.exec(clauseText);
    if (!m) continue;
    const control = controlOf(m[1], clauseText, m.index);
    if (control) out[verb] = control;
  }
  return out;
}
