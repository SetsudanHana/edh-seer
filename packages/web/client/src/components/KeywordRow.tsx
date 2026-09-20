import { abilityClass, CardSymbol } from "./CardSymbol.js";

/** WHAT THE CARD ANNOUNCES ABOUT ITSELF (owner, 2026-09-20). A new row, not an annotation, and the
 *  distinction is the owner's own rule: keywords already reach the page inside the card's PRINTED
 *  LINES, and a printed line is prose that keeps its words. So the glyphs get a surface of their
 *  own above the reading, and `EngineReading`'s clause blockquotes are untouched.
 *
 *  THE WORD IS ALWAYS THERE AND THE GLYPH IS ALWAYS EXTRA. Measured over the corpus on 2026-09-20:
 *  mana draws 134 of the 811 distinct keywords this corpus carries, 69.0% of 22,682 renderings --
 *  and the misses are not a long tail, `equip` (605 cards) being more common than `haste` (671).
 *  A chip with no glyph is a word without a mark, never a hole, which is the only reason a 69%
 *  mark is worth having at all.
 *
 *  SCRYFALL'S LIST, SO IT HOLDS ABILITY WORDS TOO -- "probing telepathy" beside "flash". Both are
 *  things the card says about itself in its own bold type, so both belong in the row; neither gets
 *  a glyph unless mana draws one.
 *
 *  ABSENT ON AN OLD ARTIFACT. `keywords` was added to `CardPageRecord` in the same PR as this row,
 *  so a static build made before it has the field on no card at all. Rendering nothing is correct
 *  there -- and it is why this takes `string[] | undefined` rather than assuming an array. */
export function KeywordRow({ keywords }: { keywords?: string[] }): React.JSX.Element | null {
  if (!keywords || keywords.length === 0) return null;
  return (
    <ul aria-label="Keywords" className="flex flex-wrap gap-2 m-0 p-0 list-none">
      {keywords.map((k) => {
        const glyph = abilityClass(k);
        return (
          <li
            key={k}
            className="inline-flex items-center gap-1.5 rounded-(--field-radius) border border-(--separator) bg-(--surface-secondary) px-2 py-1 text-sm"
          >
            {glyph && <CardSymbol name={glyph} />}
            {/* Capitalised the way a card prints it, and the raw value is what the engine stored. */}
            <span className="first-letter:uppercase">{k}</span>
          </li>
        );
      })}
    </ul>
  );
}
