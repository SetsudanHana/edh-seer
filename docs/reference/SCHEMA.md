# Schema reference

<!-- GENERATED FILE -- do not edit by hand.
     Source: packages/tagger/src/bin/gen-schema-docs.ts
     Regenerate: npx tsx packages/tagger/src/bin/gen-schema-docs.ts
     A test compares this file against the generator's output, so an edit here fails the build. -->

Every list, constant and field on this page is read out of the source that defines it. The prose
pages under [`docs/pipeline/`](../pipeline/) explain what the stages do; this one says exactly what
they may say.

Each entry carries the **first paragraph** of its doc comment. The full argument — the witness card,
the measurement, the defect that put the field there — stays in the source, which is linked.

---

## Version constants

What each one costs to bump is the single most expensive thing to get wrong in this repo:
one of these re-buys the corpus and the rest are free.

| constant | value | what it is |
|---|---|---|
| `NORMALIZE_VERSION` | **24** | Bump when ANYTHING that determines the request changes: SYSTEM, VERBS, TRIGGERS, ZONES — and `segment.ts`, because the segmenter decides which clauses exist and what ids they carry. |
| `NORMALIZE_MIN_COMPATIBLE` | **3** | The oldest prompt whose answers are still valid. `needsNormalize` re-queues a card only when its stored version is BELOW this, so a mixed-version corpus is a stated condition rather than an accident. |
| `VOCAB_VERSION` | **24** | The NORMALIZE_VERSION at which the closed VOCABULARIES (VERBS, TRIGGERS, ZONES) last changed. **Bump this ONLY when one of those lists changes** — never for a prose rule. |
| `TRIGGER_VOCAB_VERSION` | **24** | The NORMALIZE_VERSION at which **TRIGGERS** last changed, tracked apart from VOCAB_VERSION. |
| `DERIVE_VERSION` | **393** | Bump when derivation semantics change — a new effect kind, a changed emit, a new guard. Unlike NORMALIZE_VERSION this is FREE to bump: it only re-runs `derive-corpus`, which reads the stored clauses and calls no model. That asymmetry is the whole point of storing clauses separately. |

See [`docs/RUNBOOK.md`](../RUNBOOK.md) for the procedure behind each bump.

---

## The normalization vocabulary

These are the words the model is allowed to answer with. An answer using anything else is **refused
and not persisted** — the card re-queues rather than banking a guess. They are sized against what the
game can express (the Comprehensive Rules), not against what the current decks happen to play,
because normalization is a one-way ratchet: nobody re-runs 36,000 cards to add a word.

### VERBS — 103 members

The action a clause performs. Defined in [`VERBS`](../../packages/tagger/src/normalize-prompt.ts).

`destroy`, `exile`, `sacrifice`, `tap`, `untap`, `draw`, `discard`, `mill`, `search`, `put`, `return`, `create`, `counter-spell`, `copy`, `gain-life`, `lose-life`, `deal-damage`, `add-mana`, `add-counter`, `remove-counter`, `grant-ability`, `modify-pt`, `prevent`, `cast`, `play`, `shuffle`, `reveal`, `attach`, `transform`, `trigger-again`, `extra-turn`, `extra-combat`, `animate`, `cant`, `emblem`, `fight`, `set-life`, `proliferate`, `scry`, `surveil`, `cost-modify`, `amass`, `turn-face-up`, `extra-phase`, `connive`, `recruit`, `bolster`, `support`, `adapt`, `monstrosity`, `blight`, `investigate`, `populate`, `incubate`, `manifest`, `discover`, `meld`, `cloak`, `manifest-dread`, `earthbend`, `goad`, `regenerate`, `exert`, `detain`, `suspect`, `harness`, `vote`, `clash`, `fateseal`, `behold`, `heal`, `exchange`, `convert`, `double`, `triple`, `explore`, `endure`, `learn`, `forage`, `time-travel`, `collect-evidence`, `venture-into-the-dungeon`, `face-a-villainous-choice`, `waterbend`, `airbend`, `ring-tempts`, `roll-dice`, `flip-coin`, `initiative`, `city-blessing`, `gain-control`, `phase-out`, `monarch`, `phase-in`, `foretell`, `win-game`, `lose-game`, `unattach`, `empower-jace`, `prepare`, `unprepare`, `other`, `none`


### TRIGGERS — 139 members

The event a triggered ability watches for. Defined in [`TRIGGERS`](../../packages/tagger/src/normalize-prompt.ts).

`enters`, `dies`, `leaves`, `attacks`, `blocks`, `taps`, `untaps`, `cast`, `upkeep`, `begin-combat`, `end-step`, `draw`, `draw-step`, `main-phase`, `combat-damage-step`, `damage-dealt`, `life-gained`, `life-lost`, `counter-added`, `sacrificed`, `discarded`, `milled`, `turned-face-up`, `level-up`, `chapter`, `proliferate`, `search`, `becomes-target`, `scry`, `surveil`, `unlocked`, `transform`, `copy`, `crime`, `expend`, `descended`, `day-night`, `dice-rolled`, `dungeon-completed`, `monarch`, `ring-tempts`, `clash`, `untap-step`, `declare-attackers`, `declare-blockers`, `end-of-combat`, `cleanup`, `initiative`, `city-blessing`, `activate`, `connive`, `discover`, `explore`, `vote`, `manifest-dread`, `exiled`, `phases-out`, `create`, `reveal`, `recruit`, `bolster`, `support`, `adapt`, `monstrosity`, `blight`, `investigate`, `populate`, `incubate`, `manifest`, `meld`, `cloak`, `earthbend`, `goad`, `regenerate`, `exert`, `detain`, `suspect`, `harness`, `fateseal`, `behold`, `heal`, `exchange`, `convert`, `double`, `triple`, `endure`, `learn`, `forage`, `time-travel`, `collect-evidence`, `venture-into-the-dungeon`, `face-a-villainous-choice`, `waterbend`, `airbend`, `roll-dice`, `flip-coin`, `put-into-graveyard`, `becomes-crewed`, `loses-control`, `phases-in`, `tapped-for-mana`, `becomes-blocked`, `cycled`, `mutates`, `becomes-monstrous`, `play`, `fight`, `amass`, `exploit`, `shuffled`, `attached`, `prevented`, `gains-control`, `countered`, `firebend`, `reflexive`, `state`, `counter-removed`, `mana-spent`, `damaged`, `loses-game`, `unattached`, `returned-to-hand`, `put-into-library`, `becomes-renowned`, `becomes-saddled`, `plotted`, `foretell`, `give-gift`, `mentors`, `solved`, `resolves`, `evolve`, `empower-jace`, `prepared`, `unprepared`, `face-a-dilemma`, `other`, `none`


### ZONES — 7 members

Where an action moves something from or to. Defined in [`ZONES`](../../packages/tagger/src/normalize-prompt.ts).

`battlefield`, `graveyard`, `hand`, `library`, `exile`, `stack`, `command`



---

## The engine vocabulary

Derivation maps the model's words onto these. The two lists are **not** the same and are not meant to
be: the clause vocabulary describes what a sentence says, the engine vocabulary describes what the
matcher can join on.

### VERB_VOCAB — 76 members

The events a card can supply or watch for. Defined in [`VERB_VOCAB`](../../packages/tagger/src/schema.ts).

`enters`, `enters-graveyard`, `dies`, `leaves`, `cast`, `attacks`, `taps`, `non-combat-damage`, `combat-damage`, `damaged`, `exiled`, `draw`, `discard`, `mill`, `gain-life`, `lose-life`, `sacrifice`, `create-token`, `counter-added`, `land-play`, `untaps`, `proliferate`, `unlock`, `upkeep`, `begin-combat`, `end-step`, `dice-rolled`, `scry`, `surveil`, `search`, `counter-spell`, `counter-removed`, `loses-game`, `shuffle`, `transform`, `turned-face-up`, `copy`, `reveal`, `attached`, `unattached`, `gains-control`, `phases-out`, `regenerate`, `prevented`, `exchange`, `double`, `triple`, `goad`, `exert`, `detain`, `suspect`, `harness`, `vote`, `clash`, `fateseal`, `behold`, `heal`, `convert`, `explore`, `endure`, `learn`, `forage`, `time-travel`, `collect-evidence`, `venture-into-the-dungeon`, `face-a-villainous-choice`, `airbend`, `waterbend`, `foretell`, `flip-coin`, `monarch`, `initiative`, `city-blessing`, `ring-tempts`, `prepared`, `face-a-dilemma`


### EFFECT_KINDS — 51 members

What an ability DOES, once its trigger is satisfied. Defined in [`EFFECT_KINDS`](../../packages/tagger/src/schema.ts).

`token-generation`, `damage`, `player-life-loss`, `lifegain`, `drain`, `draw-card`, `forced-sacrifice`, `pump`, `ability-loss`, `cost-reduction`, `trigger-doubling`, `graveyard-recursion`, `clone`, `token-doubling`, `damage-multiplier`, `tax`, `scry`, `surveil`, `mill`, `search`, `top-set`, `counter-placement`, `enters-with-counters`, `mana-generation`, `fast-mana`, `ritual`, `copy-spell`, `copy-ability`, `speed-increase`, `speed`, `flicker`, `animate`, `untap`, `proliferate`, `graveyard-hate`, `exile-processing`, `extra-combat`, `keyword-grant`, `type-grant`, `win-game`, `extra-turn`, `extra-phase`, `emblem`, `bounce`, `play-from-top`, `extra-loyalty`, `retarget`, `evasion`, `restriction`, `to-hand`

| member | why it exists |
|---|---|
| `debuff` | A NEGATIVE power/toughness modifier. Shaped like `pump` and meaning the opposite: Massacre Wurm, Toxic Deluge and Doomwake Giant are removal, not anthems, and reading them as anthems put a false claim on every creature in the deck. Measured 2026-08-20: **30 of 301 derived pump abilities (10%) carry a negative amount**, 186 corpus cards print "get -N/-N". Its own kind rather than a matcher-side gate because five readers consult this field — `mechanisms.ts` uses `pump` for four archetypes and `wincon.ts` for the go-wide finisher — and every one of them was wrong about these cards. |

### SCALING_BASES — 9 members

What an amount scales with, when it is not a number. Defined in [`SCALING_BASES`](../../packages/tagger/src/schema.ts).

`fixed`, `per-creature`, `per-permanent`, `per-graveyard`, `per-cast-or-spell`, `x-cost`, `per-opponent`, `per-life-lost`, `unbounded`



### Aliases

Answers that mean an existing member are folded onto it rather than refused.

| map | folds |
|---|---|
| [`VERB_ALIASES`](../../packages/tagger/src/schema.ts) | `enters-the-battlefield`→`enters`, `add-counter`→`counter-added`, `counter-add`→`counter-added`, `beginning-of-upkeep`→`upkeep`, `your-upkeep`→`upkeep`, `upkeep-step`→`upkeep`, `beginning-of-combat`→`begin-combat`, `combat-begins`→`begin-combat`, `beginning-of-end-step`→`end-step`, `end-of-turn`→`end-step`, `play-land`→`land-play`, `create-tokens`→`create-token` |
| [`EFFECT_ALIASES`](../../packages/tagger/src/schema.ts) | `counter-added`→`counter-placement`, `counter-placed`→`counter-placement`, `player-damage`→`damage`, `noncombat-damage`→`damage`, `non-combat-damage`→`damage`, `life-loss`→`player-life-loss`, `exile-and-return`→`flicker` |
| [`SCALING_ALIASES`](../../packages/tagger/src/schema.ts) | `for-each-creature`→`per-creature`, `per-creature-you-control`→`per-creature`, `for-each-permanent`→`per-permanent`, `for-each-artifact`→`per-permanent`, `per-graveyard-creature`→`per-graveyard`, `per-spell`→`per-cast-or-spell`, `for-each-opponent`→`per-opponent`, `per-player`→`per-opponent` |

---

## Types

### SubjectFilter

Defined in [`SubjectFilter`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `ref` | `"trigger" \| "sentence"` | optional | THE OBJECT IS THE ONE THE TRIGGER IS ABOUT, not another of its class (#896 task 4, #823): Mari, the Killing Quill's "whenever a creature an opponent controls dies, exile IT". The other fields still say its class; this says it is that same object, so a sentence reads "exiles it". |
| `type` | `string \| string[]` | optional | A card type, or an array of types meaning OR (e.g. ["instant","sorcery"]). |
| `notType` | `string[]` | optional | Card types the text NEGATED ("noncreature spell", "nonland permanent"), as the card says it. |
| `notSubtype` | `string[]` | optional | SUBTYPES the text negated — "target **non-Dragon** creature card", "each non-Zombie creature". |
| `notCast` | `true` | optional | THE OBJECT ARRIVED WITHOUT BEING CAST OR PLAYED — a blink, a token, a reanimation. |
| `entersTapped` | `true` | optional | THE OBJECT ARRIVED TAPPED. Two cards demand it — Amulet of Vigor and Tiller Engine — and both read "whenever a permanent you control ENTERS TAPPED". Set on both sides from the same printed cue `ARRIVES_TAPPED` already uses to suppress a phantom `taps` event. |
| `restricted` | `true` | optional | THE SUBJECT IS NARROWED BY A TARGETING RESTRICTION, AND NOTHING HERE MODELS TARGETING. "an instant or sorcery spell THAT TARGETS ONLY A SINGLE CREATURE YOU CONTROL" (Leyline of Resonance), "a spell THAT TARGETS ONLY A SINGLE ARTIFACT OR CREATURE YOU CONTROL" (Vesuvan Duplimancy). A demand only the consumer side can carry, and `eventMatches` refuses it — the `replacement.restricted` rule one layer over: keep the ability and its kind, claim no cards. |
| `transformed` | `true` | optional | THE CARD COMES BACK AS ITS BACK FACE: "exile Jill, then return it to the battlefield TRANSFORMED" (CR 712.14a). A double-faced card put onto the battlefield is otherwise front face up (CR 712.14), so a self re-entry says which face enters and the matcher -- the one layer that holds each face's type line -- types it with that face (#715). Set on a self `enters` emit only. |
| `umbrella` | `string` | optional | The umbrella noun a multi-umbrella `type` list was resolved FROM — "permanent" for "permanent spell". |
| `allTypes` | `string[]` | optional | Card types the subject demands ALL of — a compound noun, "artifact creature". |
| `subtype` | `string \| string[]` | optional | A subtype, or an array meaning OR (e.g. ["faerie","wizard"]). |
| `colors` | `string[]` | optional |  |
| `self` | `true` | optional | The subject IS the card whose ability this is ("when THIS creature enters", or the card named by its own name). Set by derivation from the clause text, which is the only layer that can see it: parseSubject reduces "this creature" and "another creature you control" to the same {type: creature}, so without this the matcher cannot tell a self-ETB from a real payoff -- the defect behind 74% of the false edges in the 2026-08-05 precision measurement. |
| `other` | `true` | optional | THE SUBJECT IS EXPLICITLY NOT THE CARD ITSELF: "another creature", "two other creatures". The opposite fact to `self`, and a prose fact more than a matching one: `subjectMatches` never reads it (the producer is never the consumer), but the sentence does -- Priest of Forgotten Gods' "Sacrifice two other creatures" printed as "When Priest of Forgotten Gods dies" because a creature producer could otherwise BE the creature its emit names. Set by `parseSubject` (2026-09-09, recall v4 sacrifice family). |
| `control` | `Control` | **required** |  |
| `owner` | `"you" \| "opp"` | optional | WHO OWNS IT, when the text says so and it differs from who controls it (CR 110.2): Zedruu's "permanents you OWN that your opponents CONTROL" (#681). Absent means the text named no owner, which is every other subject. |
| `edict` | `true` | optional | AN EDICT: THE OBJECT IS CHOSEN AND GIVEN UP BY A PLAYER THE ABILITY TARGETS (#1295). "Target player sacrifices a creature of their choice" (Diabolic Edict) targets the PLAYER, not the creature, so `scope: "target"` would be a lie -- a reader asking what this ability aims at would find a creature it never targets, and `scope` is what the `targets` and hexproof readers key on. This marks the one fact the role needs and nothing else could carry: that the sacrifice is FORCED ON a targeted player, which separates it from "each player sacrifices" (a sweep), an upkeep self-sacrifice and "sacrifice unless they pay". Set by derive on the `sacrifice` and `dies` emits of a sacrifice whose actor phrase is "target player" or "target opponent". `control` still says whose creature it is (opp for "target opponent", any for "target player"). Never set by the LLM. |
| `token` | `boolean \| null` | **required** | false = nontoken only, true = token only, null = any. |
| `chosenType` | `boolean` | optional | Marks "the chosen type" (Kindred Discovery); resolved deck-aware in Stage 2. |
| `sharesTypeWith` | `"self" \| "commander"` | optional | "A spell that SHARES A CREATURE TYPE WITH this creature" (issue #559). `self`: the card's own creature types, pinned to `subtype` by `deriveCardTags` and never stored. `commander`: the ability is granted to commander creatures (Folk Hero), so the class is the COMMANDER'S types -- a deck fact, resolved by the matcher's `resolveSharedTypes`. Unresolved, it matches nothing. |
| `notCommander` | `true` | optional | Not a designated commander: the resolved shared-type class above excludes the commander's own spell, since the ability sits on the commander on the battlefield (#559). |
| `historic` | `true` | optional | "Historic" — artifact, legendary, or Saga. A printed fact, not a judgment, and the only way the engine can hear Jhoira, Basim Ibn Ishaq, Glóin, Rona and The Sixth Doctor narrow their cast trigger. Without it their subject is the bare umbrella `spell` and every card in the deck satisfies it. Set on a CONSUMER by `parseSubject`, and on a PRODUCER by the matcher, which reads it off the printed type line. |
| `outlaw` | `true` | optional | The subject demands an OUTLAW — CR 700.12, an object with the Assassin, Mercenary, Pirate, Rogue and/or Warlock creature type. A printed fact read off the type line, exactly like `historic`, and set on BOTH sides for the reason 09ce98d records: a consumer demand a producer cannot state is a demand nothing satisfies. |
| `prepared` | `true` | optional | CR 722.3d: a spell cast as a PREPARE SPELL -- the copy a prepared permanent lets you cast. Codie, Ravenous Codex watches "whenever you cast a prepared spell"; its only producer is a card's own implied prepare ability (matcher implied.ts). Asymmetric like `commander`: a consumer that does not ask is unaffected. |
| `modified` | `true` | optional | The subject demands a MODIFIED permanent — CR 700.9: it has a counter on it, is equipped, or is enchanted by an Aura its controller controls. |
| `combat` | `"attacking" \| "blocking" \| "in-combat"` | optional | The subject demands a COMBAT STATE — an attacking or a blocking creature. A board state like `modified`, so it is set on a CONSUMER by `parseSubject` ("whenever an attacking creature dies", Kardur, Doomscourge) and on a PRODUCER only where the printed text names it ("exile all attacking creatures", Settle the Wreckage). Without it Kardur derived a bare `dies:creature` and Blasphemous Edict at sorcery speed fed it (owner, 2026-09-05). |
| `tapped` | `boolean` | optional | A STATUS, CR 110.5: true is "target TAPPED creature", false "an UNTAPPED creature you control". A board state like `combat` and `modified`, so only a producer whose printed text states it satisfies a demand. 145 corpus phrases, about 320 card uses. Set by the filter grammar (#896). |
| `notColors` | `string[]` | optional | COLOURS THE TEXT NEGATED: "target nonblack creature", "a nonwhite, nonblue creature". A producer that has none of them satisfies it; one that records no colours abstains, as `notKeyword` does. Set by the filter grammar (#896). |
| `colorCount` | `"multi" \| "mono" \| "all" \| "exactly-two" \| "colored"` | optional | "a MULTICOLORED spell" (two or more colours, CR 105.2b), "a MONOCOLORED creature" (exactly one, CR 105.2a). Counted over the five colours, so colourless is neither. Also `all` ("that's all colors"), `exactly-two`, and `colored` ("one or more colors"). Set by the filter grammar (#896). |
| `allColors` | `string[]` | optional | EVERY colour listed, not any: "a spell that's both black and green". `colors` is an OR-list. |
| `snow` | `boolean` | optional | The SNOW supertype, CR 205.4g: "target snow land". Shaped like `legendary`; `false` is "nonsnow". Set by the filter grammar (#896). |
| `withoutDying` | `true` | optional | A `leaves` demand that REFUSES a death. "Whenever one or more other creatures you control leave the battlefield without dying" (Dour Port-Mage) and Taeko's "if it didn't die" are `leaves` minus `dies` (CR 700.4). Demand only -- read by `eventMatches`, never stamped on a producer, so a consumer that does not ask is unaffected. 5 corpus cards. |
| `legendary` | `boolean` | optional | The subject demands the LEGENDARY supertype. "Legendary creatures you control get +2/+2" (Serah Farron) and Jodah's +X/+X derived a subject of EVERY creature without it, which were the two widest meshes in the derived population at x53 and x51. Shaped exactly like `historic`: matched against the card's printed characteristics, which already carry supertypes. |
| `basic` | `boolean` | optional | The subject demands the BASIC supertype. "Search your library for a basic land card" emitted `{type: land}` and nothing else, so at the authored-emit identity check — the one place an emit sits on the FILTER side — every NONBASIC land satisfied it, which was about half the false edges the 2026-08-13 board fixtures showed on self-ETB lands. 65 actions across 50 corpus docs. Same shape as `legendary`, and set on BOTH sides for the reason 09ce98d records. |
| `keyword` | `string[]` | optional | Printed KEYWORD ABILITIES the subject demands, ALL of them — "creatures you control with flying", "a creature with defender", "spells with flash you cast". |
| `notKeyword` | `string[]` | optional | Keyword abilities the subject demands the card does NOT have — "a creature you control without flying". The `notType` shape, for keywords: `keyword` says what must be there, this says what must not, and a subject can carry both. |
| `commander` | `true` | optional | The subject demands a COMMANDER — "a commander you control", "your commander". |
| `anyOf` | `Partial<SubjectFilter>[]` | optional | A real DISJUNCTION: the subject is satisfied by ANY of these branches. |
| `uniqueName` | `true` | optional | "IT DOESN'T HAVE THE SAME NAME as another creature you control or a creature card in your graveyard" (Guardian Project): a name the deck holds ONCE. In a Commander deck every nontoken card but basics and the `multiples` family is singleton (CR 903.5b; owner, 2026-10-01), so the condition holds for those and fails for a token (generic tokens repeat) or a `multiples` card. |
| `multiples` | `true` | optional | On a PRODUCER: the card is one a deck may hold several of (`Characteristics.anyNumber`). |
| `named` | `string` | optional |  |
| `abilityKind` | `AbilityObjectKind[]` | optional | AN ABILITY AS AN OBJECT (roadmap AC12, owner's note 2026-09-08: "hard time recognizing trigger vs activated abilities, and cards like Gogo that can copy those"). CR 113.3 names the kinds; CR 707.10 lets a spell or ability be copied; 316 commander-legal cards name an activated, triggered, loyalty or mana ability as the THING they act on -- copy it (Gogo, Strionic Resonator, Rings of Brighthearth), counter it (Stifle), trigger on activating one (Harsh Mentor). Set by `parseSubject` when the object names one; the matcher answers it from the other card's own `abilities[].kind`. "activated" here means a NON-mana activated ability, as the cards mean it (mana abilities do not use the stack, CR 605.3b, and cannot be targeted); `mana` and `loyalty` are named only when the card names them. |
| `counter` | `string` | optional | Counter kind for `counter-added` events, e.g. "+1/+1", "-1/-1", "loyalty". |
| `hasCounter` | `boolean` | optional | "a creature you control with A COUNTER on it": some counter, of no stated kind. A producer that names a kind, or states this, satisfies it. `false` is "with no counters on it": a producer that states a counter fails. Set by the filter grammar (#896). |
| `status` | `string[]` | optional | A STATUS OR DESIGNATION the object has (CR 110.5; goad CR 701.15, suspect CR 701.60, kicker CR 702.33 ...): "a face-down creature you control", "an enchanted creature", "a goaded creature", "a kicked spell", "target blocked creature". ALL must hold. Closed vocabulary (`STATUSES` in the filter grammar). Like `modified`, only a producer whose printed text states one supplies it. Set by the filter grammar (#896). |
| `notStatus` | `string[]` | optional | A status the text NEGATES: "target nonattacking creature" (`attacking`), "nonblocking". |
| `player` | `true` | optional | THE SUBJECT IS A PLAYER. Only inside an `anyOf` branch, where a phrase names a player beside an object ("target player or planeswalker", "you or a permanent you control"): a bare player phrase keeps its old control-only shape. A producer with no type and no subtype is player-shaped and meets it. Set by the filter grammar (#896). |
| `abilityOf` | `Partial<SubjectFilter>` | optional | WHOSE ABILITY: "a loyalty ability of a Chandra planeswalker", "target activated ability from an artifact source". CEILING: no producer states the source of an ability it activates, so `eventMatches` refuses a consumer carrying it. Set by the filter grammar (#896). |
| `shares` | `{ what: "creature-type" \| "color" \| "card-type" \| "name" \| "mana-value" \| "type" \| "controller" \| "power" \| "toughness" \| "total-power-toughness"; with: "self" \| "ref" \| Partial<SubjectFilter>; negated?: true }` | optional | A CHARACTERISTIC SHARED WITH ANOTHER OBJECT: "a spell that shares a creature type with this creature", "a creature that doesn't share a color with ...". `with` is "self", "ref" (an object named elsewhere in the sentence) or a filter. CEILING: `eventMatches` refuses a consumer carrying it. Set by the filter grammar (#896). |
| `history` | `string[]` | optional | WHAT HAPPENED TO IT THIS TURN: "a creature that was dealt damage this turn", "all creatures that attacked this turn", "a creature card put into your graveyard from the battlefield this turn". Closed vocabulary. CEILING: `eventMatches` refuses a consumer carrying it. Set by the filter grammar (#896). |
| `nameRelation` | `"chosen" \| "same" \| "different"` | optional | A NAME RELATION instead of a printed name: "with the chosen name" (`chosen`), "with the same name as ..." (`same`), "with different names" (`different`). CEILING: refused by `eventMatches`. Set by the filter grammar (#896). |
| `notNamed` | `string` | optional | A NAME THE SUBJECT DOES NOT HAVE: "target permanent not named ~". Lowercased, "~" for the card. |
| `notFromZone` | `string` | optional | AN ORIGIN THE SUBJECT DID NOT COME FROM: "a spell from anywhere other than your hand". A producer that states no origin was cast from hand (a card's own cast), so it fails a `hand` exclusion. Set by the filter grammar (#896). |
| `combatWith` | `{ role: "blocking" \| "blocked-by" \| "blocking-or-blocked-by" \| "attacking"; with: "self" \| "ref" \| "you" \| Partial<SubjectFilter> }` | optional | A COMBAT RELATION to another object: "a creature blocking this creature" (`blocking`, self), "target creature blocking or blocked by ~", "target creature that's attacking you". CEILING: refused by the matcher, as the other relations no producer states. Set by the filter grammar. |
| `except` | `Partial<SubjectFilter>[]` | optional | EXCLUSIONS: "all creatures except for Merfolk, Krakens ...", "each creature except for tokens you control". A producer matching any of them fails. Set by the filter grammar (#896). |
| `targets` | `Partial<SubjectFilter>` | optional | WHAT A SPELL TARGETS, CR 115.1 (#896, owner 2026-10-01): "a spell that targets this creature" is `{ type: spell, targets: { self: true, type: creature } }`, the heroic / "becomes the target of a spell" condition. Checked against the producer's `GameEvent.targeting` since #713: an instant or sorcery's cast states the creatures it is aimed at for its caster. Set by the filter grammar. |
| `condition` | `PlayerCondition` | optional | A CONDITION ON A PLAYER, or on an object's CONTROLLER (`of: "controller"`), that no producer states (#896): "each opponent who doesn't control an Elf" (`controls`, negated), "each player with exactly 13 life" (`count`), "each opponent who doesn't sacrifice a permanent" (`did`, the effect's own punisher choice), "creatures controlled by players who chose peace" (`chose`), "each player whose coin comes up tails" (`coin`). CEILING: refused by the matcher, as the other relations -- a demand nothing can check claims no cards. Set by the filter grammar. |
| `printedIn` | `string` | optional | THE SET A NAME WAS FIRST PRINTED IN: "a permanent with a name originally printed in the Arabian Nights expansion", lowercased. CEILING: no producer states it; refused by the matcher. Set by the filter grammar (#896). |
| `otherThanRef` | `true` | optional | NOT THE OBJECT THE CARD NAMES: "target creature other than enchanted creature". CEILING: the matcher abstains (the one object excluded is not known here), as it does for a variable rhs. Set by the filter grammar (#896). |
| `notZone` | `"battlefield"` | optional | NOT IN A ZONE: "a card not on the battlefield" (Sanctifier en-Vec, Anafenza). A producer with no `zone` is on the battlefield and fails. Set by the filter grammar (#896). |
| `relation` | `SubjectRelation` | optional | A RELATION OR CAPABILITY one card's text states and no producer does (#896), each read from that card: what a spell would destroy (Equinox), what an Aura could enchant (Bruna), what targets it (Goblin Artisans), a tap ability (Magewright's Stone), mana it could produce (Break the Ice), who protects a battle (Joyful Stormsculptor), how many card types (Rendmaw). CEILING: refused by the matcher, as the other relations -- a demand nothing can check claims no cards. |
| `copyOf` | `Partial<SubjectFilter>` | optional | WHAT A COPY COPIES, beside what it is (#896 task 3). "A token that's a copy of target creature you control, except it has haste" CREATES a creature with haste and COPIES any creature you control: the subject says the first, `copyOf` the second, and the matcher's copy pass reads `copyOf` -- a Baleful Strix has no haste, and Kiki-Jiki still copies it. Set by the filter grammar on copies whose original names a class. |
| `phase` | `string` | optional | Which phase or step an `extra-phase` effect grants, over a closed CR vocabulary: `untap`, `upkeep`, `draw`, `main`, `combat`, `beginning`, `end`. Same shape as `counter` above, and for the same reason: a coarse `extra-phase` conflated units the game itself keeps apart -- an additional BEGINNING phase brings an untap step and is activation supply, while an additional UPKEEP or END step brings none, and only recording which one lets a downstream weighting layer tell them apart. Owner's ruling, 2026-08-14 (threshold-lines spec §4.3). Unset when the card's text names no phase from the closed list -- refused, never defaulted. `combat` is listed for the vocabulary's completeness but never actually appears here: a card whose text names a combat phase derives the separate `extra-combat` kind instead, which carries no `phase` field at all. |
| `zone` | `string` | optional | Zone the subject lives in; omitted means battlefield. E.g. "graveyard", "hand", "exile". |
| `fromZone` | `string` | optional | Zone the subject came FROM, when the text names one: "casts a spell from a graveyard" (River Kelpie), "casts a legendary spell from your hand" (Jodah), "enters from a graveyard". |
| `scope` | `"target" \| "each" \| "all"` | optional | Quantifier the text used for this subject. "target creature" is spot removal, "each creature your opponents control" is a board wipe, and "creatures you control" is an anthem rather than a pump — a distinction `SubjectFilter` could not previously express at all. Optional and additive: no consumer reads it yet (the wipe-vs-spot call still happens in matcher's `build.ts` via BOARD_WIPE_RE against raw oracle text). Derived now because the clause text is in hand, so asking the question later costs a re-derive rather than a re-grind. |
| `stats` | `StatPredicate[]` | optional | Authored numeric conditions; ALL must hold (ANDed with the rest of the subject). |
| `power` | `number` | optional | Concrete stat values the MATCHER attaches to a producer subject (never authored by the LLM). Non-numeric printed stats (*, X, null) are stored as 0. |
| `toughness` | `number` | optional |  |
| `manaValue` | `number` | optional |  |

### StatPredicate

Defined in [`StatPredicate`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `metric` | `StatMetric` | **required** |  |
| `op` | `StatOp` | **required** |  |
| `value` | `number` | optional |  |
| `vs` | `"power" \| "toughness"` | optional |  |
| `variable` | `true` | optional | THE RHS IS NOT A CONSTANT THE TEXT STATES: "mana value X or less", "power less than this creature's power", "mana value less than the result". Set by the filter grammar (#896) in place of `value`. CEILING: the matcher abstains (the predicate holds), which is what dropping the words did before; X is chosen as the spell resolves, and the other rhs need a value from outside the subject. |
| `total` | `true` | optional | A SUM OVER THE CHOSEN OBJECTS, not each one's: "creatures with total power 12 or greater". Set by the filter grammar (#896). CEILING: the matcher abstains, as for `variable` -- no single object carries the sum. ("total ... N or less" bounds each object by N, and is said without it.) |

### GameEvent

Defined in [`GameEvent`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `verb` | `Verb` | **required** |  |
| `subject` | `SubjectFilter` | **required** |  |
| `implied` | `true` | optional | Marks an event `impliedEvents` synthesized (e.g. "any creature can attack"), rather than one the tagger authored from oracle text. Never set by the LLM/extraction pipeline -- matcher-only, written solely by `packages/matcher/src/implied.ts`. Used to scope `combatSelfSupplied` to implied combat only, so authored combat emits (goad, Mage Slayer, Saskia) still form edges. |
| `targeting` | `Partial<SubjectFilter>[]` | optional | WHAT A CAST SPELL CAN BE AIMED AT FOR ITS CASTER (#713; owner 2026-10-03): on a spell's implied cast only, one entry per targeted effect that names a creature YOU control, or that targets any creature to help it (pump, +1/+1 counters, a keyword such as protection, untap). Removal aimed at "target creature" is left out: nobody aims it at their own. Read against a consumer's `SubjectFilter.targets` -- Leyline of Resonance, heroic. Matcher-only, set in `edges.ts`. |
| `milled` | `true` | optional | A graveyard fill that came from a MILL: the card is random, where a discard is chosen (#716). Matcher-only, written by `impliedGraveyardEvents`. Read by the recursion pass: a random fill does not promise a card of a noncreature class (Takenuma -> Emry, owner FALSE 2026-09-28). |
| `origin` | `"library" \| "hand"` | optional | WHERE AN IMPLIED GRAVEYARD FILL CAME FROM when it was not the battlefield: a RANDOM mill takes it off the library, a discard out of the hand. A surveil or a tutor is chosen and carries none. Matcher-only, written by `impliedGraveyardEvents` beside `milled` (which stays, because the noncreature-class gate reads it). Read by the SELF-scoped recursion pass: a card that returns ITSELF is not enabled by a card that might be milled or discarded (owner FALSE 2026-10-16: Tomb Fortress, Tablet of Discovery, The Warring Triad, Prismari Command). |
| `instantSpeed` | `true` | optional | The producer acts at INSTANT SPEED: an activated ability (loyalty and "activate only as a sorcery" excepted), an instant, or a spell with flash. The smallest timing model that holds the owner's ruling (2026-08-22, upheld): Ayara -> Death Tyrant is REAL because a sac outlet can eat an ATTACKING creature in combat, while Blasphemous Edict at sorcery speed cannot. Read by the matcher only where a consumer demands a combat state (`SubjectFilter.combat`). Set on authored emits alone -- an implied event carries no ability to be fast. |
| `victimMay` | `true` | optional | THE PLAYER WHOSE PERMANENT THIS IS MAY DECLINE IT (#1295): "its controller may sacrifice it" (Star Athlete, Livio), "unless that player sacrifices it" (Enchanter's Bane), "unless they sacrifice a nonland permanent" (Thornplate Intimidator). The event happens only if the victim chooses it, in exchange for not taking the alternative, so it is a real event for a payoff to hear and NOT removal: the role's `notVictimMay` refuses it. Set by derive on the emits of an action whose own verb the clause hands to the victim (`victimDeclines`); never set by the LLM. |
| `redirect` | `true` | optional | THIS DAMAGE IS A REDIRECT (#1294): "the next 2 damage that would be dealt to you is dealt to any target instead" (Harm's Way, Glarecaster). The card deals no damage of its own; it hands damage that was coming at you to a target, so the removal role refuses it (`notRedirect`). Set by derive on the `non-combat-damage` emits of an action whose clause says "is dealt to ... instead"; never by the LLM. "Prevent ... then this card deals that much" (Refraction Trap) is not one. |
| `tuck` | `true` | optional | THIS `leaves` IS A TUCK: a permanent put into its owner's library (Condemn, Oust, Teferi, Hero of Dominaria -3). It left the battlefield, so a leaves payoff hears it, but the owner's quality ladder puts it BELOW a bounce (exile > destroy / sacrifice > bounce > tuck), which `quality.ts` `permanenceOf` reads. Set by derive (`actionEmits`); never by the LLM. |
| `dealer` | `SubjectFilter` | optional | WHO DEALT THE DAMAGE — damage verbs only, and only on an AUTHORED emit. |
| `amount` | `string` | optional | HOW MUCH DAMAGE -- a damage producer's `Ability.amount` ("1", "2", "X"), stamped by the matcher on an authored damage emit (`edges.ts` `baseEvents`). Never set by derive. Read only against a consumer's `amountIs`. |
| `amountIs` | `{ op: "eq" \| "gte"; value: number }` | optional | HOW MUCH DAMAGE THE CONSUMER REQUIRES -- its trigger's `amount` ("exactly 1", "5 or more"), carried onto the event the matcher builds from the trigger. A demand only: never on an emit. |

### Effect

Defined in [`Effect`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `kind` | `string` | **required** | Normalized to the closed EFFECT_KINDS set at validation time. |
| `subject` | `SubjectFilter` | optional |  |
| `scaling` | `string` | optional | Normalized to the closed SCALING_BASES set at validation time; absent → "fixed". |
| `scalingSubject` | `SubjectFilter` | optional | WHAT the count counts, when the basis alone cannot say. `per-graveyard` covers Cavalier of Flame's land cards, Glamdring's instants and sorceries and Bonehoard's creatures alike, so an edge drawn off the basis would claim that milling anything feeds all three. Carries the zone and the owner too, so `graveyardFillMatches` can judge it like any other graveyard demand. |
| `intercepted` | `true` | optional | A recursion that takes the card ON THE WAY IN: a replacement exiles what would go to an opponent's graveyard and this card plays it from exile (Dauthi Voidwalker, Valgavoth). The card never reaches the graveyard, so the reason must not say "bring back". Edges are unchanged by it; only the sentence reads it. |
| `tokenMultiplier` | `TokenMultiplier` | optional | HOW A `token-doubling` REPLACEMENT CHANGES THE TOKENS (#1136), read from what follows "instead". The kind alone said "doubles" of Xorn (adds one more), Academy Manufactor (one of each), Divine Visitation (the same count, a different token) and Ojer Taq (triples). Absent on a doubler read off a bare "double"/"triple" verb: the sentence says "makes more tokens" then. |

### Ability

Defined in [`Ability`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `kind` | `AbilityKind` | **required** |  |
| `face` | `number` | optional | WHICH FACE PRINTS THIS ABILITY — absent for the front face and for every single-face card, 1 or more for a back face. From `segment.ts`'s own face counter, recomputed at derive time. |
| `clause` | `number` | optional | WHICH CLAUSE PRINTED THIS ABILITY (roadmap AJ4, spec C2). Stamped beside `face` in the derive loop, which already holds `clause.id`. The card page reads down the card -- each clause carrying the abilities it derived and the events those produce -- and without this the page can only ZIP the two lists positionally, which is wrong on every row of any card whose first clause derives nothing. Samut has 4 clauses and 3 abilities and every zipped row lies. |
| `toZone` | `"hand" \| "battlefield" \| "graveyard" \| "library"` | optional | WHERE THE CARD THIS ABILITY FINDS OR COUNTERS ENDS UP (#1301). On a `search` ability: the zone of the put that follows it in the same clause and names the searched card ("it", "that card", "them", "one", "a card named X", the search's own "a basic land card"): `hand` when the found card goes to hand, `battlefield` when it goes onto the battlefield (Rampant Growth, Farseek, and the opponent's land from Path to Exile / Assassin's Trophy; `effect.subject.control` says whose search it is). On a counter-spell ability: `library` from "put it on top of its owner's library instead" (top or bottom is not recorded). Read from the put whether the put derives an event of its own (`enters`, left untouched) or nothing (then the put is claimed by this field and is not in `CardTags.unclaimed`). ABSENT MEANS "NOT SAID", NOT "NOT A TUTOR": no such put in the clause; a search that exiles its card (Bring to Light); a stored model answer that folds the put into the search action (`search ... toZone hand`, which is unreliable: Bring to Light says `hand` and exiles), unless the grammar reading, which keeps the put, is the one the card derives from; a put from another zone (Distant Memories); and a search whose cards split over two destinations holds the FIRST only (Cultivate: `battlefield`, the other put is claimed with no field; Gifts Ungiven's "the rest" is not read), and so does a conditional alternative, "otherwise" / "instead": Archdruid's Charm and Treasure Chest read `battlefield`, Celestial Reunion `hand`, whichever branch is commoner. So `battlefield` is not by itself "this search is ramp". Nothing reads it yet: quality.ts's tutor and ramp roles, the goldfish search and edges.ts's search producer still treat every search alike. |
| `librarySearch` | `"yours" \| "other"` | optional | WHOSE LIBRARY A PRINTED SEARCH READS (#1266). On a `search` ability that came from a clause action with verb `search` (a printed "search ... library"), and only when a library is among the zones searched: `yours` when you search your own library (Demonic Tutor, Rhystic Tutor, "your library and/or graveyard"), `other` when the library is another player's ("that player's library", Sphinx Ambassador) or another player does the searching (Path to Exile, Scheming Symmetry, Pir's Whim). The tutor role reads `yours` only (owner 2026-10-21): a typed dig is not a tutor. ABSENT MEANS "NOT A PRINTED LIBRARY SEARCH": a `search` ability read off a `put` from the library (Commune with Nature, Hermit Druid; derive's `search` kind also covers typed digs, for edges), a search of a graveyard or hand only, a search of a pile cut from the library (Phyrexian Portal), and every other kind of ability. PER SEARCH ACTION: a multi-zone search ("graveyard, hand, and library") is one action, so every ability that action makes carries the value, and absent means no library among the zones that action searches. |
| `host` | `true` | optional | THE EFFECT APPLIES TO THE PERMANENT THIS CARD IS ATTACHED TO (#1315): an Aura's "enchanted creature / permanent" (CR 303.4, Aura), an Equipment's "equipped creature" (CR 301.5, Equipment). Set only on the effect kinds that are done TO a host -- `pump`, `debuff`, `keyword-grant`, `speed-increase`, `type-grant`, `ability-loss`, `animate`, `evasion`, `restriction` -- and only when the printed recipient IS the host: "enchanted creature gets +2/+0", "As long as enchanted creature is black, it gets +1/+1" (the `it`), and the "Otherwise, it gets -3/-3" half of an either-or Aura (Clutch of Undeath). Not set for another class on the same card (Inner Demon's "all non-Demon creatures get -2/-2", Vampirism's "other creatures you control"), for a class of enchanted creatures (the Magemarks' "creatures you control that are enchanted"), or for a player ("enchanted creature's controller"). A MARKER AND NOT `effect.subject.status: ["enchanted"]` ON PURPOSE: a static ability with a subject emits a `static:<kind>` tag in edges.ts and can form whole-deck edges (see `namesItsTargets` and "A subject is attached ONLY when there is a kind" in derive.ts). No edge code reads this field; `effect.subject` is exactly what it was. It says the buff is a host effect, which is all a voltron reading needs; WHICH hosts an Aura accepts is `characteristics.enchants`. THE MARKER CARRIES NO POLARITY: a grant of defender, or a debuff, is `host` as much as a buff is; a reader that wants a buff filters the kind and the grant (`grants`, the sign of `amount`). ABSENT MEANS "NOT SAID", NOT "NOT A HOST EFFECT". CEILING: a trigger on "this creature or equipped creature" (Razorfield Ripper), a recipient list ("equipped creature and Zombies you control", Wand of Orcus), the inner pump of a quoted grant (Dragon Mantle), a base P/T setter (Aettir and Priwen, Belt of Giant Strength) and "doesn't untap" (Venarian Gold) carry none. |
| `grantedBy` | `number` | optional | THE CLAUSE THAT GRANTS THIS ABILITY (#1315). On an ability derived from a QUOTED ability another clause hands over (Sunbond's "Enchanted creature has 'Whenever you gain life, put that many +1/+1 counters on this creature.'"), the id of the granting clause (`segment()`'s `granted` clause and its `parentId`): the granting clause's own ability is a `keyword-grant` with empty `grants` and says nothing of what is granted, so a reader that must judge the grant (a buff or a curse) follows this to the abilities that say it. Additive and read by no edge code. ABSENT on every ability no clause grants. |
| `restricts` | `("attack" \| "block")[]` | optional | WHICH ACTIONS A `restriction` ABILITY FORBIDS (#1315): `attack`, `block`, or both ("can't attack or block"). Only on an ability of effect kind `restriction`. |
| `chooses` | `true` | optional | A `to-hand` ABILITY'S CARDS REACH THE HAND BY A PICK (#1302): somebody chooses which of at least two looked-at or revealed cards go to your hand -- "look at the top four cards, put one of them into your hand" (Impulse), "put two of them" (Dig Through Time), "you may reveal a historic card from among them and put it into your hand". `amount` says how many. Only `true` is written. ABSENT: the one card a reveal turned up (Dark Confidant, Coiling Oracle, Demonic Consultation), a pile (Fact or Fiction: `amount` is `pile`), everything just singled out (`amount` `all`), and a card chosen at random. The Impulse line (owner ruling 2026-10-02: choosing one of the top N is card selection) is `chooses` with `amount` "1". |
| `toHand` | `string` | optional | THIS `search` ABILITY IS A DIG THAT PUTS CARDS FROM THE TOP OF YOUR LIBRARY INTO YOUR HAND (#1302, owner 2026-10-22): "If it's a Zombie card, you may reveal it and put it into your hand", "reveal a land card from among them and put it into your hand", "reveal cards until you reveal a creature card". A dig restricted to a class stays `search` for the tutor EDGES (a Zombie dig is worth more with Zombies) and is ALSO hand-fill ("Cards to hand"); the value is how many cards reach the hand, in `to-hand`'s `amount` vocabulary ("1", "2", "X", `pile`, `all`). `Ability.amount` is untouched. Absent on every other ability, and on a PRINTED search of your library (Demonic Tutor: `librarySearch`), which stays a tutor. Read by the hand-fill role through `effectKind.toHand`. |
| `named` | `true` | optional | A `to-hand` OR typed-dig ability that REVEALS UNTIL A NAMED CARD (#1302, owner 2026-10-22): "Choose a card name. Reveal cards from the top of your library until you reveal a card with that name. Put that card into your hand" (Demonic Consultation, Divining Witch, Spoils of the Vault). A tutor in effect with no printed search, so the tutor role reads this marker. NOT "put all of them with that name" (Desperate Research, Tamiyo, Wood Sage), which may find nothing and is hand-fill. Only `true` is written. |
| `netZero` | `true` | optional | A `to-hand` OR typed-dig ability that NETS ZERO CARDS (#1302, owner 2026-10-22): it replaces a draw ("If you would draw a card, you may instead ... reveal cards ...": Abundance, Underrealm Lich, Tomorrow) or swaps with the top of the library (Scroll Rack). Card selection, not hand-fill. Only `true` is written. |
| `claimsNothing` | `"refused-trigger" \| "self-loss"` | optional | THIS ABILITY CLAIMS NO CARDS, AND IS STILL AN ABILITY OF ITS KIND (#1264). One stored field for the two classes derive can decide from the card alone; the matcher reads it in one place (`claimsNothing`, `matcher/src/claims.ts`). The ability KEEPS ITS KIND AND ITS SLOT (roles, themes, counts and the ability indices other readers hold are positions), and the matcher forms no pair reason from it. Not stored here: `FACT_KINDS` (a per-channel effect-kind rule) and `ownBoardKill` (it depends on the deck). - `"refused-trigger"`: the #1253 narrowing, below. - `"self-loss"`: the #1252 owner ruling. An ability whose ONLY effect is that its controller loses the game (Phage the Untouchable, the Pacts' upkeep payment) is a drawback nobody builds toward. Its emits still reach a RESCUE consumer (a `loses-game` trigger of `control: "you"`) and no other. Both: `"refused-trigger"` wins. |
| `threshold` | `{ atLeast: number }` | optional | A numeric condition on WHEN the ability is on — The Millennium Calendar's "when there are 1,000 or more time counters", Chrome Steed's "as long as you control three or more artifacts", Urza's Workshop's "activate only if you control three or more artifacts", Gadrak's "can't attack unless you control four or more artifacts". Absent means the ability states no count, which is the overwhelming majority; see `threshold.ts` for the shapes deliberately excluded. |
| `thresholdSubject` | `SubjectFilter` | optional | WHAT `threshold` counts, when it names a class of permanent someone controls -- see the note above and `thresholdSubjectFor`. The matcher joins it against a card's printed characteristics under the board-count gate (`boardCountNarrows`): Sol Ring counts toward Gadrak's four artifacts; a whole-deck type, a basic land type and an opponent's board form nothing. |
| `cost` | `string` | optional | An activated ability's activation cost, verbatim as `segment.ts` split it out of the body — "{X}{X}, {T}", "{T}, Sacrifice a creature". Unparsed on purpose: this records what the card says, and what a cost MEANS for a loop's economy is sub-project B's question. |
| `payment` | `Payment` | optional | `cost`, read (#806, DERIVE 207): mana, {T}/{Q}, loyalty, life, and what is sacrificed, discarded, exiled, tapped or has counters removed, each with a count. A part it cannot read is kept verbatim in `other`, never dropped. See `derive/payment.ts`. |
| `grants` | `string[]` | optional | The CR keyword abilities a `keyword-grant` hands out, lowercased: ["undying"], ["haste", "hexproof"] (#857, DERIVE 213). The effect subject says who gets them. |
| `delayedBy` | `string` | optional | WHAT CREATED THIS DELAYED TRIGGER ("when you next cast ... this turn", CR 603.7): "chapter" (Summon: Fenrir's II), "spell" (Doublecast), or the activation cost that makes it -- Yuna, Grand Summoner's "{T}". Present only on such a trigger (`delayedTriggerRepeats`). It fires once per creation, so the edge reads "once" for a chapter or a spell and "when you pay for it" for an activation, never "every time". Kept apart from `cost`, whose absence means "not an activated ability". |
| `delayedUntil` | `"next-end-step" \| "next-upkeep" \| "source-leaves"` | optional | WHEN THE EFFECT LANDS, if not now (#801): "return that card to the battlefield ... at the beginning of the next end step" (Shirei, Shizo's Caretaker; 148 corpus cards). A TIMING fact, not a repeat count -- Shirei still fires on every death -- which is why it is not `delayedBy`, whose value `edges.ts` reads as the ability's repeatability. It is what stops a loop: a return that lands at end of turn cannot be sacrificed again this turn. Set on the returning ability only. "source-leaves" (#1295 item 3): the exile lasts "until this creature leaves the battlefield" (Constable of the Realm, Mysterious Limousine, Banisher Priest), so the synthesized return waits for the source. It is no immediate blink, which is what `notFlickered` refuses. |
| `returnIf` | `true` | optional | THE RETURN HAPPENS ON ONE BRANCH ONLY (#1295 item 3): the returning sentence opens with an intervening "If ..." ("Exile another target nonland permanent. If you controlled it, return it to the battlefield tapped. Otherwise, its controller creates a 2/2 token": Unyielding Gatekeeper; "If that permanent's mana value was 3 or less, return it": Vindictive Triumph). On the other branch the exile is permanent, so a `flicker` carrying this is not an immediate blink and `notFlickered` does not refuse the card. Not set by "if you do" / "if you don't" or any "... this way", which confirm a cost and pick no branch. |
| `onFlip` | `"win" \| "lose" \| "heads" \| "tails"` | optional | THE ACTION HAPPENS ON ONE SIDE OF A COIN FLIP ONLY (CR 705; #1295 item 5): its sentence opens "If you win the flip, ..." / "If you lose the flip, ..." (`win` / `lose`) or "If it comes up heads / tails, ..." (`heads` / `tails`). Orcish Captain ("If you win the flip, target Orc creature gets +2/+0 ... If you lose the flip, it gets -0/-2") shrinks your OWN Orc half the time, which `removal.targeted` read as a debuff of a target; its `notOnFlip` refuses an ability carrying this. Unset on the flip itself, on a flip with no branch, and on "Otherwise, ..." (Plasma Caster). |
| `oncePerObject` | `true` | optional | THE RETURN MARKS WHAT IT RETURNS so the same object cannot come back through it again (#886): a finality counter (CR 122.1h, Meathook Massacre II), or a keyword counter the trigger excludes (Luminous Broodmoth's flying counter on a creature "without flying"). The ability still fires for every other object, so `repeats` is untouched; a loop reader must not cycle one card on it. |
| `doubles` | `Verb[]` | optional | WHICH TRIGGERS THIS ABILITY DOUBLES. Present only on `trigger-doubling`. |
| `doublesOf` | `SubjectFilter` | optional | WHOSE TRIGGERS THIS ABILITY DOUBLES. Present only on `trigger-doubling`, and only when the printed frame names a CLASS of permanent rather than an event: "a triggered ability of another Elemental you control" (Twinflame Travelers), "of a Shaman or another Wizard" (Harmonic Prodigy), "of a legendary creature you control" (Annie Joins Up), "of a creature you control with power 2 or less" (Delney). This is the axis `doubles` recorded as its ceiling on 2026-08-22 -- WHOSE ability, not WHICH event -- and it reached the recall draw on 2026-09-10 (v5 #196, Cavalier of Thorns -> Twinflame Travelers). Eight corpus cards. |
| `temporary` | `true` | optional | THE TOKEN THIS ABILITY CREATES LEAVES AT THE NEXT END STEP. Present only on `token-generation`. |
| `amount` | `string` | optional | The amount stated by the action that produced this ability, verbatim from the clause — "2", "X", "1,000". |
| `count` | `EventCount` | optional | The events one use supplies, parsed from `amount` and the emit (edge magnitude, DERIVE 199). |
| `reduces` | `{ mana: string; self?: true }` | optional | A cost reduction's printed mana off ("{2}", "{X}", "{U}") and whether it discounts only its own card ("this spell costs ... less"). See `derive/reduction.ts` (#804, DERIVE 204). |
| `unless` | `{ cost: string; payer: "you" \| "opponent" \| "controller" \| "any" }` | optional | THE PAYMENT THAT STOPS THIS ABILITY'S EFFECT (CR 118.12a), verbatim from the clause: Rhystic Study draws "unless that player pays {1}", a counterspell counters "unless its controller pays {3}", an upkeep cost sacrifices "unless you pay {W}{W}". The effect is what happens when the payment is not made, so this is its FLOOR: at worst the card is a tax of `cost` on `payer`. Recorded, never priced — what a {1} tax per opponent spell is worth is the rate axis's call (spec 2026-09-04, revision 2026-09-17). Absent on the ~98% of abilities that name no payment. `payer` is the prompt's closed set plus "any", which the model answered on 3 of 319 refreshed clauses ("unless any player pays"); recorded as said rather than forced into a side. |
| `conditionCares` | `string[]` | optional | THEME TAGS THE ABILITY'S INTERVENING-IF CONDITION DEMANDS — "if it had counters on it" wants a counters deck, "if a creature died this turn" wants an aristocrats one. |
| `gate` | `Gate` | optional | THE CONDITION THIS ABILITY'S EFFECT IS GATED ON, from a trailing "if <condition>" in its own sentence (#1357, owner 2026-10-27): "Draw a card if an opponent has cast a blue or black spell this turn" (Veil of Summer, `turn-event`), "Then draw a card if it has seven or more phyresis counters on it" (Weatherlight Compleated, `counter`), "Create two 1/1 blue Fish creature tokens if an opponent controls more creatures than you" (Beza, `unknown`). PARSED BY THE SAME `parseGate` AS A MANA LINE'S GATE: one grammar, the kinds of `Gate`. A gated effect STILL COUNTS and keeps its edges; the gate says how likely it is to happen, and a condition derive cannot read is `unknown`, which IS the "flagged conditional" state: never a sure effect, never zero. `conditionCares` beside it names the deck demand the condition makes, from the same `conditionCares()` the trigger and activation paths use. Only the ability the condition gates carries it (an ungated action of the same clause does not). ABSENT: no trailing "if" in the ability's sentence, and also the leading form ("If you control a Dragon, draw a card", "Then if ..."), a verb whose printed word derive cannot find, and the exempt "if you do" / "if able" / "if you pay" / "instead" / "would". Weighed by the matcher (`effect-gate-weight.ts`, #1357 task 2): the role counts, the land recommendation and the goldfish's draw count the effect at the chance its condition holds in the deck. |
| `otherwiseAlike` | `true` | optional | The printed "Otherwise" branch of this gated effect does the same kind of thing (Jace, the Perfected Mind: draws three, otherwise draws one), but the stored reading kept only this branch: the role happens either way (#1357 part 2). |
| `replacement` | `true` | optional | A CR 614 multiplier ("if you would draw a card ... draw two instead", Hardened Scales, Doubling Season): its trigger hears another card's event and makes that event BETTER. Owner, 2026-09-29: "replacement effects make the effects better, not the other way around" -- so the matcher writes the edge FROM this card TO the card whose effect it improves. |
| `change` | `ReplacementChange` | optional | HOW THIS REPLACEMENT CHANGES THE EVENT IT HEARS, when the sentence states a number (owner, 2026-10-24): Torbran's "plus 2", Fiery Emancipation's "triple". Set only beside `replacement`; absent when the change is not a stated number ("plus that many Squirrels"). |
| `requires` | `Requirement` | optional | A GAME-STATE MARKER THE ABILITY NEEDS, evaluable against a state the owner supplies (roadmap W18). "Max speed —" abilities need the player's speed at 4 (CR 702.179). Unlike `conditionCares` this IS evaluated: with no state, or one that falls short, the ability is silent; with one that meets it, the ability is on. The marker is the player's, never a card's. |
| `repeats` | `Repeats` | optional | How often this ability can fire — see `docs/superpowers/specs/2026-08-11-repeatability-taxonomy-design.md`. |
| `effect` | `Effect` | **required** |  |
| `emits` | `GameEvent[]` | optional | Events this ability emits for others to trigger on. |

### Characteristics

Defined in [`Characteristics`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `types` | `string[]` | **required** |  |
| `subtypes` | `string[]` | **required** |  |
| `faces` | `{ types: string[]; subtypes: string[] }[]` | optional | The faces this card can be PLAYED as, one at a time, each unmerged. Absent on a single-face card. A transform or flip card lists only its front — its back is reached by transforming a permanent already in play, which is not a zone change — while a modal DFC, adventure, split or `prepare` card lists every face, because each really is castable or playable in its own right. |
| `layout` | `string` | optional | Scryfall's printing layout, carried so the matcher can apply the ZONE rules, which differ by family and cannot be read off `faces` alone — split and adventure both list every face. See `zoneTypes` in matcher/implied.ts. |
| `colors` | `string[]` | **required** |  |
| `identity` | `string[]` | **required** |  |
| `cmc` | `number` | **required** |  |
| `power` | `string \| null` | **required** |  |
| `toughness` | `string \| null` | **required** |  |
| `token` | `boolean` | **required** | Printed cards are always false. |
| `emblem` | `true` | optional | AN EMBLEM (CR 114): an object in the command zone with abilities and no other characteristics. Present, and `true`, only on an emblem's own row in `cardTagsDerived`, which `derive-corpus` builds from the `tokens` collection's layout-`emblem` rows. Absent everywhere else, so `chars.emblem === true` is the whole test. Not a permanent (no `enters`, no `dies`), not a card (no `cast`), and NOT a token: `token` stays false on it, so "whenever a token enters" never matches one. |
| `noAbilities` | `true` | optional | A CARD WITH NO RULES TEXT -- an empty oracle text (Grizzly Bears, Memnite): what "a creature card with no abilities" (Ruxa, Patient Professor) names. Absent on tokens, whose rows carry no text (CEILING: a vanilla token is not stamped). |
| `anyNumber` | `true` | optional | A CARD A DECK MAY HOLD MORE THAN ONE OF despite CR 903.5b: "a deck can have any number of cards named ~" (Relentless Rats), "up to seven cards named ~" (Seven Dwarves). Absent on every other printed card. Read by `selfSubject`, which carries it onto the card's own events as `multiples`. |
| `creatureOnlyIf` | `true` | optional | A CREATURE ONLY UNDER A CONDITION: a static of its own says it "isn't a creature" until one holds ("As long as your devotion to red is less than five, Purphoros isn't a creature"; The Warring Triad; Arvinox). It enters as a noncreature in practice, so its own entry is not a creature's (#797). Its cast is still a creature spell: the static works only on the battlefield (CR 113.6). Set by derive from the action grammar's reading; absent on every other card. |
| `commander` | `boolean` | optional | THE ONE DECK FACT ON AN OTHERWISE PRINTED RECORD. Set per deck by `markCommander` (matcher/commander.ts), never by extraction — CR 903.3 says the commander designation "is not a characteristic of the object represented by the card". It lives here anyway because a card's IMPLIED events (`impliedEvents` → `selfSubject`) are synthesized from `Characteristics` at match time and are exactly the ones a commander-matters consumer needs: a commander's combat damage, entry and death. Stamping only the authored emits left Kediss unable to see its own partner. |
| `keywords` | `string[]` | **required** |  |
| `enchants` | `SubjectFilter` | optional | WHAT AN AURA CAN BE ATTACHED TO, from its printed "Enchant ..." line (CR 702.5a), parsed as a subject: "Enchant creature" is `{type: creature}`, "Enchant creature you control" adds the control, "Enchant creature card in a graveyard" (Animate Dead) carries the zone. Absent on every non-Aura, and on an Aura whose line names no class ("Enchant player"). |

### ManaLine

Defined in [`ManaLine`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `face` | `0 \| 1` | **required** | The face that prints it: 0 the front, 1 the back of a transform / modal card (Treasure Cove's `{T}: Add {C}`). |
| `source` | `ManaLineSource` | **required** |  |
| `repeats` | `Repeats \| null` | **required** | How often it can be used: the `repeats` of the ability the line was read from (`null` when that ability states none -- most triggers -- or no derived ability matches the clause). A dork is `per-cycle`, a spell `once`. |
| `cost` | `object` | **required** | WHAT USING IT CONSUMES, read off the printed activation cost (a trigger, a spell and an aura pay none here). |
| `cost.mana` | `number` | **required** | Mana symbols paid: a number is that many, a coloured / hybrid / Phyrexian symbol is 1, `{X}` is 0. For a `one-shot-spell` and a spell-speed `fetch` it is the mana value of the face that prints it. |
| `cost.tap` | `boolean` | **required** | `{T}` is in the cost. The tap is NOT subtracted in `net`. |
| `cost.sacrificeSelf` | `boolean` | **required** | Sacrifices the card itself ("{T}, Sacrifice this artifact: Add ..."): a one-shot (Lotus Petal, a Treasure). |
| `cost.sacrificeOther` | `boolean` | **required** | Sacrifices something else ("Sacrifice a creature: ...", Phyrexian Altar, Priest of Forgotten Gods). |
| `cost.life` | `number` | **required** | Life paid ("Pay 1 life"). |
| `cost.counters` | `"remove" \| "put" \| null` | **required** | A counter removed from or put on the card as the cost ("Remove a +1/+1 counter", Cryptic Trilobite; "Put a -0/-1 counter", Wall of Roots): the mana is paid for by a resource that runs out. |
| `cost.tapOther` | `boolean` | **required** | Taps other permanents ("Tap an untapped creature you control", Springleaf Drum). |
| `cost.loyalty` | `number \| null` | **required** | A PLANESWALKER'S LOYALTY COST, signed: +1 -> 1, 0 -> 0, "−3" -> -3. Null on a line with no loyalty cost ("−X" is none: no loyalty can be compared with it and it stays in `other`). Parsed ONCE, here; the matcher's `isLoyaltyAbility` and `startLoyalty` read it and match no text. |
| `cost.consumes` | `ConsumedCost[]` | **required** | WHAT THE COST USES UP beyond the typed fields above, classified from `other` (a consumer judges "paid with a resource" from this and never reads `other`'s text): `discard` (a card from hand, "Discard your hand"), `exile` (cards exiled from a graveyard or hand, a creature you control), `energy` ({E}, "Pay {E}"), `return-to-hand` (this creature or a permanent returns), `forage`, `collect-evidence`, and `unknown` for a piece the classifier does not recognise (refused, never guessed: it counts as consumed). NOT consumed, so absent: exerting (a skipped untap), untapping a permanent (`{Q}`, Pili-Pala; "Untap a tapped land"), milling yourself (Millikin). CEILING: one entry per piece, so `Pay {E}{E}{E}` is one `energy`. |
| `cost.other` | `string[]` | **required** | Every cost piece that is not a typed field or the loyalty cost, verbatim, for display: a discard, an untap, `{E}`. |
| `colours` | `string[]` | **required** | The WUBRG colours the printed text names, as a set. `any` names all five; a BOUNDED `anyColour` names none (the bound is outside the card), so the consumer resolves it from `anyColour`. |
| `colourless` | `number` | **required** | The `{C}` mana of one use (the largest across the alternatives printed). |
| `anyColour` | `ManaAnyColour \| null` | **required** | Set when the line chooses a colour instead of printing it. See `ManaAnyColour`. |
| `amount` | `ManaAmount` | **required** | How much one use adds: `fixed`, or `scales` with the interval it spans (`floor`, `ceiling`, `bound`). See `ManaAmount`. |
| `net` | `number` | **required** | CEILING: `net` is the LEGACY one-unit floor, kept so matcher results do not move: for a SCALING line it assumes the printed fixed part, else 1, then less `cost.mana`. It is NOT the guaranteed amount -- `amount.floor` is the authoritative guaranteed amount of a scaling line (Doc Samson floor 3 but net 1; Selvala, Explorer Returned floor 0 but net 1). goldfish.ts reads `amount.floor` (via `perUse`) since #1272; `net` stays the legacy value for the `net >= 1` bars in same-job, build and rules (owner 2026-10-20). Produced less `cost.mana`; the tap is not subtracted. CEILING: a scaling amount is produced as its printed fixed part when one precedes the "for each" ("Add {R}{R}, then add {R} for each ...", Rite of Flame: 2), else as 1 (its true floor may be 0; a consumer that cares reads `amount.scales`). EXCEPT "for each color among permanents you control" (Faeburrow Elder, Bloom Tender) on a permanent: the card is itself a permanent you control, so its floor is the number of its OWN colours (Faeburrow 2, Bloom Tender 1), and `net` is that less the cost. |
| `unread` | `boolean` | **required** | TRUE when the production could not be read: no colour, no colourless, no choice named ("any of the exiled card's colors", Chrome Mox; "for each color among permanents you control", Bloom Tender). Consumers treat it as UNKNOWN, never as a source of no colours. Always false on a `fetch` and a `token-maker`, which state theirs. |
| `gate` | `ManaGate \| null` | **required** | The condition the amount or the activation holds under, PARSED ONCE in derive into a `ManaGate` (`kind`: control, same-name, tron, speed, initiative, threshold, counter, turn-event, unknown; every kind keeps `text`, the verbatim lowercase condition): "Activate only if ..." (Tainted Peak: control a swamp), "... instead if there are seven or more cards in your graveyard" (Cabal Ritual's threshold line, a `threshold` gate), "this creature has a +1/+1 counter on it" (`counter`), "an opponent lost life this turn" (`turn-event`), or "threshold" when only the ability's numeric threshold is known (unknown). matcher `gate.ts` is the only evaluator; a consumer must not credit a gated line as guaranteed. Else null. |
| `restriction` | `ManaRestriction \| null` | **required** | "Spend this mana only ..." (Smokebraider, Cavern of Souls, Ancient Ziggurat) or "this mana can't be spent ...": `spend` is the printed limit, `typeName` the one type it names, lowercase ("elemental", "creature", "chosen"). Mana with a restriction is not mana for the deck's spells. |
| `timing` | `"now" \| "next-turn" \| "on-trigger"` | **required** | WHEN the mana arrives: `now`, `next-turn` (a delayed addition), `on-trigger` (when a trigger fires). |
| `producesToken` | `string \| null` | **required** | The token a `token-maker` line makes that is itself a mana source ("treasure", "gold", "powerstone", "eldrazi-spawn"); null on every other line. |
| `trigger` | `{ event: string; subject: SubjectFilter \| null; text: string \| null } \| null` | **required** | WHAT FIRES a `trigger` or `aura-trigger` line: the clause's trigger event (verbatim) and the SUBJECT it watches, read once in derive. Null on every other line, and on a trigger line whose own clause names none (a mode of a modal trigger, Zuko, Conflicted). Census of the 171 trigger / aura-trigger mana lines in the derived corpus (DERIVE_VERSION 302, 2026-10-11), by count of lines: `tapped-for-mana` 46 (the Auras' "whenever enchanted land is tapped for mana", and Forsaken Monument / Leyline of Abundance / Mana Flare: a tap-replacement), `main-phase` 30 and `upkeep` 5 and `end-step` 1 (the beginning of a phase: Coalition Relic, Abstract Paintmage), `enters` 27, `attacks` 17, `chapter` 14, `cast` 8 (Birgi: "whenever you cast a spell"), `dies` 6, `discarded` 3, `damage-dealt` 3, `transform` 2, `sacrificed` 2, `turned-face-up` 2, and one each of `life-gained`, `damaged`, `counter-added`. LANDFALL IS NOT AN EVENT OF ITS OWN: it is `enters` with a land subject you control (Lotus Cobra "a land you control"); `enters` with a `self` subject is the card's own enters trigger (Burning-Tree Emissary). One printed add that the model split across two events (Ashling, Rimebound: "transforms into ... and at the beginning of your first main phase") is named for the phase. `subject` is `parseSubject` of `text` (`self: true` when it names the card), or null when the clause names none; `text` is the subject as the clause names it ("a land you control", "your first main phase", "enchanted land", "a spell", "this creature"), kept for display and for a shape `subject` cannot say. |
| `startLoyalty` | `number` | optional | The printed STARTING LOYALTY of the planeswalker face that prints this line, present only when the line costs loyalty (`cost.loyalty` is set): the walker enters with that many counters (CR 306.5b) and a loyalty cost needs that many (CR 606.6), so "−1: Add {R}{R}" is playable the turn the walker is cast iff this is at least 1. From the card document's `loyalty` (Scryfall, per face), carried by ingest (owner 2026-10-13). |
| `untilEndOfTurn` | `true` | optional | TRUE on a TAP BONUS THAT LASTS ONE TURN, the line of a spell (`source: "one-shot-spell"`, `trigger.event` "tapped-for-mana", `trigger.subject` the filter): High Tide's "Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}" (owner 2026-10-13: ramp). `amount` is the bonus PER TAP and `net` is that one mana less the spell's cost, which says nothing: the yield is `amount` times the matching sources tapped that turn. Absent on a permanent's standing bonus (Forsaken Monument, Mana Flare, Vernal Bloom), which has no end. |

### StaticFixer

Defined in [`StaticFixer`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `covers` | `"lands" \| "all" \| "basics"` | **required** | `lands` when only lands you control gain the colours, `all` when any mana you spend does, `basics` when only BASIC lands you control do (Pulse of Llanowar). |
| `colours` | `string[]` | **required** | The WUBRG colours the card makes other sources produce. |

### LandFetch

Defined in [`LandFetch`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `kind` | `"spell" \| "permanent"` | **required** | `spell` for an instant or sorcery (Cultivate, Farseek), `permanent` for one that stays (a fetchland, Wood Elves, Sakura-Tribe Elder). |
| `tapped` | `boolean` | **required** | The land arrives tapped. |
| `reach` | `string[]` | **required** | The WUBRG colours the lands it can find make (a basic land reaches all five, "a Forest card" only G). |

### CardTags

Defined in [`CardTags`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `oracleId` | `string` | **required** |  |
| `schemaVersion` | `number` | **required** |  |
| `promptVersion` | `number` | **required** |  |
| `model` | `string` | **required** |  |
| `characteristics` | `Characteristics` | **required** |  |
| `abilities` | `Ability[]` | **required** |  |
| `manaLines` | `ManaLine[]` | optional | Every way this card puts mana in front of you, per face (#1169). See `ManaLine`. Absent when it has none. |
| `staticFixer` | `StaticFixer` | optional | Makes other sources produce colours (Chromatic Lantern). Absent on every other card. |
| `landFetch` | `LandFetch` | optional | Puts lands onto the battlefield from the library (Cultivate, Evolving Wilds). Absent on every other card. |
| `isOneShot` | `true` | optional | Every mana line the card has is spent in the using: an instant or sorcery's mana (Dark Ritual), or a source that sacrifices itself for it (Lotus Petal, a Treasure). Only `true` is written. A card with a permanent face that taps for mana as well is not a one-shot. |
| `suspendOnly` | `true` | optional | The card has no mana cost and is only ever put into play by Suspend (Mox Tantalite, Lotus Bloom): not fast mana, however much it taps for. Only `true` is written. |
| `unknownTriggers` | `string[]` | optional | Trigger events the clause layer named and derivation could not turn into a verb -- the "surface, never swallow" channel. Computed by `deriveAbilities` since 2026-08 and DROPPED by `deriveCardTags` until 2026-09-05, so every reader of it (`isolated-cards.ts`, the census) saw an empty list and the eerie "fully unlock a Room" half vanished without a trace. Absent when empty. |
| `unclaimed` | `UnclaimedAction[]` | optional | Actions the clause layer named and derivation could claim for nothing: no effect kind and no emit. The same "surface, never swallow" channel as `unknownTriggers`, and the same bug: `deriveAbilities` has returned it since 2026-08 and `deriveCardTags` threw it away, so a dropped clause was visible only to a census script that re-ran derive. Each entry carries the clause that printed it, so a reader can join it to `abilities[].clause`. Only the actions that REACH the claim test are listed. A clause skipped whole (a granted token's, a next-end-step cleanup folded into its maker) or a twin spliced out records nothing, by design: each has its home elsewhere. Absent when empty. |
| `pinned` | `boolean` | optional | True for a hand-verified tag that must survive automated re-tagging (e.g. a prompt-version bump). needsRetag short-circuits to false for a pinned tag regardless of version drift — set this only for cards where the LLM has demonstrably gotten the shape wrong and a human fixed it directly (see docs/superpowers/plans/2026-07-28-strategy-gap-fixes.md Task 2). |


---

## What the persist gate refuses

A refusal is visible; a banked guess is not. These are the defects
[`validateClauses`](../../packages/tagger/src/validate-clauses.ts) looks for in a model answer.

### ViolationKind — 11 members

One per way an answer can be wrong. Defined in [`ViolationKind`](../../packages/tagger/src/validate-clauses.ts).

`invented-id`, `missing-id`, `duplicate-id`, `unknown-verb`, `unknown-zone`, `unknown-trigger-event`, `ability-type-mismatch`, `missing-trigger`, `unexpected-trigger`, `zone-on-unzoned-verb`, `dropped-prefilled-action`


