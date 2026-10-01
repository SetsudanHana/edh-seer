/** THE CARD'S OWN NAME WRITTEN "~" (Scryfall's convention), as the phrase census writes it (#896).
 *  The filter grammar was built and measured on census phrases, so derive hands it the same shape:
 *  one function, so the census and the switch cannot drift apart.
 *
 *  Each face's full name and its short form ("Gandalf" for "Gandalf, Shadow's Foe"), longest first,
 *  whole-word. CASE-SENSITIVE: Oracle capitalises a name, and Storm, Force of Nature's "has storm" is
 *  the keyword, not the card. */
export function selfAsTilde(phrase: string, name: string): string {
  const names = new Set<string>();
  for (const face of name.split(" // ")) {
    names.add(face);
    const short = face.split(",")[0]!;
    if (short !== face) names.add(short);
  }
  let out = phrase;
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\w'])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w'])`, "g"), "~");
  }
  return out;
}
