# What players actually ask, and whether edhseer answers it

Researched 2026-09-26, to ground the persona reviewers (`.claude/agents/`) in questions real
Commander players post, instead of in how much Magic a reviewer knows. The owner's brief: *"create
those based on comments, questions people ask, like on Google or Reddit, to see if our tool actually
is something that can solve people's problems."*

## How this was gathered, and its limits

- Five researchers, one per problem area, about 130 web searches in total, each keeping only titles
  that appeared **verbatim** in results, with their URL.
- **Reddit is not in this data.** The research environment's network policy blocks `reddit.com`
  and its archive APIs, and search with a Reddit filter returned nothing. The titles come from
  TappedOut, MTG Salvation, the Archidekt forum, Moxfield's feedback board (`moxfield.nolt.io`),
  Deckstats, Quora and Facebook groups. Several MTG Salvation threads are years old, so the
  phrasing can be older than today's Reddit.
- Only **titles and search snippets** were read, never whole threads. Who asks and what "solved"
  means for them are inferred from those, and marked as such below.
- Rerun with `reddit.com` allowed before treating the frequencies here as real.

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
