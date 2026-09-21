import { useMemo } from "react";
import { WordPicker } from "./WordPicker.js";

/** ONE CONTROL OVER TYPES AND SUBTYPES BOTH (owner, 2026-09-21: "why type and subtype is not one
 *  like on scryfall"). They were already one question -- every term in this query ANDs, which is
 *  exactly what `t:` does on Scryfall, and asking a reader to know that Equipment is a subtype
 *  while Artifact is a type is asking them to know our storage layout. Measured over the shipped
 *  artifact: 13 types, 474 subtypes, and NO word in both, so each choice resolves to its own param
 *  with nothing to disambiguate. Only the control merged; `type=` and `subtype=` did not, so every
 *  link shared before it still opens the search it named.
 *
 *  ALL THIS FILE KNOWS IS WHICH TABLE A WORD CAME FROM. The typeahead, the chips and the whole
 *  keyboard model live in `WordPicker`, which the keyword row uses too. */
export function TypeLinePicker(
  { types, subtypes, chosenTypes, chosenSubtypes, onChange }: {
    types: string[];
    subtypes: string[];
    chosenTypes: string[];
    chosenSubtypes: string[];
    onChange: (next: { types: string[]; subtypes: string[] }) => void;
  },
): React.JSX.Element {
  /** TYPES FIRST, because they are the coarser question and the shorter list -- so "creature"
   *  outranks "Crewmate" for a reader who typed "cre" and meant the card type. */
  const all = useMemo(() => [...types, ...subtypes], [types, subtypes]);
  /** THE TABLE A WORD CAME FROM, built from the vocabulary rather than from a list written down
   *  here: a set that introduces a type would otherwise be filed as a subtype by a reader who
   *  cannot see the difference anyway. */
  const isType = useMemo(() => new Set(types), [types]);

  return (
    <WordPicker
      label="Type line"
      listLabel="Types and subtypes"
      placeholder="Instant, Sliver, Equipment…"
      all={all}
      chosen={[...chosenTypes, ...chosenSubtypes]}
      onChange={(next) => onChange({
        types: next.filter((w) => isType.has(w)),
        subtypes: next.filter((w) => !isType.has(w)),
      })}
    />
  );
}
