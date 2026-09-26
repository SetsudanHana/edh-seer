# Engine fixes found by the Overview persona rounds

**Source:** five persona rounds on the Graph tab's new Overview (`EnginesView`), 2026-09-25.
- Seats: precon (Party Time), tuner (`calibration/inalla`), skeptic (`calibration/yuna-grand-summoner`), phone (Inalla at 390px).
- Card data was live throughout.
- Every item below was cross-checked against the report JSON. Each lists the exact producer → consumer, tag, repeatability and sentence the engine emits.

**Scope:**
- All client-side findings are fixed and merged in SetsudanHana/edh-seer#487.
- What is left here is **engine / matcher / tagger** work. Most seats' scores are now capped by these claims, not by the page.
- Two things the seats flagged turned out to be right, so they are **not** here: Mana Sculpt as a counterspell, and Hedge Maze surveilling when fetched.

**Status (2026-09-26).** Engine PRs that landed after this list was written. The rows marked *live* were confirmed on edhseer.cards after the deploy of #496; confirm the rest on their calibration decks before deleting an item:

| item | status |
|---|---|
| 1. Weaver copies from non-enchantments | fixed, *live*: in the Yuna deck Weaver's only copy line is from Sythis, an enchantment; Yuna and Crystal Fragments are gone (#488 plus the copy-source filter) |
| 2. "arrives with counters" names the wrong card | (a) fixed, *live*: "When Rikku is cast, it arrives with counters thanks to Yuna"; (b) and (c), the repeatability, still open: these lines still read EVERY TIME |
| 3. Prowess wording | fixed, *live*: "Harmonic Prodigy gets +1/+1" |
| 4. Inalla's exile to "leaves the battlefield" payoffs | open |
| 5. The party as one subject | fixed, *live*: the top group is the party (the Overview names it "Counts your party members" from the next client release) |
| 6. One-shot effects tagged "every time" | landed in #493 (a one-shot producer) and #490 (an on-cast board count happens once) |
| 7. Fetch tags name the matched type | fixed, *live*: no "Fetching Islands" group in Inalla |
| 8. The Earth Crystal doubles any counter | open |
| 9. Role mis-tags | fixed, *live*: neither Archaeomancer nor Weaver is filed under removal or counterspells |
| 10. "Effect not read yet" on read doublers | fixed, *live*: no "effect not read yet" in Inalla |
| 11. Multiclass Baldric | check after #490 |
| 12. Class word credited as a token | fixed, *live*: no "(token from Transpose)" in Inalla |

**How to reproduce any item:**
- Analyse the named deck (`packages/cli/decks/...`) and read `report.edges[].reasons[]`.
- Or run the card through the matcher's pair tests.
- Oracle text quoted below is what the page printed beside the claim.

**Priority** is by how often the seats hit an item and how much it cost them. P1 items were named in 3+ rounds by 2+ seats.

---

## P1: wrong claims shown next to card text that disproves them

### 1. Weaver of Harmony copies abilities from non-enchantment sources
- **Deck:** `calibration/yuna-grand-summoner`. The skeptic flagged this in every round, and it sits in the #3 "best pair".
- **Oracle:** Weaver of Harmony reads "{G}, {T}: Copy target activated or triggered ability you control **from an enchantment source**."
- **Emitted:** `copies:triggered` or `copies:activated`, producer = the source, consumer = Weaver, repeatability `activated`, for example:
  - `Yuna, Grand Summoner -> Weaver of Harmony | copies:triggered |` "Weaver of Harmony copies Yuna, Grand Summoner's triggered ability". Yuna is a Legendary Creature, not an enchantment.
  - `Crystal Fragments // Summon: Alexander -> Weaver of Harmony | copies:activated |` "…copies Crystal Fragments's activated ability". The front face is an Artifact — Equipment.
  - Also check `Starfield Mystic`, `Tidus`, `Rikku`, `Jill, Shiva's Dominant` (front face), and `Dion, Bahamut's Dominant` (front face).
- **Likely cause:** `packages/matcher/src/edges.ts`, `copyAbilityEdges` (~l.2236). It filters only on `a.effect.subject?.type`. Weaver's "from an enchantment source" is probably derived into a different field, or not at all.
  - Check Weaver's derived `copy-ability` effect in the tagger (`packages/tagger/src/derive/`), and make `copyAbilityEdges` honour the source's type.
  - For DFCs, use the face that has the ability.
- **Accept when:** in the Yuna deck, Weaver has copy edges only to enchantment permanents (Sagas, Summons, enchantment creatures, Sythis, Setessan Champion, Enchantress's Presence and so on).

### 2. "X is cast, Y arrives with counters" names the wrong card
- **Deck:** Yuna. It appears in the #1 pair and the tapped-Fenrir panel, and was flagged in every round.
- **Oracle:**
  - Yuna, Grand Summoner: "{T}: Add one mana of any color. When you next cast a creature spell this turn, **that creature** enters with two additional +1/+1 counters on it."
  - Summon: Fenrir's chapter II works the same way.
- **Emitted:**
  - `Summon: Fenrir -> Yuna, Grand Summoner | cast:creature | triggered |` "When Summon: Fenrir is cast, Yuna, Grand Summoner arrives with counters". It is Fenrir that arrives with counters, not Yuna.
  - Likewise `Tidus, Rikku, Weaver of Harmony -> Yuna, Grand Summoner` and `Yuna, O'aka, Setessan Champion, Sythis, Satsuki, Yuna Hope of Spira -> Summon: Fenrir`.
- **Three problems:**
  - **(a) Sentence subject.** The consumer's effect puts counters on the **cast** creature, the producer. The sentence should read "When Summon: Fenrir is cast, it arrives with counters thanks to Yuna" or similar. The template is `packages/matcher/src/sentence.ts:66` (`"enters-with-counters": … "arrives with counters"`), which renders the consumer as the subject.
  - **(b) Repeatability.** Yuna's is a mana ability you pay for (`{T}`), so it's `activated` ("on demand"), not `triggered`.
  - **(c) One-shot chapters.** Fenrir's chapter II is once per Saga, so it's `oneshot` (see item 6).
- **Accept when:** the sentence names the cast card as the one getting counters, and the tag or badge matches how often it happens.

### 3. Harmonic Prodigy "makes your creatures bigger" when a creature is cast
- **Deck:** `calibration/inalla`. It's in the #1 pair and was a cut candidate's reason. Tuner, skeptic and phone all flagged it in every round.
- **Oracle:** "Prowess (Whenever you cast a **noncreature** spell, **this creature** gets +1/+1 until end of turn.)"
- **Emitted:**
  - `Kindred Discovery -> Harmonic Prodigy | cast:-creature |` "When Kindred Discovery is cast, Harmonic Prodigy makes your creatures bigger". The trigger is right; the effect wording is wrong.
  - Earlier live data also showed `High Fae Trickster -> Harmonic Prodigy`, a **creature** spell. Check that it's gone.
- **Likely cause:** `packages/matcher/src/sentence.ts:85`, where the pump effect falls back to "makes your creatures bigger" when the amount isn't numeric. Prowess's target is `self`, so it should read "Harmonic Prodigy gets +1/+1".
  - Also verify no `cast:creature` edge reaches a prowess card.
- **Accept when:** prowess edges read "…, Harmonic Prodigy gets +1/+1", and only noncreature spells feed them.

### 4. Inalla's end-step exile is not linked to "leaves the battlefield" payoffs
- **Deck:** `calibration/inalla`. The tuner overruled the cut list over this in every round.
- **Oracle:**
  - Inalla: "…create a token that's a copy of that Wizard. The token gains haste. **Exile it at the beginning of the next end step.**"
  - Dour Port-Mage: "Whenever one or more other creatures you control **leave the battlefield without dying**, draw a card."
  - Watcher for Tomorrow: "When this creature **leaves the battlefield**, put the exiled card into its owner's hand."
- **Emitted:** there is no `Inalla -> Dour Port-Mage` or `Inalla -> Watcher for Tomorrow` `leaves:*` edge. Port-Mage's only `leaves` feeder is Essence Flux. Watcher's is `Toxic Deluge -> Watcher for Tomorrow | leaves:creature |` "…thanks to Toxic Deluge, it triggers", which is also an unread effect.
- **Needed:** an implied `leaves:creature` event (exiled, so not dying) from token-copy makers that exile at end step: Inalla, Kiki-style and Mirror March-style cards.
  - The event should feed both "leave without dying" payoffs and the copied creature's own leaves trigger (Watcher's hideaway return).
  - See `packages/matcher/src/implied.ts` for how other implied events are produced.
- **Accept when:** Port-Mage and Watcher each gain a repeating link from Inalla, and drop out of the Overview's "Cards doing the least here" for Inalla.

---

## P2: wrong tags or repeatability that make the page contradict itself

### 5. "Counts your Clerics" is really the party
- **Deck:** Party Time precon. The precon seat flagged it in every round, and it's the deck's biggest group.
- **Emitted:** `Rumor Gatherer -> Thwart the Grave | scales:cleric |` "While you control Rumor Gatherer, Thwart the Grave counts it and costs less". Rumor Gatherer is an Elf **Wizard**. Zulaport Cutthroat (a Rogue) is also in `scales:cleric`.
- **Oracle:** Thwart the Grave reads "costs {1} less … for each creature in your **party**. (Your party consists of up to one each of Cleric, Rogue, Warrior, and Wizard.)" Its recursion is "Cleric, Rogue, Warrior, or Wizard", and Malakir Blood-Priest and Burakos are party-counters too.
- **Needed:** a `scales:party` (or `party`) subject that the tagger derives from the party reminder text, instead of collapsing it to the first type named. The recursion counterpart gets `recursion-target:party` too.
  - The client names groups from the tag (`groupName` in `packages/web/client/src/lib/engine-model.ts`). Adding a `party` case there is a one-liner once the tag exists.
- **Accept when:** Party Time's top group reads as the party, with Rogues, Warriors and Wizards counted.

### 6. One-shot effects tagged "every time"
- **"Enters thanks to X" always says `triggered`:**
  - `Farseek -> Hedge Maze | enters:land | triggered |` "When Hedge Maze enters thanks to Farseek, it surveils". Farseek is a one-shot sorcery.
  - `Misty Rainforest -> Hedge Maze | enters:land | triggered |`. A fetch is used once.
  - Yet the sibling `Farseek -> Lush Portico | enters:any` **is** `oneshot`, so the two paths disagree.
  - When the producer is a one-shot spell or a sacrificed source, the "enters thanks to" edge should be `oneshot`.
  - `packages/matcher/src/edges.ts` sets repeatability in several places (~l.1651 `triggerRepeatability`, ~l.1731, ~l.1762, ~l.1830). `triggerRepeatability` decides only from whether the subject is bare, not from the producer.
- **Saga chapters:** Fenrir's chapter II ("When you **next** cast a creature spell this turn…") is `triggered`, but it is once per Saga.
- **"While you control X" gets both badges:**
  - `Rumor Gatherer -> Thwart the Grave | scales:cleric | triggered` renders EVERY TIME.
  - `Gonti -> Archpriest of Iona` on the same kind of sentence renders ALWAYS ON.
  - A board-count ("counts it") link is a static relationship, so pick one repeatability for `scales:*`.
- **Accept when:** a one-shot spell or fetch never produces a `triggered` link, and `scales:*` has one repeatability.

### 7. Fetch tags name one land type, so "Fetching Islands" lists Blood Crypt
- **Deck:** Inalla (tuner) and Yuna.
- **Emitted:**
  - `Scalding Tarn -> Blood Crypt | ramp-target:island` (Tarn fetches Island **or Mountain**, and Blood Crypt is the Mountain).
  - `Polluted Delta -> Blood Crypt | ramp-target:island` (Delta fetches Island or **Swamp**).
  - `Misty Rainforest -> Island | ramp-target:forest`.
  - `Farseek -> Hedge Maze | ramp-target:plains` (Hedge Maze is a Forest Island).
- **Cause:** the tag carries the fetcher's first listed type, not the type that actually matched.
- **Needed:** tag with the matched type, e.g. `ramp-target:mountain` for Tarn → Blood Crypt. Or use a type-neutral `ramp-target:land` for multi-type fetchers. The client's "Fetching Islands" label comes straight from the tag.
- **Accept when:** no `ramp-target:<type>` edge points at a land without that type.

### 8. The Earth Crystal doubles "a counter" (it doubles only +1/+1 counters on creatures)
- **Deck:** Yuna.
- **Emitted:**
  - `Summon: Good King Mog XII -> The Earth Crystal | counter-added:creature |` "When … gets a counter, The Earth Crystal puts twice that many counters on something".
  - Also `Ozolith`, `Setessan Champion`, `Yuna`.
- **Oracle:** "If one or more **+1/+1 counters** would be put on a **creature you control**, twice that many…". Mog's own counters are lore counters.
- **Needed:**
  - A counter-kind filter on `counter-added` (only +1/+1 feeds Earth Crystal).
  - A producer filter: the Ozolith is an artifact, not a creature.
  - Sentence wording that names the counter kind.

### 9. Role mis-tags in the "Removal, extra mana and protection" box
- **Weaver of Harmony `stackInteraction`** (Yuna) is listed as a counterspell, but nothing on it counters. It is probably from "copy target … ability" being read as stack interaction.
- **Archaeomancer `targetedRemoval`** (Inalla) is wrong: it returns an instant or sorcery. It may be inheriting from what it returns.
- **Saw in Half `targetedRemoval`**: borderline. Its target is usually your own creature, for value. Worth a look.
- **Grim Hireling** (Party Time) is under both Extra mana and Removal. Check that it's intended.
- Roles come from `packages/matcher/src/build.ts` (role list ~l.13–26); the classifier is upstream of that.

---

## P3: unread effects and odd lines

### 10. "Effect not read yet" on the deck's key links
- **Inalla:** `Harmonic Prodigy -> Inalla | doubles:shaman | static |` "Harmonic Prodigy doubles Inalla, Archmage Ritualist's triggers". It's in a top pair and in a group example, and every seat asked what "effect not read yet" means. The client marks any sentence ending in "triggers" as unread (`unreadEffect` in `card-drawer.tsx`). The fix is for the doubler sentence to name the doubled effect ("…so Inalla makes two tokens"), or for the sentence to stop ending in "triggers" when the effect is known.
- **Also:** `Toxic Deluge -> Watcher for Tomorrow | leaves:creature |` "…it triggers", and Party Time's `Archpriest of Iona -> Bygone Bishop` ("…Bygone Bishop triggers"). The latter sits in a "best pair".

### 11. Multiclass Baldric links to one card
- **Deck:** Party Time.
- **Oracle:** "Equipped creature has lifelink if you control a Cleric, deathtouch if … a Rogue, haste if … a Warrior, and flying if … a Wizard. As long as you have a full party…"
- **Emitted:** a single one-shot link. It should count the party the way item 5 does.

### 12. Token copies "enter thanks to Inalla" against Inalla's "nontoken Wizard"
- **Inalla, phone seat:** "When a Wizard (token from Transpose) enters thanks to Inalla, Archmage Ritualist, Kindred Discovery draws you 1 card".
- **Oracle:** Inalla triggers on "another **nontoken** Wizard". The line may mean Inalla's copy token entering. If so, the token-maker attribution "(token from Transpose)" is wrong and should be Inalla.
- **Check:** which producer the token node is attributed to, and whether `Transpose` really makes Wizard tokens.

---

## Found in round 9 (after #488–#497 landed)

### 13. Flicker and reanimation are not linked to "Wizards entering" (Inalla)
- **Emitted:** in `calibration/inalla`, Ghostly Flicker, Essence Flux, Reanimate and Waterbender's Restoration are left out of the `enters:wizard` group ("Mostly the same cards as Creatures entering, without Reanimate, Essence Flux, Waterbender's Restoration, Ghostly Flicker…").
- **Oracle:** Inalla triggers on "another nontoken Wizard you control enters". Flickering or reanimating a nontoken Wizard does exactly that, and it is why those spells are in the deck.
- **Effect on the page:** they sit on the cut list, and the tuner overruled it.
- **Accept when:** a flicker or reanimation spell has an `enters:wizard` link to Inalla (and Kindred Discovery) wherever the deck has Wizards it can return.

### 14. Summoner's Grimoire's granted trigger is unlinked (Yuna)
- **Oracle:** "Equipped creature … has 'Whenever this creature attacks, you may put a creature card from your hand onto the battlefield. If that card is an enchantment card, it enters tapped and attacking.'"
- **Emitted:** its only real partner is Summon: Good King Mog XII, so it reads "keeps working with only 1 other card". The Summons (enchantment creatures) should be its partners.

### 15. "While you control X, Y counts it" tagged ONCE (Party Time)
- **Emitted:** `Rumor Gatherer -> Thwart the Grave | scales:party | oneshot` renders "ONCE — While you control Rumor Gatherer, Thwart the Grave counts it and costs less".
- The tag is plausible, since Thwart is a spell counted as it is cast, but the sentence still says "While you control". For a spell, the sentence should read as a count at cast ("When you cast Thwart the Grave, it counts Rumor Gatherer").

### 16. Smaller ones
- **Reanimate under "Bringing back instants"** and "Searching for instants": it is a sorcery. The group is named from the tag, so the tag probably says `instant` for an instant-or-sorcery subject.
- **A Treasure under "Creatures dying"** (Party Time): "When a Treasure dies thanks to Grim Hireling, Zulaport Cutthroat…". Zulaport cares about creatures.
- **Still open from above:** 2b/c (Fenrir's chapter II "EVERY TIME"), 4 (Inalla's exile), 8 (The Earth Crystal), 11 (Multiclass Baldric).

## Housekeeping
- **The skeptic seat's calibration claim has decayed.**
  - `.claude/agents/README.md` seeds the Yuna deck with `Misty Rainforest -> Yuna, Grand Summoner | dies:permanent`, judged FALSE.
  - That edge is **no longer in the report**: the engine no longer emits it.
  - The skeptic circled item 1 (Weaver) instead, which is real, but the seat needs a new seeded FALSE claim. Item 1 or item 2 would serve, until fixed.
  - The README says to re-run the cross-reference each round.
- **The wire graph drops `repeatability` and `enabledBy`** (known from the graph evaluation), so dashed game-state edges never reach the board. The Overview reads `report.edges` directly, so it isn't affected. The Whole-deck board is.
