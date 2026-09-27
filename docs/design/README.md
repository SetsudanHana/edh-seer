# Design references

The approved mockups the report is built to. A PR that changes one of these surfaces shows the
reference beside a capture of the new screen at the same size (1280×860 desktop, 390×844 phone).
If the change departs from the reference, the PR says so and the owner approves it, and the
reference image is replaced in the same PR.

| Surface | Reference | Rules |
| --- | --- | --- |
| Report, first screen (Glance) | `report-first-screen.png`, `report-first-screen-phone.png` | The theme leads; the commander's map is next, whole, inside the first 1280×860 screen, with its colour key beside it (under it on a phone). The line for the table, the verdict and the card counts come after the map. `ReportShell.test.tsx` checks the order. |
| Card search (`/cards`, `/commanders`) | `card-search.png`, `card-search-phone.png`, `card-search-add.png` | The question is one sentence: colour, "cards that", then terms. A term says its side in its own words (the action for a card that makes the event happen; the clause under the triggered-ability mark for one that pays it off) and wears its mana-font type and zone glyphs. `and` terms join with "and", the `or` terms sit in one outline ("either … or"), `not` terms follow "but never". Tapping a joining word or a term opens a menu of the modes (and / or / but not, each in a player's words, and remove); nothing changes until one is picked (option A, 2026-09-27). "+ add" opens the events grouped by what happens, each with makes / pays off counts; every group shows its best six rows and "N more", matches are by contains with the matched letters in bold, close spellings only when nothing matches; it closes after a pick. `CardSearch.test.tsx` and `event-terms.test.ts` check the operators. |
