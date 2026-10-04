# The persona rounds: why the scores sit at 3 to 5, and what gets them to 6 and 7 (2026-10-04)

The owner, 2026-10-04: "review the personas review we have, so we can improve the feedback,
cause I would like to have something which I can use to get 6/7 or 7/7 scores."

Read: `.claude/agents/README.md` and the seven seat files, the five rounds under
`docs/measurements/persona-round-*` (09-26, its 1b baseline, 09-27, 09-29, 10-02),
`docs/player-questions.md`, `research/web/ui-review-capture.ts` and the run files. Written for a
Claude Code session; the tasks change the instrument, not the product, except where a product
change is the only way a seat can score higher, and those are named as such.

## The scores, all five rounds

| seat (component) | 09-26 | 1b | 09-27 | 09-29 | 10-02 |
|---|---|---|---|---|---|
| first-cuts (Time) | 3 | 3 | 3 | 3 | 4 |
| precon-upgrader (Essence) | 3 | 3 | 3 | 4 | 3 |
| clunky-deck (Time) | 3 | 3 | 3 | 3 | 5 |
| plan-seeker (Insight) | 4 | 3 | 4 | 5 | 3 |
| pod-fit (Confidence) | 3 | 3 | 3 | 3 | 3 |
| phone (Insight) | 5 | 5 | 5 | 4 | 4 |
| solved / partly / not | 0/4/2 | 0/3/3 | 1/5/0 | 0/6/0 | 1/5/0 |
| would go to a forum first | 3 | 5 | 4 | 2 | 4 |

Five rounds, 30 scores, none above 5, a median of 3. Two product deliveries in that span (the
report rail, the precon package, the card grammar) moved individual seats by one point each way
and the median not at all. Confidence has read 3 five times running.

## Why the number does not move

### R1. A score has no definition

Each seat scores one ICE-T claim on 1 to 7 with "one or two sentences naming the thing on screen".
Nothing says what a 5 is, what a 7 is, or what separates them. The seats answer by feel, and a
feel on a 7-point scale is 3 to 5. A 7 cannot be reached because it is not defined. The same
seat, same screen, could defensibly say 3 or 5 (plan-seeker: 5 then 3 when its brief changed
the unsure card; the page had improved).

### R2. One number per component per round

Each component is scored by one seat, so every cell above is n=1. A one-point move is noise
(the README's own "honest ceiling" says so) and the round cannot tell a product change from a
brief change. Fixtures moved under two seats (clunky Chandra to Gisa; plan-seeker's unsure card),
which the findings note and the table cannot show.

### R3. "Solved" is defined to include things the product does not do, by decision

Each seat's "what solved means to you" is the whole r/EDH ask. For precon-upgrader it includes
"whether that would be enough to keep up with your friends", which the README's truth column
says is "not answered"; for pod-fit, "which cards to swap to bring it down", which is a known gap
since 09-27 (#8). A seat judging against those cannot say `solved`, and the README says a seat
reporting a gap the coverage table lists as missing "is the correct outcome, not a failure". So
`partly` is the ceiling by construction for two seats, and the headline number measures the
roadmap, not the page.

### R4. The same findings recur, round after round, and nothing tracks them to closure

Counted by the findings' own "repeat of" notes: 0, 0, 4, 7 in the four rounds. The top of the
10-02 list is the top of the 09-29 list is the top of the 09-27 list:

| finding | rounds seen | seats |
|---|---|---|
| the main theme is smaller than the groups under it | 09-27, 09-29, 10-02 | up to four |
| "focused" over "unfocused" / scores met before their bands | 09-27, 09-29, 10-02 | four |
| no kill and no clock on the combo plan | 09-27, 09-29, 10-02 | five |
| a count with no cards behind it / claims checkable against one card only | all five | six |
| one quantity, several numbers (ramp, lands, theme) | all five | up to five |
| cut lists argue with themselves | 09-29, 10-02 | three |
| nothing brings a deck down | 09-27, 09-29, 10-02 | pod-fit |

Between rounds the work shipped was the rail, the precon package and the grammar, which the
rounds then measured. The rounds' own top findings were not the next round's input. A loop that
does not close its findings before measuring again will read the same number again. There is no
backlog: repeats are matched by hand ("repeat of 09-29 #3"), `engine-fixes-from-overview-rounds.md`
holds one earlier round's engine items, and nothing lists which persona finding is open, owned,
or fixed in which PR.

### R5. The capture caps Confidence and Essence before any seat reads a word

Every round's Validity section lists the same capture gaps:

- the card drawer, "the only place a card's text is shown", is never captured, so every claim is
  checkable against one card only (four seats, three rounds); `CANNOT-BE-CHECKED` is the seat's
  correct answer and Confidence stays at 3;
- `MAX_SLICES = 2` leaves gaps between chapters; the Cards table is never seen past row 31;
- "Show 2 more", "Show all N" and "Trim 3/5/10" not clicked (first-cuts could not reach its 8th
  cut on 09-26 for this);
- the first frame after a navigation caught the loading skeleton (09-29);
- card images do not load through the local proxy (09-29).

`ui-review-capture.ts` has no check that the capture is complete. Each seat's "What I can see"
inventory is the detector, after the fact and after the seat has scored.

### R6. The most actionable signal is forbidden

"Never propose a fix. No wording, no layout, no feature ideas." That rule is right for validity
(a persona that designs is not a reader), but it also throws away the one thing a fixer needs:
what the seat was looking for, in its own words, at the moment it stopped. The `abstraction` level
tag gestures at it and carries no content.

### R7. The raw seat outputs are not kept

`grep -rl "Task outcomes" docs/measurements/` finds nothing. Only the operator's synthesis is
filed. Per-task outcomes (`answered` / `couldn't tell` / `misread as`) exist in every seat's
return and are never totalled, so the one objective number the method produces is lost, and no
score can be audited or re-scored later.

### R8. The calibration plant is a click deep and the deck-builder has never run

pod-fit missed the planted FALSE claim on 09-27 and 09-29 and hit it on 10-02 only once it
surfaced on a first-screen row. A plant that calibrates skimming only is half a calibration.
`research/web/runs/deck-build.json` is a config with no results beside it: the one instrument
that measures whether findings are actionable has produced no run.

## What 6 and 7 mean, per seat

The scores can reach 6 only when the component is defined and the seat's own "solved" is in
scope. Proposed anchors, one line per level, written from each seat's file and ICE-T claim;
the operator checks the evidence quoted against them:

| component | 3 | 5 | 7 |
|---|---|---|---|
| Time (first-cuts, clunky) | the answer exists but is spread over two or more chapters and needs a fold | the answer is in one chapter, with one number to act on | the first screen answers the seat's own question, with the number and the one change |
| Essence (precon) | the gist arrives only after a word is looked up or a second surface is read | the gist arrives from one surface, with one word unexplained | the seat can say in one sentence what the deck does and what to change, using only words on screen |
| Insight (plan-seeker, phone) | the page lists what the seat already knew | one relationship or outlier the seat did not know, with its reason | the win named with the cards that do it, one thing the seat had wrong, and the reason for each |
| Confidence (pod-fit) | claims cannot be checked from the screen; refusals read as holes | each claim checked has both cards' text on screen; refusals say why | three claims checked out, zero said as zero, and the one planted wrong claim found |

Beside each score, the objective number: tasks `answered` out of six. A 6 or 7 is only valid
with at least five of six answered.

## Tasks, in order

Each one PR against `.claude/agents/` and `research/web/`, except T6, which is product work the
rounds have already specified.

### T1. Define the scale and score every component

- The anchor table above goes into `README.md` under "Scoring a round", and each seat file's
  ICE-T section points at it.
- Every seat scores all four components, its own component first and weighted double in the
  round table; each score quotes the evidence against the anchor's words. The round table reports
  four components as medians over six seats, with the seat's own component beside it.
- Each seat's return gains a totals line: `answered N/6 · couldn't tell N · misread N`.

### T2. Split "solved" into what is in scope

- In each seat file, "What solved means to you" becomes two lists: **must** (what the product
  intends: the README's truth column and the owner's six decisions of 2026-09-26) and **later**
  (named gaps: keeping up with friends, bringing a deck down, prices). `solved` is judged on
  must; later items are reported as "still missing" and never lower the verdict.
- The README's truth table carries the same split, with the issue number for each later item.

### T3. A backlog that the next round is scheduled against

- `docs/measurements/persona-backlog.md`: one row per finding, keyed by its quoted anchor:
  id, anchor, seats, rounds seen, level tag, owner (page or engine), status, fixed-in PR.
  Seed it from the four rounds' ranked lists; the seven rows in R4 are its first P1s.
- A round's FINDINGS references backlog ids; a repeat is a status, not a note.
- The rule: a round is run after the previous round's P1s are fixed or explicitly deferred with
  a reason, and its first section says which P1s it re-tests. Measuring the roadmap's work is
  fine; it is not the loop.

### T4. Make the capture complete, and prove it before any seat runs

- Capture the card drawer for every card a pair sentence names on the captured screens (a
  bounded set per deck), the "Show N more" and "Show all" lists opened, the Cards table to its end,
  `MAX_SLICES` raised to cover the page, the settle waiting for `#read`, images served.
- `ui-review-capture.ts --check`: after capture, a region inventory (the sections each run file's
  `keyScreens` names) is matched against the frames; a missing region fails the capture before
  seats are launched. Each seat's "What I can see" stays as the second detector.

### T5. Ask for the need, keep the no-fix rule

- A new return section after the findings: **"What I was looking for."** For each `couldn't
  tell` and each `BLOCKED-MY-TASK`: the question in the seat's words, where it looked, what it
  would have needed to read there. No wording, no layout, no feature; the information only. The
  canary rule still applies to its vocabulary.
- File the raw seat outputs with the round (`docs/measurements/persona-round-<date>/seats/`),
  so scores can be audited and re-scored when anchors change.

### T6. Close the P1s, then re-run

The seven R4 rows are product work with specs already written in the rounds. In the order the
seats hit them: counts with no cards behind them and card text beside every claim (Confidence,
Essence); one number per quantity (ramp, lands, theme); the combo's kill and clock (Insight);
the theme smaller than its groups and "focused" over "unfocused" (Essence); cut lists that
agree with themselves (Time); bringing a deck down (pod-fit's `later` item, ruling needed).
Re-run the round on the same fixtures and briefs as 10-02, with T1's anchors.

### T7. Calibration and actionability

- A second plant on a first-screen row, re-verified before each round like the first; report
  both.
- Run the deck-builder once per round on one commander and file the discovery/confirmation split.
- One seat per round on a second model, named in the FINDINGS, so full agreement can be read
  against one model's blind spot.

## What to expect

With T1 and T2, the next round reads the same product on a defined scale: the scores should move
up by about a point where the seat's "later" items were the cap (precon, pod-fit), and stay where
the page is the cap. With T4 the Confidence seat can check both cards for the first time. With
T6 the recurring P1s stop appearing, which is what the number has been waiting for. Six and seven
are then reachable, and mean something: a seat that answers five of six tasks from one screen in
the words it brought.

## What must not move

- The seats stay readers; the deck-builder stays the one instrument that acts.
- The no-fix rule, the quote-or-no-finding rule, the canary, and the plant.
- Fixtures and task lists stay frozen across the re-run; a fixture that must change runs both
  old and new for one round.
