import { expect, test } from "vitest";
import { actionEffectKind } from "./effect-kind.js";

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

  // The rest have no kind in the closed vocabulary and must NOT be given a near-miss: hexproof,
  // indestructible, shroud and ward are the `protection` deck ROLE, which build.ts:126 already
  // derives from oracle text independently of tags. Evasion keywords have no kind at all.
  // effect-kind.ts's own rule: a near-miss kind is worse than null, because it is consumed as true.
  expect(actionEffectKind({ verb: "grant-ability", object: "hexproof and indestructible" })).toBeNull();
  expect(actionEffectKind({ verb: "grant-ability", object: "flying" })).toBeNull();
  expect(actionEffectKind({ verb: "grant-ability", object: "deathtouch" })).toBeNull();
  expect(actionEffectKind({ verb: "grant-ability", object: "" })).toBeNull();
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
