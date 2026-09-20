import { CardSymbol, typeClass } from "./CardSymbol.js";

/** A TYPE LINE WITH ITS TYPE'S MARK (owner, 2026-09-20). Four components printed
 *  `Legendary Creature — Human Warrior Cleric` as bare text; the glyph makes the type scannable
 *  before the words are read, and the words are unchanged behind it.
 *
 *  A LABEL, NOT PROSE, which is the owner's own rule for where a mark belongs: a type line is the
 *  card announcing what it is, not a sentence about it. The glyph is `aria-hidden` because the
 *  type word follows it immediately -- a screen reader that heard "Creature" does not need to hear
 *  a second mark saying creature.
 *
 *  AND IT FALLS BACK TO THE PLAIN LINE. A type line mana has no glyph for (a Dungeon, a Plane, a
 *  line the corpus never normalised) renders exactly as it always did. There is no state here
 *  where the reader loses the words. */
export function TypeLine({ line }: { line: string }): React.JSX.Element {
  const type = typeClass(line);
  if (!type) return <>{line}</>;
  return (
    <>
      <CardSymbol name={type} className="mr-1.5 align-[-0.05em]" />
      {line}
    </>
  );
}
