/** "If <X> would be put into <a graveyard>, exile it instead" (CR 614, #1266 / #1306): what the sentence replaces, and whose graveyard it names.
 *
 *  - `rider`: X is a SPELL the card let you cast ("If that spell would be put into your graveyard", "a spell cast this way", "If you cast it this way and it would ..."). The spell is
 *    on the STACK, never reaches the graveyard, and is exiled from there: the replacement is no graveyard exile.
 *  - `hate`: a class of cards put into a graveyard "from anywhere" -- an opponent's or any ("a graveyard", Rest in Peace, Leyline of the Void, Dryad Militant, Valgavoth).
 *  - `own`: the same, into YOUR graveyard (Magus of the Will, Walk-In Closet): the card's owner is the one denied, which is not hate.
 *
 *  A card replacing ITSELF ("If Waildrifter would be put into a graveyard from anywhere", "this Aura") and the "would die" family are neither and return undefined.
 *  Index scans over the lowercase text: no regular expression with an unbounded tail. */
export type GraveyardReplacement = { kind: "rider" | "hate" | "own"; whose: "you" | "opp" | "any" };

const WOULD_BE_PUT_INTO = " would be put into ";
const EXILE_OBJECTS = ["it", "that card", "them", "that spell", "those cards", "those spells", "that creature", "that token"];
/** "exile it instead" and "instead exile it" (Dauthi Voidwalker prints the second order, "instead exile it with a void counter on it"). */
const EXILE_INSTEAD = EXILE_OBJECTS.flatMap((o) => [`exile ${o} instead`, `instead exile ${o}`]);
const CLASS_WORDS = ["card", "token", "permanent", "spell"];

export function graveyardReplacement(text: string): GraveyardReplacement | undefined {
  const lower = text.toLowerCase();
  const at = lower.indexOf(WOULD_BE_PUT_INTO);
  if (at < 0) return undefined;
  const start = lower.lastIndexOf("if ", at);
  const subject = lower.slice(start < 0 ? 0 : start + 3, at).trim();
  const rest = lower.slice(at + WOULD_BE_PUT_INTO.length);
  const gy = rest.indexOf(" graveyard");
  if (gy < 0) return undefined;
  const after = rest.slice(gy);
  // "exile it / that card / them ... instead", adjacent: Yawgmoth's Testament ("put it on the bottom of your library instead") names exile elsewhere in the sentence and is no exile replacement.
  if (!EXILE_INSTEAD.some((w) => after.includes(w))) return undefined;
  const named = rest.slice(0, gy);
  const whose = named.includes("your") ? "you" : named.includes("opponent") ? "opp" : "any";
  if (subject === "that spell" || subject === "those spells" || subject === "the spell" || /\bcast\b/.test(subject)) return { kind: "rider", whose };
  // "from anywhere", or a subject that says it is not on the battlefield (Sanctifier en-Vec): either way the card does not come from the battlefield alone.
  // CEILING: a replacement with no "from anywhere" and no "not on the battlefield" ("If a permanent would be put into a graveyard, exile it instead": Samurai of the Pale Curtain)
  // reaches only permanents dying, never a card from a hand or library, and is left unread rather than called graveyard hate; 1 commander-legal card on 2026-10-21.
  if (!(after.includes("from anywhere") || subject.includes("not on the battlefield")) || subject.startsWith("this ")) return undefined;
  if (!CLASS_WORDS.some((w) => subject.includes(w))) return undefined;
  return { kind: whose === "you" ? "own" : "hate", whose };
}
