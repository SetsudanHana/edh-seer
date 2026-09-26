# What players actually ask, and whether edhseer answers it

Researched 2026-09-26, to ground the persona reviewers (`.claude/agents/`) in questions real
Commander players post, instead of in how much Magic a reviewer knows. The owner's brief: *"create
those based on comments, questions people ask, like on Google or Reddit, to see if our tool actually
is something that can solve people's problems."*

## How this was gathered, and its limits

- Five researchers, one per problem area, about 130 web searches in total, each keeping only titles
  that appeared **verbatim** in results, with their URL.
- **The first pass had no Reddit**: the network blocked it, so the titles in the five problem
  sections below come from
  TappedOut, MTG Salvation, the Archidekt forum, Moxfield's feedback board (`moxfield.nolt.io`),
  Deckstats, Quora and Facebook groups. Several MTG Salvation threads are years old, so the
  phrasing can be older than today's Reddit.
- Only **titles and search snippets** were read, never whole threads. Who asks and what "solved"
  means for them are inferred from those, and marked as such below.
- **Reddit, added the same day:** once `*.reddit.com` was allowed, r/EDH was searched through a
  real browser (its JSON endpoints ask anonymous clients to log in). Six searches per problem, the
  16 threads each problem's searches hit most often read in full, with their top comments. See
  "What r/EDH says" below; usernames were not kept.

## The five problems people bring

Each problem below lists real titles, who asks (inferred), what they already tried, and what would
count as solved (inferred). The persona that carries it is named in brackets.

### 1. "I'm over 100, help me cut" `[mtg-first-cuts]`

- "New to EDH. Any help cutting cards from my deck?" — https://tappedout.net/mtg-forum/commander-deck-help/new-to-edh-any-help-cutting-cards-from-my-deck/
- "First edh deck, Mazirek, kraul death priest, help cutting cards?" — https://tappedout.net/mtg-forum/commander-deck-help/first-edh-deck-mazirek-kraul-death-priest-help-cutting-cards/
- "Atraxa, help cutting cards please." — https://tappedout.net/mtg-forum/commander-deck-help/atraxa-help-cutting-cards-please/
- "Need help to make cuts in my commander deck" — https://archidekt.com/forum/thread/6147513/1
- "How do you make cuts from a tight list?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/526891-how-do-you-make-cuts-from-a-tight-list
- "How Do You Make the Hard Decisions?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/201339-how-do-you-make-the-hard-decisions
- "Need to Trim my Deck" — https://www.mtgsalvation.com/forums/the-game/commander-edh/477195-need-to-trim-my-deck
- "Card cutting strategy" — https://tappedout.net/mtg-forum/commander-deck-help/card-cutting-strategy/
- "What should I cut for Invert / Invent in my mizzixs deck?" — https://tappedout.net/mtg-forum/commander-deck-help/what-should-i-cut-for-invert-invent-in-my-mizzixs-deck/?page=1

Who: first-time builders who pulled cards from EDHREC or their binder, and experienced players with
a tight list. Tried: sorting by role, cutting "win-more" and the weaker of two similar cards,
goldfishing. Solved when: exactly 100, with reasons they believe, without losing a role or a pet card.

### 2. "Upgrade my precon, on a budget" and "I keep losing to my friends" `[mtg-precon-upgrader]`

- "Looking to upgrade precon on a budget." — https://www.mtgsalvation.com/forums/the-game/commander-edh/781472-looking-to-upgrade-precon-on-a-budget
- "Exquisite Invention, $50 Worth of Upgrades?" — https://tappedout.net/mtg-forum/commander-deck-help/exquisite-invention-50-worth-of-upgrades/
- "Chisiro Precon Upgrade - Budget Suggestions" — https://archidekt.com/forum/thread/6408767
- "Help with upgrading the Lord Windgrace precon" — https://www.mtgsalvation.com/forums/the-game/commander-edh/multiplayer-commander-decklists/796939-help-with-upgrading-the-lord-windgrace-precon
- "Trying to upgrade precon but there is too many good cards" — https://archidekt.com/forum/thread/3243475/1
- "When to upgrade the precons?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/773733-when-to-upgrade-the-precons
- "Any cards in collection to upgrade Merciless Rage?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/816489-any-cards-in-collection-to-upgrade-merciless-rage
- "I keep losing to Precon decks!!! Help???" — https://tappedout.net/mtg-forum/commander/i-keep-losing-to-precon-decks-help/
- "I want to improve my commander deck, help please?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/multiplayer-commander-decklists/807131-i-want-to-improve-my-commander-deck-help-please
- "Tips for powering up my Deck pls!" — https://tappedout.net/mtg-forum/deck-help/tips-for-powering-up-my-deck-pls/

Who: casual players with a store-bought deck, a fixed budget ("$50"), sometimes a collection. Tried:
EDHREC precon pages, YouTube upgrade guides. Solved when: 5–10 one-for-one swaps they can afford
or already own, that keep the deck's theme.

### 3. "My deck feels slow / runs out of gas / I keep getting mana screwed" `[mtg-clunky-deck]`

- "Why is this deck moving slow? Help please" — https://tappedout.net/mtg-forum/commander-deck-help/why-is-this-deck-moving-slow-help-please/
- "How do you increase the consistency of a deck?" — https://tappedout.net/mtg-forum/deck-help/how-do-you-increase-the-consistency-of-a-deck/
- "How to playtest and troubleshoot EDH decks?" — https://tappedout.net/mtg-forum/commander/how-to-playtest-and-troubleshoot-edh-decks/
- "Weird question about mana flood and mana screw" — https://tappedout.net/mtg-forum/commander-deck-help/weird-question-about-mana-flood-and-mana-screw/
- "How to decide on number of lands for edh deck?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/594393-how-to-decide-on-number-of-lands-for-edh-deck
- "How Much Ramp Should Be in an EDH Deck?" — https://tappedout.net/mtg-forum/commander/how-much-ramp-should-be-in-an-edh-deck/
- "Best amount of card draw in a deck" (a Riku deck that "always runs out of steam midgame") — https://www.mtgsalvation.com/forums/the-game/commander-edh/569156-best-amount-of-card-draw-in-a-deck
- "How do you address a high mana curve?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/548632-how-do-you-address-a-high-mana-curve
- "EDH. 3 color mana base help" — https://www.mtgsalvation.com/forums/the-game/commander-edh/805754-edh-3-color-mana-base-help
- "Removal: What kind, How much?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/656599-removal-what-kind-how-much
- "Override mana value" (Moxfield request: a cost reducer makes the curve look wrong) — https://moxfield.nolt.io/965

Who: intermediate players who blame the deck after bad games. Tried: the Command Zone template, land
formulas that disagree (33 to 42 lands), Karsten's tables built for 60 cards, hypergeometric
calculators where they must group the "ramp" cards by hand. Every thread ends "it depends,
playtest". Solved when: a verdict on **their** list (is 36 right for this curve and this ramp?),
bad luck told apart from bad construction, and one concrete fix.

### 4. "How does my deck win?" and "is card X worth a slot?" `[mtg-plan-seeker]`

- "No win condition?" — https://www.mtgsalvation.com/forums/the-game/casual-multiplayer-formats/151185-no-win-condition
- "Finding your win condition" — https://www.mtgsalvation.com/forums/the-game/commander-edh/510514-finding-your-win-condition
- "Non-Combo Win-Condition for Sultai Dredge/Reanimator Deck" — https://www.mtgsalvation.com/forums/the-game/commander-edh/798132-non-combo-win-condition-for-sultai-dredge
- "How do control decks win?" — https://tappedout.net/mtg-forum/commander-deck-help/how-do-control-decks-win/
- "How can I Lower which Turn I Win on?" — https://tappedout.net/mtg-forum/commander-deck-help/how-can-i-lower-which-turn-i-win-on/
- "Decks that start out focused and end up with split goals..." — https://www.mtgsalvation.com/forums/the-game/commander-edh/808149-decks-that-start-out-focused-and-end-up-with-split
- "As many synergies as possible" — https://tappedout.net/mtg-forum/commander-deck-help/as-many-synergies-as-possible/
- "Utility vs synergy in Commander?" — https://www.mtgsalvation.com/forums/magic-fundamentals/magic-general/opinions-polls/819073-utility-vs-synergy-in-commander
- "Good EDH Decks That Don't Require Their Commander?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/740326-good-edh-decks-that-dont-require-their-commander
- "[Builder] Fetch combos from commander spellbook based on your decklist." — https://archidekt.com/forum/thread/5341810/1
- "Compare to average deck from EDHrecs" — https://archidekt.com/forum/thread/5639666/1

Who: casual and mid-power players whose games stall, and brewers whose deck drifted off theme.
Tried: EDHREC theme pages, Commander Spellbook (finds infinite combos only, not value engines).
Solved when: they can say "this deck wins by X", see which cards serve that and which drifted, and
see what a card connects to before cutting it.

### 5. "What bracket is this, and does it fit my pod?" `[mtg-pod-fit]`

- "Which bracket is my deck" variants: "Question about brackets" — https://tappedout.net/mtg-forum/commander/question-about-bracketst/ ; "Help me figure out my commander deck power levels?" — https://archidekt.com/forum/thread/5425518
- "Bracket Estimation Error" (a Ygra two-card combo deck rated Bracket 2) — https://archidekt.com/forum/thread/14871568
- "Make the brackets accurate" — https://archidekt.com/forum/thread/19572447
- "The Auto-Estimate algorithm for commander brakets does not consider the quality of tutors" — https://moxfield.nolt.io/1871
- "Don't automatically suggest bracket levels." — https://moxfield.nolt.io/1853
- "Help Needed: Lower my Power Level" — https://www.mtgsalvation.com/forums/the-game/commander-edh/198949-help-needed-lower-my-power-level
- "\"Weakening\" an EDH deck" — https://tappedout.net/mtg-forum/commander-deck-help/weakening-an-edh-deck/
- "Decks are too weak, and also too strong" — https://tappedout.net/mtg-forum/commander/decks-are-too-weak-and-also-too-strong/
- "Mixed Playgroup - How do I fit in?" — https://tappedout.net/mtg-forum/commander/mixed-playgroup-how-do-i-fit-in/
- "Getting overwhelmed by my playgroup. Usually get stuck in 3v1 situations." — https://www.mtgsalvation.com/forums/the-game/commander-edh/751583-getting-overwhelmed-by-my-playgroup-usually-get
- "Play Group Salty: Help! XD" — https://tappedout.net/mtg-forum/commander-deck-help/play-group-salty-help-xd/
- "How would you describe the power level of these decks?" — https://www.mtgsalvation.com/forums/the-game/commander-edh/807584-how-would-you-describe-the-power-level-of-these
- "How do you calculate the power level of a Commander deck in Magic: The Gathering?" — https://www.quora.com/How-do-you-calculate-the-power-level-of-a-Commander-deck-in-Magic-The-Gathering

Who: players in a fixed pod, players meeting strangers at a store, owners of "notorious"
commanders. Tried: Moxfield and Archidekt auto-estimates and at least ten calculator sites.
Their complaints (seen): estimators count Game Changers but miss two-card combos, ignore tutor
quality, label strong decks "Bracket 2", and give a number without reasons. Solved when: a
bracket they can defend at the table, the specific cards that decide it, and swaps that move it.

## What r/EDH says (2026-09-26)

About 190 thread titles and 80 full threads with their top comments, from r/EDH. Scores are
upvotes and comments at the time of the scrape. Where Reddit changed a seat, the seat says so.

### 1. Cut to 100

- "I'm pretty new to magic, and I'm trying to get into deckbuilding, but I've ended up with a couple
  lists at ~120 ish cards after I've already trimmed a decent bit, and idk where to keep cutting."
  (17 points, 52 comments) https://www.reddit.com/r/EDH/comments/1uofemj/how_do_you_cut_cards/
- "How does one go about cutting down to 99?" (16, 45) https://www.reddit.com/r/EDH/comments/1nkk7pv/how_does_one_go_about_cutting_down_to_99/
- "Edit: I cut 25 cards but I still need 18 cuts and im stuck any direct recommendations?"
  https://www.reddit.com/r/EDH/comments/1t3xqa3/how_do_you_decide_what_gets_cut_during_deck/
- Most liked approach: "Tip for when every card feels to good to cut" (296, 95): start over from
  zero and add only the cards you are sure of.
  https://www.reddit.com/r/EDH/comments/1tqv6er/tip_for_when_every_card_feels_to_good_to_cut/

**What solved looks like:** a test tied to the plan, "Does it advance my win? Does it stop theirs?
Does it do a critical role of ramp/draw/remove?" (22), concrete categories (win-more, expensive,
redundant ramp), and a provisional cut: "Do not touch it again until you've played a couple of
games." (61). Posters are usually 20–40 over, not 8. About 21 of 29 titles were on topic.

### 2. Precon on a budget, losing to friends

- "my one friend in particular seems to win 80% of the time." … "We all play precons so i figured it
  would be fair." (98, 111) https://www.reddit.com/r/EDH/comments/1tq7ws4/friends_deck_too_strong/
- "For Commander pre cons, what upgrades are the most meaningful first? Lands? Low end? high end?
  Removing 'bad' cards?" (88, 108) https://www.reddit.com/r/EDH/comments/1s5eo9w/for_commander_pre_cons_what_upgrades_are_the_most/
- "Is there such thing as a $50 deck that's good and can compete with other decks that have meta
  cards?" (117, 229) https://www.reddit.com/r/EDH/comments/1twmjcb/
- Budgets named: $50, $100 NZD including the precon, "proxy cards that are worth more than $30".

**What solved looks like:** "Most precons are trying to do like 2 or 3 things. Remove one and replace
with cards that focus the remaining synergies" (322 points); fix the lands; lower the curve; "10-15
cards that go in a different direction than the face commander". Replies almost never name cards
to buy. Beginners here use "bracket" as a word their friends say ("keep the deck a bracket 3").

### 3. Slow, inconsistent, runs out of cards

- "Deck feels inconsistent af and i dont know why that is" https://www.reddit.com/r/EDH/comments/1ooc3xa/
- "How do I stop running out of freaking cards??" https://www.reddit.com/r/EDH/comments/1lrby58/
- "My mana curve is low meaning i should be playing a lot of cards fast yet i somehow cant..."
  (2, 33) https://www.reddit.com/r/EDH/comments/1vnuigq/
- Land-count threads draw the most heat: "You suck at math: how many lands to run" (509, 512),
  "A deep dive into land counts" (142, 302).

**What solved looks like:** counting, with the ramp included: "Cutting down to 30 or less lands
without any other Mana sources is the problem. Not necessarily the count by itself." (190);
"Proper deck building mitigates mana screw." (22); "the magic number for things you want to see
every game … is 8" (34); and focus: "You're going in too many directions" (10). No reply settles
bad luck against construction. Readers of the long maths post asked for "a TLDR at the bottom" (234).

### 4. No plan, no win condition

- "What to do when a deck does "Nothing" or is too "Slow"" (100, 39) https://www.reddit.com/r/EDH/comments/1q15li3/
- "How does drawing my entire deck actually win me the game?" (0, 84) https://www.reddit.com/r/EDH/comments/1wi4jt6/
- On r/EDH, "no win condition" is mostly said *about other people's decks*: "People who play decks
  that have no win condition/aren't trying to win, why?" (150, 362), top reply "Some people are just
  bad deckbuilders." (277). The persona's opening quote changed because of this.

**What solved looks like:** "pick a way" (name the cards that end the game), and "can you describe
your first five turns?". EDHREC's per-commander numbers can miss a pair that matters in one deck.
About 9 of 41 titles were on topic; the rest were commander picks and favourite win-cons.

### 5. Bracket and pod fit

- "It got 4 on Brackcheck, 2 on EDHpowerlevel and 3 on deckcheck." (0, 13) https://www.reddit.com/r/EDH/comments/1ozp7iw/
- "If people are consistently telling you that your deck is too strong: you're the problem, not
  everybody else, not the bracket system" (689, 532) https://www.reddit.com/r/EDH/comments/1p393va/
- "Getting Targeted Every Game by 1 Person in my Playgroup" (153, 274) https://www.reddit.com/r/EDH/comments/1ssvjk1/
- "The rule zero discussion is much harder to have in store or event settings when you are meeting
  players for the first time" (0, 13) https://www.reddit.com/r/EDH/comments/1gidbfo/

**What solved looks like:** Game Changers and two-card combos are the only facts people agree on;
speed decides the rest. "I asked multiple of those to analyze a Bracket 4 [[Aang, at the
crossroads]] deck designed to win on turn 3 … Every single one of those websites thought it was
bracket 2." (5). A good rule-zero line is "a 3, but only because of cards X and Y". About 30 of 41
titles were on topic; "what bracket is my deck" posts score near zero but draw 13–64 comments.

### What r/EDH says about deck tools

- "I've tried 3 different online tools now and had 3 different results!" (0, 13) https://www.reddit.com/r/EDH/comments/1ozp7iw/
- "Moxfield says bracket 2 but I don't believe it" (0, 19) https://www.reddit.com/r/EDH/comments/1qovimi/
- "Is there a tool I could use that takes my deck, compares it against cards I'm considering, and
  makes recommendations of what to switch out for those considered cards?" (0, 29) https://www.reddit.com/r/EDH/comments/1sawjpy/
- "Looking for some kind of visualiser tool for my decks to help me track synergies." https://www.reddit.com/r/EDH/comments/1p1chxw/
- "Giving and receiving deck feedback is insanely labor intensive and involves jumping around to
  like 6 different tabs" (827, 419) https://www.reddit.com/r/EDH/comments/1uqynon/
- "Do not use AI to make deck suggestions or clarify rules. It's wrong most of the time." https://www.reddit.com/r/EDH/comments/1q0epg2/

**What earns trust, and what loses it** (the same pattern as the forum research, now with Reddit's
wording):
- Counts people can check are accepted: "Beyond counting game changers and reviewing combos, it's
  pretty vibes based" (12). Judgments are not, above all when tools disagree.
- Missing the plan loses trust fastest: "the sites have a lot of trouble with synergy … I have a deck
  that is trying to summon a bunch of small fliers, and none of them seem to identify that as a win
  condition"; a tool that "kept wanting to cut all the 4-mana rocks … despite being the most core
  part of the deck's game plan"; one that "noticed the … combo … However, it failed to see that this
  combo wins the game".
- Stated wishes: "I wish there was a better way to explicitly tell the power tuning feature what the
  deck's game plan is." and a way "to signal which playstyle is the deck".
- A verdict is welcome as "a starting spot" for a rule-zero description, not as gospel.
- Strong anti-AI feeling ("Keep AI away from Magic", 12); "not vibe coded" is used as praise.

## What they think of the tools they already use

- **EDHREC**: a solid starting point, but it shows what is popular, not why a card fits this deck,
  and not what to cut ("Is EDHREC ruining commander?" — https://tappedout.net/mtg-forum/commander/is-edhrec-ruining-commander/).
- **Moxfield's feedback board** asks for combo detection in the deck page (/367, /1042, /1555,
  /1704), automatic role tags (/1427, /2346), suggestions filtered to the player's collection
  (/2095, /1340), and bracket labels the player controls (/1853).
- **ChatGPT-style builders**: invented cards, forgotten decklists, generic advice. Every AI deck
  checker now advertises "no hallucinated cards".
- **The field is crowded.** Paste-a-list analyzers found: DeckCheck, Rate My Decks, EDHcheck,
  BrackCheck, ManaTap, MTG Synergy Analyzer (mtgsynergy.app, which promises "how your deck wins"),
  Farseek, Arcane Tutor, Sensei's EDH Brewer, Playgroup.gg, at least ten bracket calculators.

**What earns trust** (seen and inferred): advice tied to the actual list; explanations that name
the cards involved; card text the player can check; saying what the tool does not check; leaving
the final call to the player. **What loses it**: wrong labels on obvious decks, popularity dressed
as reasoning, a bare number.

## Does edhseer answer these today?

My reading of the product as of #539, to be tested by the round, not taken as its result.

| Problem | Answered today | Where | Missing |
|---|---|---|---|
| 1. Cut to 100 | Mostly | "What to change": the cut list with reasons and "why you might keep it"; Trim 3/5/10 | a pet-card guard is not obvious; the count "you are 8 over" is not the first thing a 108-card deck sees |
| 2. Precon upgrade | Partly | suggestions ("Strengthen what works"), swaps beside cuts | **no prices or budget**, **no "cards I own"**; nothing says whether this deck would beat the friends' decks |
| 3. Slow / screwed | Mostly | Mana chapter (lands vs target, colour sources, cast odds by turn), Roles with targets, "you will run out of cards" | "is this bad luck or my deck?" is never said in those words; the answer is spread across two chapters |
| 4. How it wins / is X worth it | Mostly — the core | Game plan: commander ring, themes, "How you win" (win plans, clock), combos, "See links" per card | a named finisher when the deck has none; comparison with the usual build for this commander |
| 5. Bracket and pod | Partly | bracket readout with Game Changers and two-card combos named | tutor quality, a one-line rule-zero summary to share, swaps that move the bracket, "why am I the target" |

The two things that set it apart, if the round confirms them, are the ones the research says nobody
else does: **why** cards work together, with their text on screen, and cuts with reasons tied to this
list.
