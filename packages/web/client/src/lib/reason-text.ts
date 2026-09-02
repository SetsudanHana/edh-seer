/** SPLITTING A REASON SENTENCE INTO THE THINGS IT NAMES (roadmap S18).
 *
 *  THE SKEPTIC'S SHARPEST FINDING, and it was true on nine screens: *"the page asserts a
 *  relationship between two named cards and never prints either card's text, so a right answer and
 *  a wrong one look identical on my screen."* The report's one mechanism for showing a card's text
 *  -- the drawer behind `CardName` -- was reachable from the row's own title and from nothing
 *  inside the sentence, so the OTHER card in every claim was dead text.
 *
 *  AND ONE OF THE TWO OFTEN IS NOT A CARD. Five of the example deck's eight high-synergy reasons
 *  begin "When Mark of the Rani enters", and `Mark of the Rani` is the commander's TOKEN: it is not
 *  in the decklist, `CardName` correctly refuses to link it (the drawer indexes card nodes, because
 *  92 of 661 token names collide with a real card's), and the page never said what it was. Both the
 *  tuner and the skeptic stopped on it, unable to tell whether it was a card, a token or a typo. */

export type ReasonSegment =
  | { kind: "text"; text: string }
  | { kind: "card"; text: string }
  | { kind: "token"; text: string; maker?: string };

/** Escapes a card name for use inside a RegExp. Names carry `'`, `,`, `-`, `//` and, in at least
 *  one case, a `+` — none of which may act as syntax here. */
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Split `text` into segments, marking every occurrence of a known card or token name.
 *
 * LONGEST FIRST, which is not a nicety: "Kefka, Court Mage // Kefka, Ruler of Ruin" contains
 * "Kefka, Court Mage", and matching the short one first leaves half a name behind as plain text —
 * the same rule `reasonTemplate` already states one file over.
 *
 * A name in BOTH sets is a card: a token that shares a real card's name is still not the thing the
 * decklist holds, and the drawer's own comment settles the collision the same way.
 */
export function reasonSegments(
  text: string,
  cards: ReadonlySet<string>,
  tokens: ReadonlyMap<string, string | undefined> = new Map(),
): ReasonSegment[] {
  const all = [...new Set([...cards, ...tokens.keys()])].sort((a, b) => b.length - a.length);
  if (all.length === 0) return [{ kind: "text", text }];
  const re = new RegExp(`(${all.map(escape).join("|")})`, "g");
  const out: ReasonSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    const name = m[0];
    if (cards.has(name)) out.push({ kind: "card", text: name });
    else out.push({ kind: "token", text: name, maker: tokens.get(name) });
    last = m.index + name.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
