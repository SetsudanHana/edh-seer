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
| `NORMALIZE_VERSION` | **20** | Bump when ANYTHING that determines the request changes: SYSTEM, VERBS, TRIGGERS, ZONES — and `segment.ts`, because the segmenter decides which clauses exist and what ids they carry. |
| `NORMALIZE_MIN_COMPATIBLE` | **3** | The oldest prompt whose answers are still valid. `needsNormalize` re-queues a card only when its stored version is BELOW this, so a mixed-version corpus is a stated condition rather than an accident. |
| `VOCAB_VERSION` | **20** | The NORMALIZE_VERSION at which the closed VOCABULARIES (VERBS, TRIGGERS, ZONES) last changed. **Bump this ONLY when one of those lists changes** — never for a prose rule. |
| `TRIGGER_VOCAB_VERSION` | **20** | The NORMALIZE_VERSION at which **TRIGGERS** last changed, tracked apart from VOCAB_VERSION. |
| `DERIVE_VERSION` | **141** | Bump when derivation semantics change — a new effect kind, a changed emit, a new guard. Unlike NORMALIZE_VERSION this is FREE to bump: it only re-runs `derive-corpus`, which reads the stored clauses and calls no model. That asymmetry is the whole point of storing clauses separately. |

See [`docs/RUNBOOK.md`](../RUNBOOK.md) for the procedure behind each bump.

---

## The normalization vocabulary

These are the words the model is allowed to answer with. An answer using anything else is **refused
and not persisted** — the card re-queues rather than banking a guess. They are sized against what the
game can express (the Comprehensive Rules), not against what the current decks happen to play,
because normalization is a one-way ratchet: nobody re-runs 36,000 cards to add a word.

### VERBS — 99 members

The action a clause performs. Defined in [`VERBS`](../../packages/tagger/src/normalize-prompt.ts).

`destroy`, `exile`, `sacrifice`, `tap`, `untap`, `draw`, `discard`, `mill`, `search`, `put`, `return`, `create`, `counter-spell`, `copy`, `gain-life`, `lose-life`, `deal-damage`, `add-mana`, `add-counter`, `remove-counter`, `grant-ability`, `modify-pt`, `prevent`, `cast`, `play`, `shuffle`, `reveal`, `attach`, `transform`, `trigger-again`, `extra-turn`, `extra-combat`, `animate`, `cant`, `emblem`, `fight`, `set-life`, `proliferate`, `scry`, `surveil`, `cost-modify`, `amass`, `turn-face-up`, `extra-phase`, `connive`, `recruit`, `bolster`, `support`, `adapt`, `monstrosity`, `blight`, `investigate`, `populate`, `incubate`, `manifest`, `discover`, `meld`, `cloak`, `manifest-dread`, `earthbend`, `goad`, `regenerate`, `exert`, `detain`, `suspect`, `harness`, `vote`, `clash`, `fateseal`, `behold`, `heal`, `exchange`, `convert`, `double`, `triple`, `explore`, `endure`, `learn`, `forage`, `time-travel`, `collect-evidence`, `venture-into-the-dungeon`, `face-a-villainous-choice`, `waterbend`, `airbend`, `ring-tempts`, `roll-dice`, `flip-coin`, `initiative`, `city-blessing`, `gain-control`, `phase-out`, `monarch`, `foretell`, `win-game`, `lose-game`, `unattach`, `other`, `none`


### TRIGGERS — 135 members

The event a triggered ability watches for. Defined in [`TRIGGERS`](../../packages/tagger/src/normalize-prompt.ts).

`enters`, `dies`, `leaves`, `attacks`, `blocks`, `taps`, `untaps`, `cast`, `upkeep`, `begin-combat`, `end-step`, `draw`, `draw-step`, `main-phase`, `combat-damage-step`, `damage-dealt`, `life-gained`, `life-lost`, `counter-added`, `sacrificed`, `discarded`, `milled`, `turned-face-up`, `level-up`, `chapter`, `proliferate`, `search`, `becomes-target`, `scry`, `surveil`, `unlocked`, `transform`, `copy`, `crime`, `expend`, `descended`, `day-night`, `dice-rolled`, `dungeon-completed`, `monarch`, `ring-tempts`, `clash`, `untap-step`, `declare-attackers`, `declare-blockers`, `end-of-combat`, `cleanup`, `initiative`, `city-blessing`, `activate`, `connive`, `discover`, `explore`, `vote`, `manifest-dread`, `exiled`, `phases-out`, `create`, `reveal`, `recruit`, `bolster`, `support`, `adapt`, `monstrosity`, `blight`, `investigate`, `populate`, `incubate`, `manifest`, `meld`, `cloak`, `earthbend`, `goad`, `regenerate`, `exert`, `detain`, `suspect`, `harness`, `fateseal`, `behold`, `heal`, `exchange`, `convert`, `double`, `triple`, `endure`, `learn`, `forage`, `time-travel`, `collect-evidence`, `venture-into-the-dungeon`, `face-a-villainous-choice`, `waterbend`, `airbend`, `roll-dice`, `flip-coin`, `put-into-graveyard`, `becomes-crewed`, `loses-control`, `phases-in`, `tapped-for-mana`, `becomes-blocked`, `cycled`, `mutates`, `becomes-monstrous`, `play`, `fight`, `amass`, `exploit`, `shuffled`, `attached`, `prevented`, `gains-control`, `countered`, `firebend`, `reflexive`, `state`, `counter-removed`, `mana-spent`, `damaged`, `loses-game`, `unattached`, `returned-to-hand`, `put-into-library`, `becomes-renowned`, `becomes-saddled`, `plotted`, `foretell`, `give-gift`, `mentors`, `solved`, `resolves`, `evolve`, `other`, `none`


### ZONES — 7 members

Where an action moves something from or to. Defined in [`ZONES`](../../packages/tagger/src/normalize-prompt.ts).

`battlefield`, `graveyard`, `hand`, `library`, `exile`, `stack`, `command`



---

## The engine vocabulary

Derivation maps the model's words onto these. The two lists are **not** the same and are not meant to
be: the clause vocabulary describes what a sentence says, the engine vocabulary describes what the
matcher can join on.

### VERB_VOCAB — 72 members

The events a card can supply or watch for. Defined in [`VERB_VOCAB`](../../packages/tagger/src/schema.ts).

`enters`, `enters-graveyard`, `dies`, `leaves`, `cast`, `attacks`, `taps`, `non-combat-damage`, `combat-damage`, `draw`, `discard`, `mill`, `gain-life`, `lose-life`, `sacrifice`, `create-token`, `counter-added`, `land-play`, `untaps`, `proliferate`, `unlock`, `upkeep`, `begin-combat`, `end-step`, `dice-rolled`, `scry`, `surveil`, `search`, `counter-spell`, `counter-removed`, `loses-game`, `shuffle`, `transform`, `turned-face-up`, `copy`, `reveal`, `attached`, `unattached`, `gains-control`, `phases-out`, `regenerate`, `prevented`, `exchange`, `double`, `triple`, `goad`, `exert`, `detain`, `suspect`, `harness`, `vote`, `clash`, `fateseal`, `behold`, `heal`, `convert`, `explore`, `endure`, `learn`, `forage`, `time-travel`, `collect-evidence`, `venture-into-the-dungeon`, `face-a-villainous-choice`, `airbend`, `waterbend`, `foretell`, `flip-coin`, `monarch`, `initiative`, `city-blessing`, `ring-tempts`


### EFFECT_KINDS — 43 members

What an ability DOES, once its trigger is satisfied. Defined in [`EFFECT_KINDS`](../../packages/tagger/src/schema.ts).

`token-generation`, `damage`, `player-life-loss`, `lifegain`, `drain`, `draw-card`, `forced-sacrifice`, `pump`, `ability-loss`, `cost-reduction`, `trigger-doubling`, `graveyard-recursion`, `clone`, `token-doubling`, `damage-multiplier`, `tax`, `scry`, `surveil`, `mill`, `search`, `top-set`, `counter-placement`, `enters-with-counters`, `mana-generation`, `fast-mana`, `ritual`, `copy-spell`, `copy-ability`, `speed-increase`, `speed`, `flicker`, `animate`, `untap`, `proliferate`, `graveyard-hate`, `extra-combat`, `keyword-grant`, `type-grant`, `win-game`, `extra-turn`, `extra-phase`, `emblem`

| member | why it exists |
|---|---|
| `debuff` | A NEGATIVE power/toughness modifier. Shaped like `pump` and meaning the opposite: Massacre Wurm, Toxic Deluge and Doomwake Giant are removal, not anthems, and reading them as anthems put a false claim on every creature in the deck. Measured 2026-08-20: **30 of 301 derived pump abilities (10%) carry a negative amount**, 186 corpus cards print "get -N/-N". Its own kind rather than a matcher-side gate because five readers consult this field — `mechanisms.ts` uses `pump` for four archetypes and `wincon.ts` for the go-wide finisher — and every one of them was wrong about these cards. |

### SCALING_BASES — 8 members

What an amount scales with, when it is not a number. Defined in [`SCALING_BASES`](../../packages/tagger/src/schema.ts).

`fixed`, `per-creature`, `per-permanent`, `per-graveyard`, `per-cast-or-spell`, `x-cost`, `per-opponent`, `unbounded`



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
| `type` | `string \| string[]` | optional | A card type, or an array of types meaning OR (e.g. ["instant","sorcery"]). |
| `notType` | `string[]` | optional | Card types the text NEGATED ("noncreature spell", "nonland permanent"), as the card says it. |
| `notSubtype` | `string[]` | optional | SUBTYPES the text negated — "target **non-Dragon** creature card", "each non-Zombie creature". |
| `notCast` | `true` | optional | THE OBJECT ARRIVED WITHOUT BEING CAST OR PLAYED — a blink, a token, a reanimation. |
| `entersTapped` | `true` | optional | THE OBJECT ARRIVED TAPPED. Two cards demand it — Amulet of Vigor and Tiller Engine — and both read "whenever a permanent you control ENTERS TAPPED". Set on both sides from the same printed cue `ARRIVES_TAPPED` already uses to suppress a phantom `taps` event. |
| `restricted` | `true` | optional | THE SUBJECT IS NARROWED BY A TARGETING RESTRICTION, AND NOTHING HERE MODELS TARGETING. "an instant or sorcery spell THAT TARGETS ONLY A SINGLE CREATURE YOU CONTROL" (Leyline of Resonance), "a spell THAT TARGETS ONLY A SINGLE ARTIFACT OR CREATURE YOU CONTROL" (Vesuvan Duplimancy). A demand only the consumer side can carry, and `eventMatches` refuses it — the `replacement.restricted` rule one layer over: keep the ability and its kind, claim no cards. |
| `umbrella` | `string` | optional | The umbrella noun a multi-umbrella `type` list was resolved FROM — "permanent" for "permanent spell". |
| `allTypes` | `string[]` | optional | Card types the subject demands ALL of — a compound noun, "artifact creature". |
| `subtype` | `string \| string[]` | optional | A subtype, or an array meaning OR (e.g. ["faerie","wizard"]). |
| `colors` | `string[]` | optional |  |
| `self` | `true` | optional | The subject IS the card whose ability this is ("when THIS creature enters", or the card named by its own name). Set by derivation from the clause text, which is the only layer that can see it: parseSubject reduces "this creature" and "another creature you control" to the same {type: creature}, so without this the matcher cannot tell a self-ETB from a real payoff -- the defect behind 74% of the false edges in the 2026-08-05 precision measurement. |
| `other` | `true` | optional | THE SUBJECT IS EXPLICITLY NOT THE CARD ITSELF: "another creature", "two other creatures". The opposite fact to `self`, and a prose fact more than a matching one: `subjectMatches` never reads it (the producer is never the consumer), but the sentence does -- Priest of Forgotten Gods' "Sacrifice two other creatures" printed as "When Priest of Forgotten Gods dies" because a creature producer could otherwise BE the creature its emit names. Set by `parseSubject` (2026-09-09, recall v4 sacrifice family). |
| `control` | `Control` | **required** |  |
| `token` | `boolean \| null` | **required** | false = nontoken only, true = token only, null = any. |
| `chosenType` | `boolean` | optional | Marks "the chosen type" (Kindred Discovery); resolved deck-aware in Stage 2. |
| `historic` | `true` | optional | "Historic" — artifact, legendary, or Saga. A printed fact, not a judgment, and the only way the engine can hear Jhoira, Basim Ibn Ishaq, Glóin, Rona and The Sixth Doctor narrow their cast trigger. Without it their subject is the bare umbrella `spell` and every card in the deck satisfies it. Set on a CONSUMER by `parseSubject`, and on a PRODUCER by the matcher, which reads it off the printed type line. |
| `outlaw` | `true` | optional | The subject demands an OUTLAW — CR 700.12, an object with the Assassin, Mercenary, Pirate, Rogue and/or Warlock creature type. A printed fact read off the type line, exactly like `historic`, and set on BOTH sides for the reason 09ce98d records: a consumer demand a producer cannot state is a demand nothing satisfies. |
| `modified` | `true` | optional | The subject demands a MODIFIED permanent — CR 700.9: it has a counter on it, is equipped, or is enchanted by an Aura its controller controls. |
| `combat` | `"attacking" \| "blocking"` | optional | The subject demands a COMBAT STATE — an attacking or a blocking creature. A board state like `modified`, so it is set on a CONSUMER by `parseSubject` ("whenever an attacking creature dies", Kardur, Doomscourge) and on a PRODUCER only where the printed text names it ("exile all attacking creatures", Settle the Wreckage). Without it Kardur derived a bare `dies:creature` and Blasphemous Edict at sorcery speed fed it (owner, 2026-09-05). |
| `withoutDying` | `true` | optional | A `leaves` demand that REFUSES a death. "Whenever one or more other creatures you control leave the battlefield without dying" (Dour Port-Mage) and Taeko's "if it didn't die" are `leaves` minus `dies` (CR 700.4). Demand only -- read by `eventMatches`, never stamped on a producer, so a consumer that does not ask is unaffected. 5 corpus cards. |
| `legendary` | `true` | optional | The subject demands the LEGENDARY supertype. "Legendary creatures you control get +2/+2" (Serah Farron) and Jodah's +X/+X derived a subject of EVERY creature without it, which were the two widest meshes in the derived population at x53 and x51. Shaped exactly like `historic`: matched against the card's printed characteristics, which already carry supertypes. |
| `basic` | `true` | optional | The subject demands the BASIC supertype. "Search your library for a basic land card" emitted `{type: land}` and nothing else, so at the authored-emit identity check — the one place an emit sits on the FILTER side — every NONBASIC land satisfied it, which was about half the false edges the 2026-08-13 board fixtures showed on self-ETB lands. 65 actions across 50 corpus docs. Same shape as `legendary`, and set on BOTH sides for the reason 09ce98d records. |
| `keyword` | `string[]` | optional | Printed KEYWORD ABILITIES the subject demands, ALL of them — "creatures you control with flying", "a creature with defender", "spells with flash you cast". |
| `notKeyword` | `string[]` | optional | Keyword abilities the subject demands the card does NOT have — "a creature you control without flying". The `notType` shape, for keywords: `keyword` says what must be there, this says what must not, and a subject can carry both. |
| `commander` | `true` | optional | The subject demands a COMMANDER — "a commander you control", "your commander". |
| `anyOf` | `Partial<SubjectFilter>[]` | optional | A real DISJUNCTION: the subject is satisfied by ANY of these branches. |
| `named` | `string` | optional | A CARD NAME the subject demands, lowercased — "a card named TARDIS", "creatures named Rat Colony". No other slot can hold it: a name is not a type, a subtype or a supertype. Mostly a singleton pointer in EDH, but 13 corpus cards say "a deck can have any number of cards named ..." and all 13 count their own name, which is an archetype the engine could not see at all. |
| `abilityKind` | `AbilityObjectKind[]` | optional | AN ABILITY AS AN OBJECT (roadmap AC12, owner's note 2026-09-08: "hard time recognizing trigger vs activated abilities, and cards like Gogo that can copy those"). CR 113.3 names the kinds; CR 707.10 lets a spell or ability be copied; 316 commander-legal cards name an activated, triggered, loyalty or mana ability as the THING they act on -- copy it (Gogo, Strionic Resonator, Rings of Brighthearth), counter it (Stifle), trigger on activating one (Harsh Mentor). Set by `parseSubject` when the object names one; the matcher answers it from the other card's own `abilities[].kind`. "activated" here means a NON-mana activated ability, as the cards mean it (mana abilities do not use the stack, CR 605.3b, and cannot be targeted); `mana` and `loyalty` are named only when the card names them. |
| `counter` | `string` | optional | Counter kind for `counter-added` events, e.g. "+1/+1", "-1/-1", "loyalty". |
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

### GameEvent

Defined in [`GameEvent`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `verb` | `Verb` | **required** |  |
| `subject` | `SubjectFilter` | **required** |  |
| `implied` | `true` | optional | Marks an event `impliedEvents` synthesized (e.g. "any creature can attack"), rather than one the tagger authored from oracle text. Never set by the LLM/extraction pipeline -- matcher-only, written solely by `packages/matcher/src/implied.ts`. Used to scope `combatSelfSupplied` to implied combat only, so authored combat emits (goad, Mage Slayer, Saskia) still form edges. |
| `instantSpeed` | `true` | optional | The producer acts at INSTANT SPEED: an activated ability (loyalty and "activate only as a sorcery" excepted), an instant, or a spell with flash. The smallest timing model that holds the owner's ruling (2026-08-22, upheld): Ayara -> Death Tyrant is REAL because a sac outlet can eat an ATTACKING creature in combat, while Blasphemous Edict at sorcery speed cannot. Read by the matcher only where a consumer demands a combat state (`SubjectFilter.combat`). Set on authored emits alone -- an implied event carries no ability to be fast. |
| `dealer` | `SubjectFilter` | optional | WHO DEALT THE DAMAGE — damage verbs only, and only on an AUTHORED emit. |

### Effect

Defined in [`Effect`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `kind` | `string` | **required** | Normalized to the closed EFFECT_KINDS set at validation time. |
| `subject` | `SubjectFilter` | optional |  |
| `scaling` | `string` | optional | Normalized to the closed SCALING_BASES set at validation time; absent → "fixed". |
| `scalingSubject` | `SubjectFilter` | optional | WHAT the count counts, when the basis alone cannot say. `per-graveyard` covers Cavalier of Flame's land cards, Glamdring's instants and sorceries and Bonehoard's creatures alike, so an edge drawn off the basis would claim that milling anything feeds all three. Carries the zone and the owner too, so `graveyardFillMatches` can judge it like any other graveyard demand. |

### Ability

Defined in [`Ability`](../../packages/tagger/src/schema.ts).

| field | type | | what it carries |
|---|---|---|---|
| `kind` | `AbilityKind` | **required** |  |
| `face` | `number` | optional | WHICH FACE PRINTS THIS ABILITY — absent for the front face and for every single-face card, 1 or more for a back face. From `segment.ts`'s own face counter, recomputed at derive time. |
| `cost` | `string` | optional | An activated ability's activation cost, verbatim as `segment.ts` split it out of the body — "{X}{X}, {T}", "{T}, Sacrifice a creature". Unparsed on purpose: this records what the card says, and what a cost MEANS for a loop's economy is sub-project B's question. |
| `doubles` | `Verb[]` | optional | WHICH TRIGGERS THIS ABILITY DOUBLES. Present only on `trigger-doubling`. |
| `doublesOf` | `SubjectFilter` | optional | WHOSE TRIGGERS THIS ABILITY DOUBLES. Present only on `trigger-doubling`, and only when the printed frame names a CLASS of permanent rather than an event: "a triggered ability of another Elemental you control" (Twinflame Travelers), "of a Shaman or another Wizard" (Harmonic Prodigy), "of a legendary creature you control" (Annie Joins Up), "of a creature you control with power 2 or less" (Delney). This is the axis `doubles` recorded as its ceiling on 2026-08-22 -- WHOSE ability, not WHICH event -- and it reached the recall draw on 2026-09-10 (v5 #196, Cavalier of Thorns -> Twinflame Travelers). Eight corpus cards. |
| `temporary` | `true` | optional | THE TOKEN THIS ABILITY CREATES LEAVES AT THE NEXT END STEP. Present only on `token-generation`. |
| `amount` | `string` | optional | The amount stated by the action that produced this ability, verbatim from the clause — "2", "X", "1,000". |
| `conditionCares` | `string[]` | optional | THEME TAGS THE ABILITY'S INTERVENING-IF CONDITION DEMANDS — "if it had counters on it" wants a counters deck, "if a creature died this turn" wants an aristocrats one. |
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
| `commander` | `boolean` | optional | THE ONE DECK FACT ON AN OTHERWISE PRINTED RECORD. Set per deck by `markCommander` (matcher/commander.ts), never by extraction — CR 903.3 says the commander designation "is not a characteristic of the object represented by the card". It lives here anyway because a card's IMPLIED events (`impliedEvents` → `selfSubject`) are synthesized from `Characteristics` at match time and are exactly the ones a commander-matters consumer needs: a commander's combat damage, entry and death. Stamping only the authored emits left Kediss unable to see its own partner. |
| `keywords` | `string[]` | **required** |  |

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
| `unknownTriggers` | `string[]` | optional | Trigger events the clause layer named and derivation could not turn into a verb -- the "surface, never swallow" channel. Computed by `deriveAbilities` since 2026-08 and DROPPED by `deriveCardTags` until 2026-09-05, so every reader of it (`isolated-cards.ts`, the census) saw an empty list and the eerie "fully unlock a Room" half vanished without a trace. Absent when empty. |
| `pinned` | `boolean` | optional | True for a hand-verified tag that must survive automated re-tagging (e.g. a prompt-version bump). needsRetag short-circuits to false for a pinned tag regardless of version drift — set this only for cards where the LLM has demonstrably gotten the shape wrong and a human fixed it directly (see docs/superpowers/plans/2026-07-28-strategy-gap-fixes.md Task 2). |


---

## What the persist gate refuses

A refusal is visible; a banked guess is not. These are the defects
[`validateClauses`](../../packages/tagger/src/validate-clauses.ts) looks for in a model answer.

### ViolationKind — 11 members

One per way an answer can be wrong. Defined in [`ViolationKind`](../../packages/tagger/src/validate-clauses.ts).

`invented-id`, `missing-id`, `duplicate-id`, `unknown-verb`, `unknown-zone`, `unknown-trigger-event`, `ability-type-mismatch`, `missing-trigger`, `unexpected-trigger`, `zone-on-unzoned-verb`, `dropped-prefilled-action`


