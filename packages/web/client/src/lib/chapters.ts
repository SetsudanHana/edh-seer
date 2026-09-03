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
/** EVERY RAIL WORD APPEARS IN ITS OWN HEADING, and three of them did not.
 *
 *  Below `lg` this list is the SELECT's option text, so the closed control shows the current
 *  chapter's rail word -- and `READ` sat over a heading reading "Deck at a glance", `STAND` over
 *  "Scores and bracket". The phone judge hit it on all four runs: *"neither is a heading I passed"*,
 *  *"I don't know if that's Standing, Standard or something else"*, and it is why confidence on
 *  "get me to the mana section" never rose above 60% before the tap. It also cost task 1 every run
 *  -- a reader cannot count the report's parts from a control whose one visible word names nothing.
 *
 *  THE REGISTER IS UNCHANGED, which is what T1 settled: six terse labels, not six questions and not
 *  six full titles. `Read -> Glance` and `Stand -> Scores`, and every word is now a literal substring of
 *  the heading it scrolls to (`Fix` already was, and stays short so it cannot collide with the
 *  "Fixes" heading itself -- a rail word equal to a heading makes that heading ambiguous to find). The full titles were measured first and do not fit the
 *  closed control: `SCORES AND BRACKET` is 119px of a select that has about 80px of text room at
 *  390, so it would have truncated into the same unreadable stub.
 *
 *  Widening the select was the other option and was refused: the room would have come from the
 *  three surface links' `↗`, and that arrow is the one signal the same judge reads correctly every
 *  run ("the ↗ tells me it goes somewhere else"). */
export const CHAPTERS: readonly { id: ChapterId; rail: string; title: string }[] = [
  { id: "read", rail: "Glance", title: "Deck at a glance" },
  { id: "stand", rail: "Scores", title: "Scores and bracket" },
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
