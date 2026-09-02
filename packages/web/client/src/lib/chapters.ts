/** THE SIX CHAPTERS, IN THE ORDER A READER ASKS THEM — the report's table of contents, and the one
 *  place the rail and the sections agree on what exists.
 *
 *  They are the five Overview sub-tabs plus Archetypes, re-cut by QUESTION rather than by which
 *  panel was built when: trust, verdict, plan, mana, roles, action
 *  (`docs/ANALYZER-JOURNEY.md`). The sub-tabs hid that sequence — a reader met Summary and had no
 *  way to know a diagnosis existed one tab over — which is the whole reason the strip dies.
 *
 *  `id` is also the DOM id of the section, so the rail's links are ordinary in-page anchors and a
 *  reader with no JavaScript still gets a working table of contents. */
export type ChapterId = "read" | "stand" | "plan" | "mana" | "roles" | "fix";

export const CHAPTERS: readonly { id: ChapterId; rail: string; title: string }[] = [
  { id: "read", rail: "Read", title: "Did it read my deck?" },
  { id: "stand", rail: "Stand", title: "Where does it stand?" },
  { id: "plan", rail: "Plan", title: "What is this deck trying to do?" },
  { id: "mana", rail: "Mana", title: "Can the mana deliver it?" },
  { id: "roles", rail: "Roles", title: "Does it play enough of each role?" },
  { id: "fix", rail: "Fix", title: "What's wrong, and what do I do?" },
];

/** WHERE A DIAL SENDS YOU. `DeckGauges` used to name a sub-tab (`build`/`mana`/`engine`); the
 *  chapters those became are the ones a reader is scrolled to now. `engine` is the dissolved tab:
 *  its scores moved into chapter 2, which is where the dial itself is drawn — so "open the
 *  explanation" is a scroll of zero, and the dial keeps its `focus` hand-off either way. */
export const CHAPTER_FOR_GAUGE = { build: "roles", mana: "mana", engine: "stand" } as const;
