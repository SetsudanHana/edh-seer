# Player-persona reviewers — how to run them, and what makes a run valid

Reviewer agents that look at this tool the way real players with real problems would. They
exist because analysis of our own UI keeps passing while the UI is unusable: measured
twice (2026-08-04 on the deck board, 2026-08-11 on the deck math layer), the personas
found defects every automated gate and every self-review had missed.

**Do not put ground truth in the agent files.** Task answers, fixture reasoning and the
canary terms live here. A persona that can read the answers is not a reviewer.

## The roster: one seat per problem players actually bring (2026-09-26)

Until 2026-09-26 the seats were defined by HOW MUCH MAGIC A READER KNOWS (beginner, tuner,
skeptic, phone). They told us whether a screen could be read; they could not tell us whether
anyone would come to it. The owner's call: build the seats from the questions players post, and
ask each whether the site solved its problem. The questions, with sources, are in
`docs/player-questions.md`; each seat's own wording is quoted in its file.

| agent | the problem it brings | ceiling | inherits from |
|---|---|---|---|
| `mtg-first-cuts` | "I'm at 108, help me cut to 100" | knows EDHREC words, not this tool's | the tuner's cut task |
| `mtg-precon-upgrader` | "upgrade my precon on $50; I keep losing to friends" | almost no Magic vocabulary | the precon seat: jargon wall and bad-deck kindness |
| `mtg-clunky-deck` | "my deck feels slow, runs out of cards, got mana screwed" | knows Magic, not this tool | the tuner's mana tasks |
| `mtg-plan-seeker` | "my deck has no win condition; is card X worth a slot?" | knows Magic thoroughly | new: tests the product's core claim |
| `mtg-pod-fit` | "which bracket is this really, and does it fit my pod?" | knows Magic and brackets, trusts nothing | the skeptic: verify-first, seeded FALSE claim |
| `mtg-phone-player` | "what do I tell the table about my deck?" at a store | knows Magic, has no pointer | unchanged modality seat, now with a job |

**Every seat now answers "did it solve my problem?"** (`solved` / `partly` / `not solved`, and
what it would do next). That is the round's headline number, and it is the one the old roster
could not produce.

**The skeptic's question is now every seat's.** Every seat must say, for each claim it acts on,
whether it could check it from the screen (`CANNOT-BE-CHECKED`). The research found trust is the
deciding factor between paste-a-list tools, so it is not one seat's job any more.

**Retired 2026-09-26**: `mtg-precon-player`, `mtg-deck-tuner`, `mtg-skeptic`. Their ceilings
live on in the seats above; their files are in git history.

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

## The deck-build agent is not one of these seats

`mtg-deck-builder` is a different instrument and must not be run like a persona round. The seats
above are READERS: handed screenshots of a finished report and asked what they make of it. None of
them ever has to DO anything with the product, which is why none can answer the two questions the
builder exists for -- **can the site be built FROM**, and **are our findings ACTIONABLE**.

It drives the live site in a loop (build a 99, paste it in, read the report, repair from its
findings), and `research/web/deck-build-run.ts` keeps the record. Give it **one phase brief at a
time**; a single agent holding 99 cards, a browser, a report and a repair plan will drift, and a
long session cannot say which iteration the drift began in.

**The measurement is a SPLIT, not a count.** A citation can be true and meaningless: an agent that
already wants Sol Ring searches for it, lands on the page and cites a real URL for an idea the site
never supplied. So every citation is classified from the URL trail as **discovery** (the name was
listed on a page the agent was already on) or **confirmation** (the page was reached by searching
that name). Discovery is the number that says a partner list is a deckbuilding substrate.

**The first run is calibration, not a result.** A split with zero discovery means either the
classifier is mislabelling or the site never offered a card the agent did not already want, and
those are indistinguishable in a record -- the report says so out loud when it happens.

Its rules for an invalid run mirror the ones below, plus one: a citation naming a page the trail
never visited throws the whole run out. The trail is self-reported because only the agent drives
the browser, so that cross-check is what keeps the classification honest.

    npx tsx research/web/deck-build-run.ts --self-test                     # the pure maths
    npx tsx research/web/deck-build-run.ts init   runs/deck-build.json
    npx tsx research/web/deck-build-run.ts build  runs/deck-build.json <phase.json>
    npx tsx research/web/deck-build-run.ts report runs/deck-build.json

→ `docs/superpowers/specs/2026-09-20-deck-build-agent-design.md`

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
1b'. **Open the report's folds, not the site's.** The 2026-09-26 round opened every `<details>` on
   the page, which included the site header's MORE menu; it then covered the top right of every
   expanded slice. Open only the folds inside the report, and capture click-only lists ("Show 2
   more", "Show all N", "Trim 3/5/10") after clicking them: first-cuts could not reach 8 cuts
   because two sat behind a closed "Show 2 more".
1c. **Do not down-scale.** The Cards tab is a tall page; captured whole and shrunk ~2.5x
   it sits at the edge of legibility, and three seats had to hedge every reading from it.
   Capture long tabs in viewport-sized slices instead, as the phone seat already gets.
2. **One deck per persona** (below), named in the run brief you pass with the
   screenshots.
3. **Give each persona its task list** (below). Tasks, not "have a look" — round 1's
   best finding was that 4/4 could not name a single multi-role card, which only
   surfaced because they were asked to.
4. **Run every seat in parallel, in separate agents, none seeing another's output.**
   Independence is what makes agreement mean anything.
5. **Score the round** (below) and file the findings with the run date.

## Fixtures

| persona | deck | why this one |
|---|---|---|
| first-cuts | `packages/cli/decks/first-deck-108.txt` | the Krenko list plus eight popular goblins a first-time builder adds (Beetleback Chief, Legion Warboss, Goblin Rabblemaster, Siege-Gang Commander, Goblin Instigator, Mogg War Marshal, Lightning Bolt, Hellrider), so the job is real: 108 cards, cut 8. The eight are plausible adds, not planted bad cards; a good cut list may keep some of them |
| precon-upgrader | `packages/cli/decks/precon-party-time.txt` — the Baldur's Gate "Party Time" precon (Nalia de'Arnise) | unchanged from the precon seat: partial coverage, flat-export commander detection, and the bad-deck case (a theme the engine calls unfocused) |
| clunky-deck | **chosen per round**: a deck whose report carries a draw or land finding (ran out of cards, lands short, a colour short) | the seat tests whether a real problem reads as a verdict on this list. Re-check each round that the finding is still there; a fixed deck calibrates nothing |
| plan-seeker | `packages/cli/decks/calibration/enchanting-rani.txt`; the "unsure card" is the first card in its "Weak here, but something argues for them" cut group | four win plans "spread about evenly", a blink theme earlier rounds missed, and a card with arguments both ways |
| pod-fit | `packages/cli/decks/calibration/yuna-grand-summoner.txt` | the skeptic's fixture, carried over: one live claim judged FALSE (see below). Re-verify every round |
| phone | `inalla.txt` captured at 390px | same as before, so modality stays the only variable against earlier rounds |

**The pod-fit seat's seeded claim** (carried from the skeptic seat, **re-verified 2026-09-20**):
`Misty Rainforest -> Yuna, Grand Summoner`, tag `dies:permanent`, rendered as "When Misty
Rainforest dies, Yuna, Grand Summoner puts that number counters on a permanent". Yuna only
triggers on a permanent that **had a counter on it**, which a cracked fetchland never does, so the
defect is catchable from the two cards' oracle text alone. It replaced `sarevok-lord-of-pain`,
whose claims were judged REAL in rounds 3 and 4.

**How that fixture was chosen, because the method matters more than the pick.** 523 claims in
the panel have a latest verdict of FALSE, but most have since been fixed — six of eight
candidates tested were **gone** from a live analysis. Re-verify before each round: a seeded
defect the engine no longer makes calibrates nothing. A run where pod-fit questions nothing
about a claim we know to be false means the instrument has gone soft.

## Task lists

Keep these versioned with the product. **When a fix ships, keep the old task**, so a
re-run banks the improvement and fires on a regression.

Ground-truth answers are for the harness operator, never for the agent.

### Every persona
0. **Your own question** — the first quote under "Why you came" in your file, as the task.
   *(truth: the "Does edhseer answer these today?" table in `docs/player-questions.md`; a seat
   reporting a gap the table lists as missing is the correct outcome, not a failure)*
1. What is this deck trying to do? *(truth: the headline theme; comparability with every
   earlier round)*
2. Name the two cards on this page that work together most strongly, and say why.
   *(round 1's killer task; kept for comparability)*

### first-cuts
3. You are 8 over. Which eight come out, and what does the page say for each?
   *(truth: the cut list; the page should also say the deck is 108)*
4. Would cutting those break anything the deck does? *(truth: the "keep" arguments and roles)*
5. Is one of your favourite cards on the cut list? Would you cut it after reading why?

### precon-upgrader
3. What would you buy with $50, and what does each replace? *(truth: nothing prices a card
   yet; a seat that names prices from the page is over-claiming)*
4. After those changes, would you keep up with your friends' upgraded decks? *(truth: not
   answered; report whether the page says so or pretends to)*
5. Is there anything on this page you would show a friend?

### clunky-deck
3. Is this deck short of lands, or running too many? *(truth: the lands row; the known trap is
   two correct numbers answering different questions)*
4. Why does it run out of cards, if it does? *(truth: the draw target and any "run out" finding)*
5. Last week you kept two lands and never drew a third. Bad luck or the deck?
   *(truth: the land odds by turn; the page does not say "luck" in those words)*

### plan-seeker
3. Finish the sentence "this deck wins by …" from the page.
4. Which cards wandered off the plan? *(truth: the off-theme cut group)*
5. Is the card named in your brief worth its slot? What would be weaker without it?
   *(truth: its "See links" and its cut-list entry)*

### pod-fit
3. What bracket is this deck, and which cards decide it? *(truth: the bracket readout, its Game
   Changers and two-card combos)*
4. Pick the claim you most distrust and try to verify it from the screen alone.
5. Find somewhere the tool declines to answer. Deliberate limit or hole?
6. If your pod finds it too strong, what would you swap? *(truth: not answered yet)*

### phone
3. What would you say to the table, in one breath? *(truth: the hero verdict and bracket)*
4. Do task 2 without hovering.
5. Find the explanation for any /5 score.

## Scoring a round

- **Convergence is the severity meter — but only ACROSS ceilings.** Precon-upgrader + plan-seeker
  failing to decode the same readout means the tool is wrong. Expert seats agreeing
  means one reading taken several times with correlated error. Weight the first, discount
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
- **The solved rate is the headline.** Count `solved` / `partly` / `not solved` across seats,
  and for each `not solved` record what the seat said it would do next. A seat that would "go to
  another site" names our competitor for that problem; a seat that would "check it on a forum
  first" means we answered but were not trusted.
- **Canary check.** If the precon upgrader uses any term from its do-not-know list as
  though it understands it, the run is invalid — that is roleplay drift, not review.

## The honest ceiling of this technique

All the personas are the same underlying model wearing different hats, so full agreement can
be one model's blind spot rather than several readers' shared experience. Mitigations in
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
