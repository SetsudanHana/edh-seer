# Player-persona reviewers — how to run them, and what makes a run valid

Four reviewer agents that look at this tool the way four different players would. They
exist because analysis of our own UI keeps passing while the UI is unusable: measured
twice (2026-08-04 on the deck board, 2026-08-11 on the deck math layer), the personas
found defects every automated gate and every self-review had missed.

**Do not put ground truth in the agent files.** Task answers, fixture reasoning and the
canary terms live here. A persona that can read the answers is not a reviewer.

## The roster, and why it is these four

| agent | ceiling it holds | the hole it covers that no other seat can reach |
|---|---|---|
| `mtg-precon-player` | knows almost no Magic vocabulary | the jargon wall; also the bad-deck kindness case, since a precon scores badly on every axis we measure |
| `mtg-deck-tuner` | knows Magic, not our vocabulary | whether the numbers are ACTIONABLE for a real tuning job |
| `mtg-skeptic` | knows Magic, trusts nothing | whether a claim can be CHECKED, and whether our refusals read as honesty or as holes |
| `mtg-phone-player` | knows Magic, has no pointer | everything reachable only by hover, width or gesture |

**Replaces the old 2×2** (cEDH / chill Saturday / returning / new+precon). The
power↔fun axis never earned its seats: across two validated rounds, no recorded finding
required the cEDH-vs-chill-vs-returning distinction, and round 2's strongest findings
were convergent across all four. What discriminated findings was the KNOWLEDGE CEILING
— the new player's "11 of 15 filter chips are words I don't know" is the one clearly
persona-specific finding in the record. So the three expert-ish seats merge into the
tuner, and the freed seats buy two axes the old roster had none of: adversarial trust,
and modality.

**Deliberately not personas:**

- **Colour-vision deficiency / low vision.** An LLM roleplaying deuteranopia over a
  full-colour screenshot is theatre — it can see the colours and cannot un-see them.
  Run the screenshots through a CVD simulation (and a downscale/blur pass) and feed the
  TRANSFORMED images to the normal personas. Our gold/teal flow hues and the amber
  warning channel are what that arm exists to test.
- **Non-native English speaker.** The real risk is idiom used as jargon — "slack",
  "anchor", "cries wolf", "trim". Every persona's "words I did not understand" field
  already catches it.
- **Budget player, rule-zero conversation.** Each yields one finding once ("no prices",
  "no share link"). Product notes, not reviewers.

## Running a round

1. **Capture full-viewport screenshots.** Never element crops. A round of the old
   personas reported "there is no search" when the search box existed and had merely
   been cropped out of the capture. Each persona opens with an inventory of what it can
   see, which is how a bad capture is detected from the reviewer's side.
1b. **Capture each tab TWICE — once as it loads, once with every `<details>` expanded —
   and capture click-only output separately.** Learned the hard way in the 2026-08-20
   round: `▸WHAT THIS MEASURES`, `▸WHAT A GROUP COUNTS` and `▸ALL 6 WANTS` are shut in a
   default capture, so three seats reported terms as undefined that the product may
   define one click away. The finding is still real — the reader met the word before the
   gloss — but the round could not tell "not explained" from "explained behind a
   disclosure", and that distinction decides what to fix. Same for `Trim 3/5/10`, whose
   output exists only after a click and which therefore BLOCKED the cut task for two
   seats.
1c. **Do not down-scale.** The Cards tab is a tall page; captured whole and shrunk ~2.5x
   it sits at the edge of legibility, and three seats had to hedge every reading from it.
   Capture long tabs in viewport-sized slices instead, as the phone seat already gets.
2. **One deck per persona** (below), named in the run brief you pass with the
   screenshots.
3. **Give each persona its task list** (below). Tasks, not "have a look" — round 1's
   best finding was that 4/4 could not name a single multi-role card, which only
   surfaced because they were asked to.
4. **Run all four in parallel, in separate agents, none seeing another's output.**
   Independence is what makes agreement mean anything.
5. **Score the round** (below) and file the findings with the run date.

## Fixtures

| persona | deck | why this one |
|---|---|---|
| precon | `packages/cli/decks/precon-party-time.txt` — the Baldur's Gate "Party Time" precon (Nalia de'Arnise), supplied by the owner | exercises the arbitrary-pasted-deck path nothing else does: partial derived-corpus coverage, flat-export commander detection (no header, no blank line — the 2026-08-18 alphabetical-order rule fires on it), and the unsatisfiable-condition case CLAUDE.md says is "far commoner on an arbitrary pasted deck". It also IS the bad-deck case: theme "shapeshifters entering / creatures dying", cohesion **0.11 unfocused**, top card **2.29** |
| tuner | `packages/cli/decks/calibration/inalla.txt` | tuned, so a false alarm is the strong signal (usability review §8) — and the F-series review used this same deck, so findings stay comparable across rounds |
| skeptic | `packages/cli/decks/calibration/sarevok-lord-of-pain.txt` | **verified live**: still carries two claims the owner hand-judged FALSE — `Liliana's Triumph → Death Tyrant` and `Szat's Will → Death Tyrant`, both `dies:creature`, both rendering as "Death Tyrant triggers on a creature dying; X supplies it" |
| phone | `inalla.txt` captured at 390px | same deck as the tuner, so modality is the only variable between those two seats |

**How the skeptic's fixture was chosen, because the method matters more than the pick.** 523 claims in
`docs/measurements/panel/` have a latest verdict of FALSE, but most have since been fixed — six of
eight candidates tested were **gone** from a live analysis. Re-verify before each round: a seeded
defect the engine no longer makes calibrates nothing.

**The skeptic's seeded defect is the instrument's own check.** The panel holds 25
hand-judged FALSE claims. Put one in the skeptic's deck and do not tell it which. A run
where the skeptic questions nothing about a claim we know to be false means the
instrument has gone soft — the same role the pre-known encoding defect played in round
1, made permanent.

## Task lists

Keep these versioned with the product. **When a fix ships, keep the old task**, so a
re-run banks the improvement and fires on a regression — the ratchet shape this repo
uses everywhere else, applied to UX.

Ground-truth answers are for the harness operator, never for the agent.

### Every persona (comparability across ceilings)
1. What is this deck trying to do? *(truth: the headline theme + cohesion label)*
2. Name the two cards on this page that work together most strongly, and say why.
   *(round-1's killer task, and H2's edge-visibility test)*
3. Name three cards you would cut. *(truth: `report.trim` order; `cutCandidates` is
   empty on 18 of 71 decks, so an empty cut list is a legitimate answer to check for)*
4. Is this deck short of lands? *(truth: the lands row + `DeckMath.lands.mdfc`; the
   known trap is two correct numbers answering different questions — a "COLOURS short
   13/12/11" block beside "37 run · wants 37" was refused by 4/4 in round 2)*
5. What does the biggest number on this page mean? *(truth: SYNERGY /5)*

### precon only
6. Should you buy anything to make this deck better? What?
7. Is there anything on this page you would show a friend?

### tuner only
6. You are five cards over. Which five, and what does the page say argues each stays?
8. Which colour is your mana base worst at? *(truth: the castability range rows — a
   range, deliberately, not a single figure)*
9. What would you add? *(truth: nothing on the page answers this yet — F14 is open. A
   persona confidently answering it is over-claiming; a persona reporting the gap is
   the correct outcome)*

### skeptic only
6. Pick the claim you most distrust and try to verify it from the screen alone.
7. Find somewhere the tool declines to answer. Does the gap read as deliberate or broken?
8. Is there anything here you could not have worked out yourself in two minutes?

### phone only
6. Do task 2 without hovering. *(H8 shipped hover as the primary way to read the board;
   this seat is the only one that can see what that costs on touch)*
9. Find the explanation for any /5 score. *(F7 shipped Explain glosses; F16 records
   tooltip-only explanations as still open — this is the re-run that banks or fires)*

## Scoring a round

- **Convergence is the severity meter — but only ACROSS ceilings.** Precon + tuner
  failing to decode the same readout means the tool is wrong. Four experts agreeing
  means one reading taken four times with correlated error. Weight the first, discount
  the second.
- **Match findings by their quoted anchor**, not by interpretation. Every finding must
  quote the exact on-screen text; that makes matching mechanical.
- **`SUSPECTED-WRONG` and `READ-IT-WRONG` are quarantined until checked.** Personas
  over-claim on mechanism — proven: one called a mana-source count "arithmetically
  impossible" when duals and rocks legitimately exceeded the land count. The usability
  finding survived; the diagnosis did not. Check the claim against the engine before
  anyone acts on it. The CONFUSION is always valid data; the DIAGNOSIS never is.
- **Unique findings are each seat's rent.** Track, per persona per round, how many
  findings no other persona produced. **Two consecutive rounds at zero uniques makes
  that persona a cut candidate.**
- **Canary check.** If the precon player uses any term from its do-not-know list as
  though it understands it, the run is invalid — that is roleplay drift, not review.

## The honest ceiling of this technique

All four personas are the same underlying model wearing four hats, so 4/4 agreement can
be one model's blind spot rather than four readers' shared experience. Mitigations in
use: different decks and different task lists per persona (decorrelates inputs),
weighting cross-ceiling agreement over within-ceiling agreement, and optionally varying
the model per persona. The real check is periodic and human: the owner looks at the same
screen and sees whether they hit the same wall. Round 1 was validated that way and
should be re-validated whenever this roster changes.

Findings from a round go in `docs/measurements/`, dated, with the screenshots that
produced them. The first run of this roster is
`docs/measurements/persona-round-2026-08-20/FINDINGS.md`: 4/4 convergence on the deck-size
counter, two confirmed engine defects (a self-referential type grant rendered as a class
grant 21 times in one deck; the ramp package rated 0.3 while the same report asks for more
ramp), one `SUSPECTED-WRONG` refuted by oracle text, and a PARTIAL on the seeded-defect
calibration — the skeptic circled the right family, picked the true sentence out of it, and
named the display property that makes the false one uncatchable.
