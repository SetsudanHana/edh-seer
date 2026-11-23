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
  { types, subtypes, chosenTypes, chosenSubtypes, notTypes, notSubtypes, anyTypes, anySubtypes, onChange }: {
    types: string[];
    subtypes: string[];
    chosenTypes: string[];
    chosenSubtypes: string[];
    /** WORDS THE CARD MUST NOT HAVE (#1782). With either given, the chips offer must/never and `onChange` carries both
     *  lists; without them the control is exactly what it was. */
    notTypes?: string[];
    notSubtypes?: string[];
    /** ANY OF (#1782): one OR group across both tables. With either given the chips offer must / any of / never. */
    anyTypes?: string[];
    anySubtypes?: string[];
    onChange: (next: { types: string[]; subtypes: string[]; notTypes?: string[]; notSubtypes?: string[]; anyTypes?: string[]; anySubtypes?: string[] }) => void;
  },
): React.JSX.Element {
  /** TYPES FIRST, because they are the coarser question and the shorter list -- so "creature"
   *  outranks "Crewmate" for a reader who typed "cre" and meant the card type. */
  const all = useMemo(() => [...types, ...subtypes], [types, subtypes]);
  /** THE TABLE A WORD CAME FROM, built from the vocabulary rather than from a list written down
   *  here: a set that introduces a type would otherwise be filed as a subtype by a reader who
   *  cannot see the difference anyway. */
  const isType = useMemo(() => new Set(types), [types]);

  const withAny = anyTypes !== undefined || anySubtypes !== undefined;
  const withNots = notTypes !== undefined || notSubtypes !== undefined || withAny;
  const nt = notTypes ?? [];
  const ns = notSubtypes ?? [];
  const at = anyTypes ?? [];
  const as = anySubtypes ?? [];
  const emit = (t: string[], s: string[], nT: string[], nS: string[], aT: string[], aS: string[]) =>
    onChange({ types: t, subtypes: s, ...(withNots ? { notTypes: nT, notSubtypes: nS } : {}), ...(withAny ? { anyTypes: aT, anySubtypes: aS } : {}) });
  const drop = (xs: string[], name: string) => xs.filter((w) => w !== name);
  return (
    <WordPicker
      label="Type line"
      listLabel="Types and subtypes"
      placeholder="Instant, Sliver, Equipment…"
      all={all}
      chosen={[...chosenTypes, ...chosenSubtypes]}
      {...(withNots ? {
        negated: [...nt, ...ns],
        ...(withAny ? { anyOf: [...at, ...as], onRemoveAny: (name: string) => emit(chosenTypes, chosenSubtypes, nt, ns, drop(at, name), drop(as, name)) } : {}),
        // A WORD KEEPS ITS TABLE whichever list it is on, for the reason the comment below gives.
        onMove: (name: string, to: "and" | "not" | "any") => {
          const isT = chosenTypes.includes(name) || nt.includes(name) || at.includes(name);
          // Out of all three lists of its table, then into the one asked for.
          const t = isT ? drop(chosenTypes, name) : chosenTypes; const s = isT ? chosenSubtypes : drop(chosenSubtypes, name);
          const nT = isT ? drop(nt, name) : nt; const nS = isT ? ns : drop(ns, name);
          const aT = isT ? drop(at, name) : at; const aS = isT ? as : drop(as, name);
          const into = (xs: string[], mine: boolean) => (mine ? [...xs, name] : xs);
          if (to === "not") emit(t, s, into(nT, isT), into(nS, !isT), aT, aS);
          else if (to === "any") emit(t, s, nT, nS, into(aT, isT), into(aS, !isT));
          else emit(into(t, isT), into(s, !isT), nT, nS, aT, aS);
        },
        onRemoveNegated: (name: string) => emit(chosenTypes, chosenSubtypes, drop(nt, name), drop(ns, name), at, as),
      } : {})}
      onChange={(next) => {
        // A WORD ALREADY CHOSEN KEEPS THE TABLE IT CAME IN UNDER, and re-deriving it from
        // `isType` was a real defect for the whole first paint: the tables arrive with a 4.8 MB
        // fetch, the chips are on screen from the URL immediately, and until then `isType` is
        // EMPTY -- so removing one chip on `?type=creature&subtype=sliver` re-filed "creature"
        // as a subtype, rewrote the URL to `?subtype=creature`, and emptied the list. It could
        // not self-heal, because by then the URL said something else.
        const keep = new Set(next);
        const types = chosenTypes.filter((w) => keep.has(w));
        const subtypes = chosenSubtypes.filter((w) => keep.has(w));
        // ONLY A NEW WORD IS RESOLVED, and a new word can only have come from the listbox --
        // which is drawn from the vocabulary, so by the time one arrives here it has loaded.
        const known = new Set([...chosenTypes, ...chosenSubtypes]);
        for (const w of next) if (!known.has(w)) (isType.has(w) ? types : subtypes).push(w);
        emit(types, subtypes, nt, ns, at, as);
      }}
    />
  );
}
