# Swaps and cuts: why "the same job" is not, and redundancy groups (2026-10-04)

The owner, 2026-10-04: "we are mixing up effects and suggest swaps that do not work the same way
just because those are cheaper, like suggesting to swap Flawless Maneuver, which can be free and
gives indestructible to creatures, for something that is cheaper but gives your creatures
protection from creatures. Those are not the same things. I believe we lack card redundancy,
basically grouping the cards within bags of same effects, because two draw spells are not
necessarily built equally."

The owner is right, and the deployed pages show how far it goes. This file says what was found,
which rule lets each kind of swap through, and what to build. It is written for a Claude Code
session; every claim names the file and line it came from. #976 (redundancy groups) is the plan
this extends, and its G1 measure (hand-labelled pairs, 90% purity) is the gate for every task
here. The labelled pairs below are a start on that set.

## What was measured

Every package swap on the 197 deployed precon pages (`static/v-6d84f2f6655a/precons/*.json`,
read 2026-10-04): 516 distinct (role, out, in) swaps, 247 of kind `role` and 269 `game-changer`.

| | distinct | precon uses |
|---|---|---|
| `role` swaps | 247 | 505 |
| ...whose only stated gain is "for N less mana" | 101 (41%) | 253 (50%) |
| `game-changer` swaps | 269 | |

The example the owner saw is on three precons (Ruthless Regiment, Rebellion Rising, Multiverse
Reforged), at every bracket: "Flawless Maneuver -> Spare from Evil. Spare from Evil is the same
protection for 1 less mana."

### The protection section, in full

Every distinct `role` swap in the section, with the two cards read side by side:

| precons | out | in | the same job? |
|---|---|---|---|
| 31 | Swiftfoot Boots (hexproof + haste, equip {1}) | Commander's Plate (+3/+3, protection from off-identity colours, equip {3}) | no: different keywords, equip cost three times higher, "1 less mana" reads the cast cost only |
| 28 | Lightning Greaves (shroud + haste, equip {0}) | Commander's Plate | no, as above |
| 6 | Unbreakable Formation (indestructible, + counters in main phase) | Break of Day (+1/+1; indestructible only at 5 life or less) | no: the add's indestructible is conditional |
| 6 | Darksteel Mutation (an Aura that turns a creature into a 0/1) | Shardmage's Rescue (hexproof the turn it enters, +1/+1) | no: the cut is removal, not protection |
| 3 | Flawless Maneuver (indestructible; free with a commander) | Spare from Evil (protection from non-Human creatures) | no |
| 2 | Whispersilk Cloak (shroud, unblockable) | Commander's Plate | no |
| 2 | Bathe in Light (protection from a colour, radiance) | Armor of Shadows | no (different keyword) |
| 2 | Akroma's Will (two modes, six keywords) | And They Shall Know No Fear (one creature type, +1/+0 and indestructible) | no |
| 2 | Ultimate Magic: Holy | Dawn's Truce | not read |
| 1 | Sanctuary Blade / Champion's Helm | Commander's Plate | no |
| 1 | Redemption Arc | Shardmage's Rescue | not read |
| 1 | Ephemeral Shields | Blacksmith's Skill | plausible (both give indestructible to one creature) |

Thirteen of fourteen are not the same job. The whole section is one defect (D1 below).

### Labelled pairs from the other sections (G1 seed)

`role` swaps, by frequency, with the reason the page prints and a reading of both cards:

| role | precons | out -> in | page says | same job? | why not |
|---|---|---|---|---|---|
| draw | 10 | Explore -> Artifist Acumen | 1 less mana, more cards for the mana | no | Explore's extra land is its point; Acumen's first strike is not draw |
| draw | 7 | Syphon Mind -> Artifist Acumen | 3 less mana | no | Syphon Mind draws one per opponent (three) and makes them discard; read as "draw a card" |
| draw | 5 | Distant Melody -> Birthday Escape | 3 less mana | no | draw per creature of a type vs draw one |
| draw | 5 | Return of the Wildspeaker -> To Arms! | 3 less mana | no | draw equal to greatest power vs draw one |
| draw | 4 | Rishkar's Expertise -> Artifist Acumen | 5 less mana | no | draw equal to greatest power plus a free spell vs draw one |
| draw | 4 | Sign in Blood -> Insatiable Avarice | 1 less mana | weak | spree: the draw mode costs {B}{B}{B}, not 1 |
| draw | 3 | Deep Analysis -> Insatiable Avarice | 3 less mana, nothing back | no | as above, and "nothing back" is false (3 life) |
| draw | 3 | Thirst for Knowledge -> Brainstorm | 2 less mana, more cards | weak | different mechanics; defensible only as "a cantrip" |
| draw | 5 | Urban Evolution -> Amass the Components | 1 less mana, more cards | plausible | |
| removal | 10 | Mortify -> Winnow | 1 less mana | no | Winnow needs two permanents with the same name: dead in singleton |
| removal | 9 | Beast Within -> Wild Magic Surge | 1 less mana | weak | Surge only hits an opponent's permanent and hands back a free permanent |
| removal | 7 | Decimate -> Misguided Rage | 1 less mana, more kinds | no | an edict of the opponent's choice is not targeted removal |
| removal | 4 | Terminate -> Unwanted Remake | 1 less mana | weak | manifest dread hands back a 2/2 |
| removal | 4 | Beast Within -> Assassin's Trophy | 1 less mana | plausible | |
| removal | 3 | Bedevil -> Transforming Flourish | exiles it | no | Flourish hits artifact or creature only, not planeswalkers; opponent may cast a free spell; demonstrate copies it for an opponent |
| removal | 2 | Terminate / Infernal Grasp -> Molten Frame | more kinds of card | no | "artifact creature" is AND, read as artifact OR creature |
| removal | 2 | Hex -> Yawgmoth's Vile Offering | 1 less mana, more kinds, exiles | no | legendary sorcery (needs a legendary creature or planeswalker), destroys one not six |
| removal | 2 | Pongify -> Rapid Hybridization | nothing back | no | both give a 3/3; the reason is false |
| wipe | 4 | Toxic Deluge -> Nausea | 1 less mana, nothing back | no | -X/-X vs -1/-1 |
| wipe | 4 | Vanquish the Horde -> Fumigate | 3 less mana | no | Vanquish costs 1 less per creature; usually cheaper than 5 |
| wipe | 2 | Nevinyrral's Disk -> Boompile | 1 less mana | no | a coin flip |
| wipe | 2 | Their Name Is Death -> Bontu's Last Reckoning | 3 less mana | no | lands don't untap next turn |
| wipe | 2 | Mutilate -> Cry of the Carnarium | 1 less mana, exiles | no | -1/-1 per Swamp vs -2/-2 |
| wipe | 2 | Raise the Palisade -> Harsh Mercy | 2 less mana, destroys | no | bounce all but a type vs destroy all but each player's type |
| wipe | 2 | Wash Out -> Day of Judgment | destroys it | no | bounce all of a colour vs destroy creatures |
| wipe | 7 | Austere Command -> Cleansing Nova | 1 less mana, more kinds | plausible | |
| wipe | 4 | Winds of Rath -> Day of Judgment | 1 less mana | plausible | |
| counter | 5 | Counterspell -> Nix | 1 less mana | no | counters only a spell cast for free |
| counter | 2 | Disdainful Stroke -> Nix | 1 less mana, more kinds | no | as above |
| counter | 1 | Absorb -> Laquatus's Disdain | 1 less mana | no | counters only a spell cast from a graveyard |
| counter | 1 | Spell Stutter -> Force Spike | 1 less mana | weak | pay {1} vs pay {2} plus Faeries |
| tutor | 2 | Diabolic Tutor -> Cateran Summons | 3 less mana, more found | no | finds a Mercenary card only |
| tutor | 1 | Long-Term Plans -> Trapmaker's Snare | 1 less mana, more found | no | finds a Trap card only |
| impulse | 3 | Escape to the Wilds -> Rob the Archives | 3 less mana | no | five cards vs two |
| ramp | 11 | Darksteel Ingot -> Arcane Signet | 1 less mana, more mana | yes | |

Of 36 labelled pairs, 5 are the same job, 5 weak, 26 not. The owner's G1 asks for 90%.

The `game-changer` swaps are by the 2026-10-02 ruling (brackets as power within a group) and are
not labelled here, with one note: Sol Ring -> Smothering Tithe (4 precons) and Arcane Signet ->
Smothering Tithe (29) say an enchantment that makes Treasure off opponents' draws is "ramp too" in
a Signet's group. The group "rock" (`rampKind`, `same-job.ts:96`) is as coarse as the role.

## Why: the rules, and what each one cannot see

The chain is `roleOption` (`upgrade-sections.ts:93`): the add fills every role the cut fills,
`sameJob` passes in each, `strictlyBetter` (line 59) finds no measure worse and one better. The
deck report's swaps go through the same `sameJob` (`suggest-static.ts:614`).

**D1. A keyword grant has no keyword, no recipient, no duration, no delivery.** `effectsOf`
(`same-job.ts:177`) keys an ability as `kind|verb|control`; a grant derives as
`{ kind: "keyword-grant", subject: { control: "any" } }` with no emits, so every grant on the
corpus has the key `keyword-grant` and `protects()` (line 191) adds only "you" or "permanents".
Indestructible, hexproof, shroud, haste, first strike, protection from a colour all read alike;
an instant for the turn reads like an Equipment forever. `Ability.grants` (`schema.ts:1117`,
DERIVE 213) exists and is empty on every card above: Flawless Maneuver, Spare from Evil, Swiftfoot
Boots, Commander's Plate, Unbreakable Formation, Akroma's Will. The grammar reads the keyword
(`grant-ability` with the keyword as its object, DERIVE 243) and the clause record drops it.

**D2. The mana value is the cast cost, whatever the card charges.** `ingredients`
(`quality.ts:126`) adds an activation only when every role ability is activated, so an
Equipment's equip cost (Plate {3} against Boots {1}) is never counted. A free alternative cost
(Flawless Maneuver, Deadly Rollick), a cost reduction (Vanquish the Horde), a spree mode's cost
(Insatiable Avarice), flashback and convoke are not read either. Half the role swap uses are
justified by this number alone.

**D3. The yield is one printed number.** `yieldOf` (`same-job.ts:80`) reads "draw N cards" and
stops: "draw a card for each" (Syphon Mind, Distant Melody) is 1, "draw cards equal to" (Rishkar's
Expertise, Return of the Wildspeaker) is null and compares as anything. Wipes have no yield at all,
so -X/-X and -1/-1 are equal (Toxic Deluge -> Nausea), as are five impulse cards and two.

**D4. Conditions are a blacklist of regexes, and the add's printed text keeps slipping past it.**
`CONDITIONS` (`same-job.ts:23`) misses: a bare "if" on the effect (Nix "if no mana was spent",
Winnow "if another permanent with the same name", Break of Day "if you have 5 or less life"),
"of their choice" (Misguided Rage), "flip a coin" (Boompile), "don't untap" (Bontu's; the list has
"doesn't untap"), "cast from a graveyard" (Laquatus's Disdain), a legendary sorcery (the condition
is reminder text, which is stripped, and the type line is not read), manifest dread (a gift the
`GIVES_A_PERMANENT` regex does not match). A list like this is never finished.

**D5. "What it hits" reads AND as OR and ignores whose.** `hits()` (`same-job.ts:110`) unions the
subject's types, so Molten Frame's "artifact creature" hits two kinds and beats Terminate.
`answerCovers` ignores `control`: Wild Magic Surge (an opponent's permanent) covers Beast Within
(any permanent). A tutor is not an answer role, so its subtype limit (Mercenary, Trap) is never
compared.

**D6. The role is the wrong role.** Darksteel Mutation is `protection` because it grants
indestructible to the creature it neutralises; Smothering Tithe is a "rock". `rolesOfCard` reads
effect kinds, not what the card is for.

**D7. The reason overstates.** `roleReasons` says "the same protection", "gives the opponent
nothing back" (Pongify -> Rapid Hybridization: both give a 3/3), "against more kinds of card"
(Molten Frame). H2 caps the length; nothing checks the claim against the cards.

The common cause: the same-job test reads a few derived fields and a few regexes, while the two
cards' difference is in words those fields do not hold. The grammar (#896) now reads most of
those words into typed readings, and the clause record throws them away before `sameJob` sees
them (see `docs/plans/2026-10-04-grammar-derive-review.md`, F1 and F3).

## What to build: redundancy groups with a real key

#976's model stands: a group is the cards that do one job the same way, a deck's redundancy is
members per group, an upgrade stays inside a group, a back-up adds to a thin group. What changes
is the key. Today's key (role, `effectsOf`, `answerCovers`, `rampKind`) inherits D1 to D6. The
key below is built from the typed readings the grammar already produces, and nothing is compared
that the key does not state.

**A group key, per role:**

| part | from | examples |
|---|---|---|
| role | `rolesOfCard` | protection, draw, targetedRemoval |
| what it does | the action verb(s) of the role ability | grant-ability, draw, destroy, exile, counter-spell, search |
| to whom / what | the reading's object filter: control, type, scope (one target, all yours, each), and for a grant the recipient; for an answer, the types it hits as a conjunction, with control | "creatures you control", "target artifact creature", "an opponent's permanent" |
| which keywords | `grants` from the reading | indestructible; hexproof + haste; protection from colours |
| how long | the reading's duration | until end of turn; continuous (Equipment, Aura, static) |
| delivery | the card shape plus attachment | instant, sorcery, Equipment (equip cost), Aura, static enchantment, activated |
| how much | the amount expression, kept as an expression | 1, 2, X, "for each opponent", "equal to greatest power", -1/-1, -X/-X |
| conditions | any `condition` on the reading or the trigger, and any unread phrase | "if no mana was spent", "if you have 5 or less life", legendary sorcery, coin flip |
| what it gives back | emits whose subject is the opponent's (token, enters, cast, draw) | Beast Within's 3/3, Wild Magic Surge's permanent, Unwanted Remake's 2/2 |
| what it costs | mana cost, alternative cost, additional cost, equip cost, life | {2}{W} or free with a commander; equip {3}; pay X life |

Two cards are in the same group when every discrete part is equal and the amount expressions are
of the same shape (both fixed, both "for each X" over the same X, both "equal to" the same thing).
A card with a condition is in a group of its own unless the other card has the same condition.
A card with an unread phrase is in no group. Price and mana value are not in the key; they are
what an upgrade compares inside a group.

**An upgrade inside a group** is then: at least as good on every cost part (mana, equip, life),
at least as much on the amount, and better on one, with a reason that names the part. "For 1 less
mana" alone is allowed only when the rest of the key is equal, which is the thing the key now
guarantees.

### Tasks, in order

Each one PR. Before any code, the labelled pairs: the 36 above plus 24 more drawn from the census,
half from swaps the page shows and half from pairs a player would call the same (two Signets, two
Wraths, Swords and Path), written to `packages/matcher/src/same-job.labels.json` with the reading
for each. G1: 90% of pairs the key puts together are labelled same, and no pair labelled different
shares a key. The 20-precon S2 build and the panel are unchanged by every task.

1. **Carry the grant.** Make `Ability.grants`, the recipient and the duration land on every
   keyword-grant ability. The grammar reads them (`grammar/action.ts`, `grant-ability`); thread the
   reading through derive rather than the string object (grammar review, T3). Measure: the count of
   `keyword-grant` abilities with `grants` set, corpus-wide, before and after; every card in the
   protection table above has them after.
2. **`groupKey(card, role)`** in `same-job.ts`, built as the table says, from the typed readings
   where derive carries them and from the tags where it does not yet; `sameJob` becomes
   `groupKey(cut) === groupKey(add)`. Where a part cannot be read, the key is null and the card
   joins no group (a refusal, not a guess). Keep `same-job.test.ts`'s fixtures passing and add the
   labelled pairs as a test.
3. **Cost as the card charges it.** `ingredients.manaValue` becomes the cost the group's delivery
   implies: equip cost for an Equipment, the activation for an activated ability, the mode's cost
   for a spree or a modal spell, and an alternative cost recorded beside it so a free spell is never
   "worse" than a paid one. `yieldOf` becomes the amount expression from the key.
4. **Reasons from the key.** `roleReasons` names the part the add is better on and says the parts
   that are equal in the key's words ("the same indestructible for your creatures, at instant
   speed, for 1 less mana"). A reason may not claim a part the key does not hold.
5. **Members per group and back-ups** (#976 steps 3 and 5), on the new key.
6. **Rebuild the 197 and re-run the census** (`swap-census.mjs`, procedure below). Report: role
   swaps before and after, the share justified by mana alone, and the G1 purity on the labelled set.

### What must not move

- The panel precision and retention, compass, anti.
- The precon page's bring-down cuts and the bracket guard: the key changes which swaps are
  offered, never what a Game Changer is.
- No swap is offered whose key is null on either side.

## How this was measured

Two scripts in the gitignored `static-out/` (worth moving under `research/` if kept):

- `swap-census.mjs`: fetches `manifest.json`, the precon index and every precon page from
  `https://edhseer.cards/static`, and prints every `role` and `game-changer` swap as
  `role|kind|out|in` with the page's own reason and the number of precons it appears on.
- `card-text.mts`: for a list of card names, computes the shard with `shardOf`, fetches it, and
  prints the printed text, mana cost, type line and a one-line summary of the derived abilities
  (kind, grants, subject, emits). It is how the "same job?" column above was read.

The labels are one reader's; a second reader should check them before they become G1.
