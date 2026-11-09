/** AN EXCEPTION THAT IS THE CARD ITSELF IS NOT A CLASS (#1575, the self-reference family), AND A CONDITION ON A TARGET IS NOT ITS TYPE.
 *
 *  `cutSelfException`: "all permanents other than this Equipment" (Worldslayer), "a permanent other than this enchantment" (Oath of Lim-Dul), "target permanent other than this creature" (Blizzard Strix), "each creature other than Massacre
 *  Girl", "a permanent other than that creature or this Equipment" (Saw). The words after "other than" are the card (or the creature it is attached to), so the class is the head and the exception is `other` (the same fact "another"
 *  states). Read whole, the noun of the exception became the class: Worldslayer destroyed only Equipment, Oath of Lim-Dul sacrificed only enchantments.
 *  Taken only when the whole tail is "this" / "that" with at most one noun, or one of the card's own names, joined by "or" / "and". Any other tail ("other than up to two chosen creatures", "other than this creature that weren't chosen",
 *  "other than Aminatou controlled by ...") is left to the readings that already handle it.
 *
 *  `cutCondition`: "destroy target nonland permanent if it's a creature or if {G}{W} was spent" (Mythos of Nethroi), "target creature if it's tapped" (Deathbringer Liege). The condition after the object is cut before the class is read, so the
 *  creature of "if it's a creature" does not narrow the permanent.
 *
 *  CEILING: a two-word noun after "this" ("this land card") is not an exception tail and is left uncut; the condition cut starts at the first " if it's / it is / its / that's " and drops everything after, so a second object
 *  later in the same object text is lost. Linear scans only. */
const CONNECTORS = new Set(["or", "and"]);
const DEMONSTRATIVES = new Set(["this", "that"]);

function selfForms(cardName: string): string[][] {
  const out: string[][] = [];
  for (const face of cardName.toLowerCase().split(" // ")) for (const f of [face, face.split(",")[0]!]) if (f !== "") out.push(f.split(" ").filter((w) => w !== ""));
  return out;
}

function isSelfTail(tail: string, cardName: string | undefined): boolean {
  const words = tail.trim().replace(/[.,;]+$/, "").split(" ").filter((w) => w !== "");
  if (words.length === 0) return false;
  const forms = cardName ? selfForms(cardName) : [];
  let i = 0;
  for (;;) {
    const w = words[i];
    if (w !== undefined && DEMONSTRATIVES.has(w)) {
      i++;
      if (i < words.length && !CONNECTORS.has(words[i]!)) i++;
    } else {
      const form = forms.find((f) => f.length > 0 && f.every((x, k) => words[i + k] === x));
      if (form === undefined) return false;
      i += form.length;
    }
    if (i >= words.length) return true;
    if (!CONNECTORS.has(words[i]!)) return false;
    i++;
  }
}

/** `{ head, other: true }` when the object ends in an exception that is the card itself, else undefined. */
export function cutSelfException(object: string, cardName?: string): { head: string } | undefined {
  const lower = object.toLowerCase();
  const at = lower.indexOf(" other than ");
  if (at < 0 || lower.indexOf(" other than ", at + 1) >= 0) return undefined;
  return isSelfTail(lower.slice(at + 12), cardName) ? { head: object.slice(0, at) } : undefined;
}

const CONDITIONS = [" if it's ", " if it is ", " if its ", " if that's "];
export function cutCondition(object: string): string {
  const lower = object.toLowerCase();
  let at = -1;
  for (const c of CONDITIONS) { const i = lower.indexOf(c); if (i >= 0 && (at < 0 || i < at)) at = i; }
  return at < 0 ? object : object.slice(0, at);
}
