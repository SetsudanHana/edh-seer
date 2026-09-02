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

/** NOT QUESTIONS ANY MORE (roadmap T1). Each of these was phrased as the question a reader asks --
 *  and then the panel under it restated the same words as a declarative heading, four lines down.
 *  The copy review called the doubling the page's strongest machine-written tell, and the fix it
 *  argued for is the register this rail was already using: *"the nav rail already uses six terse
 *  labels — that is the register the owner keeps asking for. Match it."*
 *
 *  THE SEQUENCE IS UNCHANGED and so is `docs/ANALYZER-JOURNEY.md`'s reasoning for it: trust,
 *  verdict, plan, mana, roles, action. Only the words on screen changed. */
export const CHAPTERS: readonly { id: ChapterId; rail: string; title: string }[] = [
  { id: "read", rail: "Read", title: "Deck at a glance" },
  { id: "stand", rail: "Stand", title: "Scores and bracket" },
  { id: "plan", rail: "Plan", title: "Game plan" },
  { id: "mana", rail: "Mana", title: "Manabase" },
  { id: "roles", rail: "Roles", title: "Roles" },
  { id: "fix", rail: "Fix", title: "Fixes" },
];

/** WHERE A DIAL SENDS YOU. `DeckGauges` used to name a sub-tab (`build`/`mana`/`engine`); the
 *  chapters those became are the ones a reader is scrolled to now. `engine` is the dissolved tab:
 *  its scores moved into chapter 2, which is where the dial itself is drawn — so "open the
 *  explanation" is a scroll of zero, and the dial keeps its `focus` hand-off either way. */
export const CHAPTER_FOR_GAUGE = { build: "roles", mana: "mana", engine: "stand" } as const;
