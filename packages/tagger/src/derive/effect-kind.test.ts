import { expect, test } from "vitest";
import { actionEffectKind, extraPhaseName } from "./effect-kind.js";
import { EFFECT_KINDS } from "../schema.js";

test("the origin zone decides the kind, because the zone is the card", () => {
  // Scavenging Ooze, Bojuka Bog.
  expect(actionEffectKind({ verb: "exile", fromZone: "graveyard" })).toBe("graveyard-hate");
  // Removal by exile has no payoff kind at all.
  expect(actionEffectKind({ verb: "exile", fromZone: null })).toBeNull();
  // Reanimate, Necromancy say "put"; Animate Dead says "return". Same effect, same kind.
  expect(actionEffectKind({ verb: "put", fromZone: "graveyard", toZone: "battlefield" })).toBe("graveyard-recursion");
  expect(actionEffectKind({ verb: "return", fromZone: "graveyard", toZone: "battlefield" })).toBe("graveyard-recursion");
});

test("plain verb lookups", () => {
  expect(actionEffectKind({ verb: "create" })).toBe("token-generation");
  expect(actionEffectKind({ verb: "deal-damage" })).toBe("damage");
  expect(actionEffectKind({ verb: "draw" })).toBe("draw-card");
  expect(actionEffectKind({ verb: "add-mana" })).toBe("mana-generation");
  expect(actionEffectKind({ verb: "add-counter" })).toBe("counter-placement");
  expect(actionEffectKind({ verb: "modify-pt" })).toBe("pump");
  expect(actionEffectKind({ verb: "untap" })).toBe("untap");
  expect(actionEffectKind({ verb: "proliferate" })).toBe("proliferate");
  expect(actionEffectKind({ verb: "animate" })).toBe("animate");
  expect(actionEffectKind({ verb: "copy" })).toBe("clone");
  expect(actionEffectKind({ verb: "extra-combat" })).toBe("extra-combat");
});

test("life change splits by who it happens to", () => {
  expect(actionEffectKind({ verb: "gain-life", object: "you" })).toBe("lifegain");
  expect(actionEffectKind({ verb: "lose-life", object: "each opponent" })).toBe("player-life-loss");
});

test("copy-spell is not a reachable row -- VERBS (normalize-prompt.ts) only ever emits copy", () => {
  expect(actionEffectKind({ verb: "copy-spell" })).toBeNull();
});

test("an action with no home in the closed 29 produces null, never a near miss", () => {
  expect(actionEffectKind({ verb: "destroy" })).toBeNull();
  expect(actionEffectKind({ verb: "fight" })).toBeNull();
  expect(actionEffectKind({ verb: "other", object: "flip a coin" })).toBeNull();
  // The closed 29 has no counterspell kind. `tax` means a cost increase (Thalia-style), a
  // different game action from countering a spell outright -- mapping the two together would
  // falsely mesh counterspells with stax payoffs. Returns null and surfaces via the unclaimed
  // list instead of a near-miss kind.
  expect(actionEffectKind({ verb: "counter-spell" })).toBeNull();
});

test("every kind the table can return is a member of the closed set", async () => {
  const { EFFECT_KINDS } = await import("../schema.js");
  const samples = ["create", "deal-damage", "draw", "add-mana", "add-counter", "modify-pt",
    "untap", "proliferate", "animate", "copy", "extra-combat", "gain-life", "lose-life"];
  for (const verb of samples) {
    const kind = actionEffectKind({ verb });
    if (kind) expect(EFFECT_KINDS).toContain(kind);
  }
});

test("recursion is keyed on the graveyard origin, not on one templating of the move", () => {
  // Muldrotha says PLAY/CAST from the graveyard rather than moving a card; keying only on
  // put/return lost the whole card.
  expect(actionEffectKind({ verb: "play", object: "a land from your graveyard", fromZone: "graveyard", toZone: "battlefield" }))
    .toBe("graveyard-recursion");
  expect(actionEffectKind({ verb: "cast", object: "a permanent spell from your graveyard", fromZone: "graveyard" }))
    .toBe("graveyard-recursion");
});

test("exile-and-return-to-the-battlefield is a flicker; the return carries the kind", () => {
  expect(actionEffectKind({ verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" })).toBe("flicker");
  // The exile half states no payoff of its own -- one Ability per action, and this one is inert.
  expect(actionEffectKind({ verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" }))
    .toBeNull();
});

test("putting cards into a graveyard is the payoff mill already names", () => {
  expect(actionEffectKind({ verb: "put", object: "those cards", toZone: "graveyard" })).toBe("top-manipulation");
  // ...but a graveyard ORIGIN still wins: that is recursion, not a fill.
  expect(actionEffectKind({ verb: "put", object: "target creature card", fromZone: "graveyard", toZone: "battlefield" }))
    .toBe("graveyard-recursion");
});

test("self-mill is a graveyard entry from the LIBRARY, not any move into a graveyard", () => {
  // canonicalAction nulls an unstated/library origin, so from:null IS the self-mill case.
  expect(actionEffectKind({ verb: "put", object: "those cards", fromZone: null, toZone: "graveyard" }))
    .toBe("top-manipulation");
  // Moving a permanent off the battlefield into a graveyard is removal; calling it a
  // top-manipulation payoff would mesh removal with every mill deck.
  expect(actionEffectKind({ verb: "put", object: "target creature", fromZone: "battlefield", toZone: "graveyard" }))
    .toBeNull();
});

test("granting haste or double strike is a speed increase; other grants stay silent", () => {
  // 342 corpus cards carry a grant-ability action and `grant-ability` had no row at all, so
  // Lightning Greaves, Swiftfoot Boots and Rage Reflection derived nothing. `speed-increase` is the
  // kind the FLAT tagger already assigns to Berserkers' Onslaught's double strike, and
  // mechanisms.ts consumes it for attack-matters, so this feeds a rule that exists.
  expect(actionEffectKind({ verb: "grant-ability", object: "haste" })).toBe("speed-increase");
  expect(actionEffectKind({ verb: "grant-ability", object: "haste until end of turn" })).toBe("speed-increase");
  expect(actionEffectKind({ verb: "grant-ability", object: "double strike" })).toBe("speed-increase");
  expect(actionEffectKind({ verb: "grant-ability", object: "hexproof and haste" })).toBe("speed-increase");

  // Everything else is now `keyword-grant`, REVERSING the original decision here. That decision was
  // "a near-miss kind is worse than null", and it was right about the near-miss: hexproof and
  // indestructible are the `protection` deck ROLE (build.ts:126 derives it from oracle text), and
  // flying/trample are evasion, so labelling either of those `pump` or `protection` would be
  // consumed as something it is not.
  //
  // `keyword-grant` is not a near-miss — it says exactly what the card does, and nothing consumes it
  // as anything else. The cost of the silence was measured: the recall draw (spec §26) found
  // Svyelun's "other Merfolk you control have ward {1}" reaching Master of Waves, a Merfolk, and the
  // card derived NO ability at all. 467 corpus clauses carry a grant-ability action.
  //
  // The mesh the old rule was really protecting against is handled where it belongs, in derive: a
  // grant earns an edge only when its recipient names a SUBTYPE, so "creatures you control gain
  // haste" still forms nothing.
  expect(actionEffectKind({ verb: "grant-ability", object: "hexproof and indestructible" })).toBe("keyword-grant");
  expect(actionEffectKind({ verb: "grant-ability", object: "flying" })).toBe("keyword-grant");
  expect(actionEffectKind({ verb: "grant-ability", object: "deathtouch" })).toBe("keyword-grant");
  // An EMPTY object grants nothing nameable and still gets no kind: there is no fact to record.
  expect(actionEffectKind({ verb: "grant-ability", object: "" })).toBe("keyword-grant");
});

test("a tutor is top-manipulation, matching what the flat tagger already assigns", () => {
  // Demonic Tutor's live flat tag is exactly { kind: "top-manipulation" }. `search` had no row, so
  // Demonic Tutor, Fabricate and Spellseeker all derived nothing.
  expect(actionEffectKind({ verb: "search", object: "your library" })).toBe("top-manipulation");
});

test("`cant` is a tax only when it can be paid through", () => {
  // Propaganda and Ghostly Prison both carry a live flat tag of { kind: "tax" }; Bedlam
  // ("Creatures can't block") carries []. The difference is whether the restriction has a price.
  expect(actionEffectKind({ verb: "cant", object: "attack you unless their controller pays {2}" })).toBe("tax");
  expect(actionEffectKind({ verb: "cant", object: "block" })).toBeNull();
  expect(actionEffectKind({ verb: "cant", object: "" })).toBeNull();
});

test("scry and surveil are top-manipulation, the payoff mill and search already name", () => {
  // Barrier of Bones' live flat tag for its surveil is exactly { kind: "top-manipulation" }, and
  // both verbs rearrange what you draw next, which is what the kind means.
  expect(actionEffectKind({ verb: "scry", object: "2" })).toBe("top-manipulation");
  expect(actionEffectKind({ verb: "surveil", object: "1" })).toBe("top-manipulation");
});

test("cost-modify splits on direction: cheaper is cost-reduction, dearer is tax", () => {
  // Foundry Inspector and Urza's Incubator carry live flat tags of cost-reduction; Thalia carries
  // tax. One verb, because the clause states one action -- the direction is in the object.
  expect(actionEffectKind({ verb: "cost-modify", object: "Artifact spells you cast cost {1} less to cast" }))
    .toBe("cost-reduction");
  expect(actionEffectKind({ verb: "cost-modify", object: "creature spells you cast cost {2} less" }))
    .toBe("cost-reduction");
  expect(actionEffectKind({ verb: "cost-modify", object: "Noncreature spells cost {1} more to cast" }))
    .toBe("tax");
  // "more" said of an OPPONENT's spells is the same tax even when the wording puts the direction
  // elsewhere; naming opponents at all is enough, since nobody taxes themselves on purpose.
  expect(actionEffectKind({ verb: "cost-modify", object: "spells your opponents cast cost {1} more" }))
    .toBe("tax");
  // Direction unstated: no kind rather than a guess, because cost-reduction and tax are opposites
  // and a wrong one is consumed as if it were true.
  expect(actionEffectKind({ verb: "cost-modify", object: "" })).toBeNull();
});

test("the verbs the undocced cards needed derive real kinds", () => {
  // Five of the 24 cards with no clause doc were refused on vocabulary alone: Orcish Bowmasters
  // (amass), Cyber Conversion and Ugin's Mastery (turn-face-up), Cyclonus (extra-phase).
  // amass puts +1/+1 counters on an Army, creating one first if you have none -- both halves are
  // kinds the engine already consumes, and counter-placement is the one every payoff reads.
  expect(actionEffectKind({ verb: "amass", object: "Orcs 1" })).toBe("counter-placement");
  expect(actionEffectKind({ verb: "extra-phase", object: "an additional combat phase" })).toBe("extra-combat");
  // turn-face-up flips a manifested or morphed permanent; it is an animate-class state change,
  // not a token and not a pump.
  expect(actionEffectKind({ verb: "turn-face-up", object: "target face-down creature" })).toBe("animate");
});

test("exiling your OWN graveyard is fuel, not graveyard hate", () => {
  // 25 of the 58 graveyard-hate actions in the corpus exile the controller's own graveyard --
  // Mizzix's Mastery, Aphemia, Lazotep Quarry, Necropotence. That is a COST paid in your own
  // resources (escape, delve, flashback-style exile), the opposite of hating someone else's yard,
  // and tagging it `graveyard-hate` made every self-fuel card a graveyard-hate payoff.
  //
  // The answer is null, not a new kind: the actions that carry the real payoff are elsewhere in the
  // same clause (Mizzix's Mastery copies the exiled spell, Greenwarden returns a card), and a
  // near-miss kind is consumed as if it were true while null is honestly inert.
  const exile = (object: string) => ({ verb: "exile", object, fromZone: "graveyard", toZone: null });
  expect(actionEffectKind(exile("target instant or sorcery card from your graveyard"))).toBeNull();
  // Someone else's graveyard is the real thing, and stays.
  expect(actionEffectKind(exile("target player's graveyard"))).toBe("graveyard-hate");
  expect(actionEffectKind(exile("each opponent's graveyard"))).toBe("graveyard-hate");
  // An unqualified graveyard says nothing about whose, so it keeps the kind it has today.
  expect(actionEffectKind(exile("up to X target cards from graveyards"))).toBe("graveyard-hate");
});

test("the clause text decides whose graveyard when the object does not say", () => {
  // "Whenever you discard a card, exile that card from your graveyard" (Necropotence): the object is
  // just "that card" and only the clause carries the owner.
  const a = { verb: "exile", object: "that card", fromZone: "graveyard", toZone: null };
  expect(actionEffectKind(a, "Whenever you discard a card, exile that card from your graveyard.")).toBeNull();
  // A clause that exiles an OPPONENT's yard and happens to mention yours elsewhere is still hate --
  // the object is checked first, and the clause-text fallback refuses to answer when both appear.
  expect(actionEffectKind(a, "Exile target opponent's graveyard, then return a card from your graveyard to your hand."))
    .toBe("graveyard-hate");
  // No text at all leaves today's answer, so every other caller is unaffected.
  expect(actionEffectKind(a)).toBe("graveyard-hate");
});

// Sapphire Medallion reads "Blue spells you cast cost {1} less to cast", but the model puts only the
// SUBJECT in the object field — "Blue spells you cast" — so the direction word never reaches
// costDirection and the whole ability was dropped. 16 corpus cards derive NOTHING for this reason,
// including Foundry Inspector and Etherium Sculptor, which this file's own comment claims carry live
// cost-reduction tags. The clause text is the fallback, exactly as exilesOwnGraveyard uses it.
test("cost direction falls back to the clause text when the object carries only the subject", () => {
  expect(actionEffectKind(
    { verb: "cost-modify", object: "Blue spells you cast" },
    "Blue spells you cast cost {1} less to cast.",
  )).toBe("cost-reduction");
});

test("a tax is still a tax when only the clause text says so", () => {
  expect(actionEffectKind(
    { verb: "cost-modify", object: "Creature spells" },
    "Creature spells cost {1} more to cast.",
  )).toBe("tax");
});

// The object is the action's OWN text and stays authoritative: a clause mentioning both directions
// must not let the fallback overrule it.
test("the object wins over the clause text when it states a direction itself", () => {
  expect(actionEffectKind(
    { verb: "cost-modify", object: "spells your opponents cast cost {1} more" },
    "Spells you cast cost {1} less to cast and spells your opponents cast cost {1} more.",
  )).toBe("tax");
});

// Guessing between two opposites is the near-miss class this file exists to refuse.
test("a clause naming both directions refuses to answer rather than guess", () => {
  expect(actionEffectKind(
    { verb: "cost-modify", object: "spells" },
    "Spells you cast cost {1} less to cast. Spells your opponents cast cost {1} more to cast.",
  )).toBeNull();
});

// Omo, Queen of Vesuva does NOT grant a keyword. She puts an everything counter on a permanent, and
// her static abilities say each land with that counter "is every land type" and each nonland creature
// with it "is every creature type". Granting TYPES is a typal enabler - Maskwood Nexus is the pure
// case - and calling it keyword-grant put it in the same bucket as Lightning Greaves' haste.
// 14 corpus grant-ability actions read as type grants.
test("granting a creature type is a type-grant, not a keyword-grant", () => {
  expect(actionEffectKind({ verb: "grant-ability", object: "is every creature type" }))
    .toBe("type-grant");
});

test("granting a type in addition to its other types is a type-grant", () => {
  expect(actionEffectKind({ verb: "grant-ability", object: "target creature becomes a Vampire in addition to its other types" }))
    .toBe("type-grant");
});

test("a plain keyword grant is untouched", () => {
  expect(actionEffectKind({ verb: "grant-ability", object: "creatures you control have ward {1}" }))
    .toBe("keyword-grant");
});

test("a speed keyword still outranks the type test", () => {
  expect(actionEffectKind({ verb: "grant-ability", object: "creatures you control gain haste until end of turn" }))
    .toBe("speed-increase");
});

test("the vocabulary can express winning and extra turns/phases", () => {
  expect(EFFECT_KINDS).toContain("win-game");
  expect(EFFECT_KINDS).toContain("extra-turn");
  expect(EFFECT_KINDS).toContain("extra-phase");
});

// Simic Ascendancy / Revel in Riches / Hellkite Tyrant all record the win the same way: the LLM has
// no win verb, so it reaches us through the `other` escape hatch with the meaning in the object.
test("an `other` action whose object says you win the game is win-game", () => {
  expect(actionEffectKind({ verb: "other", object: "you win the game" },
    "At the beginning of your upkeep, if you have twenty or more growth counters on Simic Ascendancy, you win the game."))
    .toBe("win-game");
});

test("an `other` action that is not a win is not win-game", () => {
  expect(actionEffectKind({ verb: "other", object: "gain control of all artifacts that player controls" },
    "Whenever Hellkite Tyrant deals combat damage to a player, gain control of all artifacts that player controls."))
    .not.toBe("win-game");
});

// Magosi's DRAWBACK. The LLM labelled "Skip your next turn" with verb extra-phase; reading the verb
// alone credits it as activation supply with the sign reversed, which is worse than no supply.
test("a skipped turn is refused, not credited", () => {
  expect(actionEffectKind({ verb: "extra-phase", object: "your next turn" },
    "{U}, {T}: Put an eon counter on this land. Skip your next turn."))
    .toBeNull();
});

// SYNTHETIC input, not Cyclonus's real oracle text -- see the round-1 fix report and the
// "Cyclonus's REAL clause..." test far below, which derives the OPPOSITE kind (extra-phase) from
// Cyclonus's actual stored text. No known real card prints the literal phrase "additional combat
// phase" this way; this fixture exists only to prove the combat branch still wins over the general
// phase branch when a card's text genuinely does name a combat phase (World at War is the real
// witness for that shape -- see its own test below). Originally written believing it described
// Cyclonus; it does not, and is kept as a synthetic regression case rather than removed.
test("an additional combat phase stays extra-combat (synthetic input)", () => {
  expect(actionEffectKind({ verb: "extra-phase", object: "an additional combat phase" },
    "Untap all creatures that attacked this turn. After this phase, there is an additional combat phase."))
    .toBe("extra-combat");
});

// Sphinx of the Second Sun carries verb extra-turn for a PHASE -- the verb is unreliable in both
// directions, so the object arbitrates.
test("an additional beginning phase is extra-phase even under an extra-turn verb", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "beginning phase" },
    "At the beginning of each of your postcombat main phases, there is an additional beginning phase after this phase."))
    .toBe("extra-phase");
});

test("a real extra turn is extra-turn", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "extra turn" },
    "{T}, Remove an eon counter from this land and return it to its owner's hand: Take an extra turn after this one."))
    .toBe("extra-turn");
});

// --- Round 1 fixes (threshold-lines task 3, fix round 1) ---
// All clause texts below are the cards' real, corpus oracleText (or the reconstructed clause text
// enumerate-phase-verbs.ts prints for that action), fetched from the DB, never from memory.

// Time Stop and Ultima both say "End the turn." -- ending the CURRENT turn early, the opposite of
// granting one. `\bskips?\b` alone didn't catch this; the near-miss `extra-turn` label was worse
// than the null it should have been.
test("ending the turn is refused, not credited as an extra turn (Time Stop)", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "end the turn" }, "End the turn."))
    .toBeNull();
});

test("ending the turn is refused, not credited as an extra turn (Ultima)", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "end the turn" },
    "Destroy all artifacts and creatures. End the turn."))
    .toBeNull();
});

// Paradox Haze's object names its real granted unit ("additional upkeep step"); the clause's only
// "turn" mention ("each turn") describes WHEN the trigger fires, not what it grants. Object-first
// arbitration (this file's own costDirection precedent) reads the object and stops there.
test("Paradox Haze's upkeep step is extra-phase, not extra-turn from a contextual 'each turn'", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "additional upkeep step" },
    "At the beginning of enchanted player's first upkeep each turn, that player gets an additional upkeep step after this step."))
    .toBe("extra-phase");
});

// Y'shtola Rhul is the same shape: its object names an end step; the clause's "of the turn" is
// contextual (once per turn), not the granted unit.
test("Y'shtola Rhul's end step is extra-phase, not extra-turn from a contextual 'of the turn'", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "additional end step" },
    "At the beginning of your end step, exile target creature you control, then return it to the battlefield under its owner's control. Then if it's the first end step of the turn, there is an additional end step after this step."))
    .toBe("extra-phase");
});

// Teferi, Master of Time's clause says "two extra TURNS" -- plural only, no singular "turn"
// anywhere in the object or clause. The old singular-only `\bturn\b` derived nothing for a card
// that unambiguously grants two extra turns.
test("a plural 'extra turns' is still extra-turn", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "two extra turns after this one" },
    "Take two extra turns after this one."))
    .toBe("extra-turn");
});

// Obeka's trigger is "deals COMBAT DAMAGE to a player" -- a combat-damage trigger, not a combat
// phase grant. Requiring the literal phrase "combat phase" (not the bare word "combat") refuses
// that reading. NOTE, measured rather than assumed: this derives `extra-phase`, not null -- Obeka's
// own object ("upkeep step") independently names a real unit once `step` counts as one, which is
// the same fix Paradox Haze needed. See the fix report for why this diverges from a null prediction.
test("Obeka's combat-damage trigger is not extra-combat (bare 'combat' no longer qualifies)", () => {
  const kind = actionEffectKind({ verb: "extra-turn", object: "upkeep step" },
    "Whenever Obeka deals combat damage to a player, you get that many additional upkeep steps after this phase.");
  expect(kind).not.toBe("extra-combat");
  expect(kind).toBe("extra-phase");
});

// World at War is the control case for the fix above: its clause genuinely names an ADDITIONAL
// COMBAT PHASE, and must stay extra-combat even though its own object ("main phase") is merely the
// timing anchor ("after the second main phase"), not the granted unit. Combat is checked on the
// combined object+clause text specifically so a generic phase match in the object can't shadow it.
test("World at War's real additional combat phase stays extra-combat", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "main phase" },
    "After the second main phase this turn, there's an additional combat phase followed by an additional main phase."))
    .toBe("extra-combat");
});

// Cyclonus's REAL corpus text (not the synthetic fixture above) never says "combat phase" anywhere
// -- its trigger is "deals combat damage", and the phase it actually grants is described as an
// "additional BEGINNING phase" (matching Sphinx/Shadow of the Second Sun's own wording exactly).
// Verified against the card's stored oracleText: the design spec's premise that this card's grant
// "genuinely is extra-combat" does not hold against the real text; only the fabricated fixture used
// above (object "an additional combat phase") does. Locked in here so the divergence is visible
// rather than silently different from what the synthetic test implies.
test("Cyclonus's REAL clause names a beginning phase, not a combat phase, and is extra-phase", () => {
  expect(actionEffectKind({ verb: "extra-phase", object: "beginning phase" },
    "Whenever Cyclonus deals combat damage to a player, convert it. If you do, there is an additional beginning phase after this phase."))
    .toBe("extra-phase");
});

// Bonus, not in the fix list but the same shape as Obeka/Paradox Haze: The Ninth Doctor's object
// also names "an additional upkeep step" and previously derived nothing at all (no turn/phase/combat
// word matched). It now lands the same place Paradox Haze does.
test("The Ninth Doctor's upkeep step is extra-phase (same shape as Paradox Haze)", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "an additional upkeep step" },
    "Whenever The Ninth Doctor becomes untapped during your untap step, you get an additional upkeep step after this step."))
    .toBe("extra-phase");
});

// Savor the Moment WITNESS, locking in a known false negative rather than fixing it. Its own
// extra-turn action's object is empty (""); the "genuinely does grant a turn" fact lives only in
// the clause, and the same clause's "Skip the untap step of that turn" trips SKIPPED before the
// real grant is ever read. Net effect on this card is unchanged by the round-1 fixes (null before,
// null after) -- this test exists so a future widening of SKIPPED can't silently flip this card
// without a test noticing, one way or the other.
test("Savor the Moment stays refused (witness, not a fix -- it genuinely grants a turn)", () => {
  expect(actionEffectKind({ verb: "extra-turn", object: "" },
    "Take an extra turn after this one. Skip the untap step of that turn."))
    .toBeNull();
});

// --- Round 2 fixes: extra-phase records WHICH phase (owner's ruling, subject.phase) ---
// Every clause text below is real, stored corpus oracleText, fetched from the DB, never memory.

test("Sphinx of the Second Sun grants the 'beginning' phase", () => {
  expect(extraPhaseName("beginning phase",
    "At the beginning of each of your postcombat main phases, there is an additional beginning phase after this phase."))
    .toBe("beginning");
});

// Obeka's OWN object already names the real unit ("upkeep step"); its clause's "combat damage"
// trigger must not leak in, and doesn't need to -- object-first resolves this one directly.
test("Obeka, Splitter of Seconds grants the 'upkeep' phase", () => {
  expect(extraPhaseName("upkeep step",
    "Whenever Obeka deals combat damage to a player, you get that many additional upkeep steps after this phase."))
    .toBe("upkeep");
});

test("Paradox Haze grants the 'upkeep' phase", () => {
  expect(extraPhaseName("additional upkeep step",
    "At the beginning of enchanted player's first upkeep each turn, that player gets an additional upkeep step after this step."))
    .toBe("upkeep");
});

// Y'shtola RHUL (Legendary Creature -- Cat Druid, {4}{U}{U}, released 2025-06-13) -- NOT to be
// confused with Y'shtola, Night's Blessed, a different card sharing only the Final Fantasy
// crossover character's first name. Verified against the corpus: Y'shtola Rhul's stored oracleText
// is exactly this clause, and Y'shtola, Night's Blessed's is entirely unrelated (Vigilance / an end
// step life-loss draw trigger / a noncreature-spell damage-and-lifegain trigger -- no phase or step
// text at all). This is the real "end" witness in the owner's 61-card measurement.
test("Y'shtola Rhul grants the 'end' phase (not to be confused with Y'shtola, Night's Blessed)", () => {
  expect(extraPhaseName("additional end step",
    "At the beginning of your end step, exile target creature you control, then return it to the battlefield under its owner's control. Then if it's the first end step of the turn, there is an additional end step after this step."))
    .toBe("end");
});

// "Untap, Upkeep, Draw" -- a real corpus card, modal ("Choose one"), covering both remaining
// witnesses the 24-action extra-turn/extra-phase family has no example of. Its stored oracleText:
// "Choose one -- * After this phase, there is an additional untap step. * After this phase, there
// is an additional upkeep step. * After this phase, there is an additional draw step. Entwine {3}".
test("'Untap, Upkeep, Draw' grants the 'untap' phase (its untap mode)", () => {
  expect(extraPhaseName("", "After this phase, there is an additional untap step."))
    .toBe("untap");
});

test("'Untap, Upkeep, Draw' grants the 'draw' phase (its draw mode)", () => {
  expect(extraPhaseName("", "After this phase, there is an additional draw step."))
    .toBe("draw");
});

// World at War's own real, stored action object -- "main phase" is the timing anchor for its
// combat grant (see extraUnitKind's comment), but extraPhaseName is tested here in isolation from
// the kind gate to prove the vocabulary itself recognises "main" from real text. In the real
// pipeline this branch is never reached for World at War: its overall kind resolves to
// extra-combat, which never calls extraPhaseName at all (see effectSubject's `kind === "extra-phase"`
// gate in derive.ts).
test("the vocabulary recognises the 'main' phase from real text (World at War's own object)", () => {
  expect(extraPhaseName("main phase", "")).toBe("main");
});

// The closed vocabulary refuses rather than defaults when nothing names a phase -- the same
// discipline `parseCounter` and `extraUnitKind` itself already apply.
test("no named phase leaves extraPhaseName unset", () => {
  expect(extraPhaseName("target opponent", "That player takes an extra turn after this one."))
    .toBeUndefined();
});

// CR 701.10/701.11. `double` and `triple` gained a VERB on 2026-08-15 and needed somewhere to land:
// three of the seven never-produced EFFECT_KINDS are this family, so the labels existed all along.
test("doubling reads WHAT is doubled, because the verb alone cannot say", () => {
  expect(actionEffectKind({ verb: "double", object: "tokens created under your control" })).toBe("token-doubling");
  expect(actionEffectKind({ verb: "double", object: "damage dealt by creatures you control" })).toBe("damage-multiplier");
  expect(actionEffectKind({ verb: "double", object: "counters placed on permanents you control" })).toBe("counter-placement");
  expect(actionEffectKind({ verb: "triple", object: "the tokens" })).toBe("token-doubling");
});

test("doubling something unnamed is refused, not guessed", () => {
  expect(actionEffectKind({ verb: "double", object: "that many instead" })).toBeNull();
});

// THREE OF THE SEVEN NEVER-PRODUCED EFFECT_KINDS, and all three are load-bearing in live product
// code: mechanisms.ts needs copy-spell for spellslinger, forced-sacrifice for aristocrats and
// enters-with-counters for counters; buckets.ts counts forced-sacrifice as a win condition.
test("copying a SPELL is not cloning a permanent", () => {
  expect(actionEffectKind({ verb: "copy", object: "target instant or sorcery spell" })).toBe("copy-spell");
  expect(actionEffectKind({ verb: "copy", object: "that spell" })).toBe("copy-spell");
  // The fallback stays: a permanent copy is a clone.
  expect(actionEffectKind({ verb: "copy", object: "target creature you control" })).toBe("clone");
});

test("a sacrifice is forced only when an OPPONENT performs it", () => {
  // An edict — removal. Your own sacrifice is a cost or an outlet, not removal.
  expect(actionEffectKind({ verb: "sacrifice", object: "each opponent sacrifices a creature" }))
    .toBe("forced-sacrifice");
  expect(actionEffectKind({ verb: "sacrifice", object: "a creature you control" })).toBeNull();
});

test("entering WITH counters is 614.1c, not placing counters later", () => {
  // Threefold Thunderhulk: "This creature enters with three +1/+1 counters on it."
  expect(actionEffectKind({ verb: "add-counter", object: "+1/+1 counters" },
    "This creature enters with three +1/+1 counters on it.")).toBe("enters-with-counters");
  // A trigger that places counters later is ordinary counter-placement.
  expect(actionEffectKind({ verb: "add-counter", object: "+1/+1 counter" },
    "Whenever a creature enters, put a +1/+1 counter on it.")).toBe("counter-placement");
});
