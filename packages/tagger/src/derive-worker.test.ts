import { describe, expect, test } from "vitest";
import { deriveRow } from "./derive-worker.js";
import { grammarClauseRecords } from "./grammar/clause-record.js";
import { deriveCardTags, foldGrantTwins } from "./derive/derive.js";
import { deriveInputOf } from "./derive-input.js";

// #1376: the card-by-card switch also takes the grammar reading when the stored answer IS the grammar's abilities with exact duplicates.
// Nettling Curse: the card document's fields and the stored `cardClauses.canonical` are dumped from Mongo (the model stored "attacks or blocks" as two records numbered 2).
const SOURCE = {"oracleText": "Enchant creature\nWhenever enchanted creature attacks or blocks, its controller loses 3 life.\n{1}{R}: Enchanted creature attacks this turn if able.", "keywords": ["Enchant"], "typeLine": "Enchantment \u2014 Aura", "name": "Nettling Curse", "manaCost": "{2}{B}", "colors": ["B"], "colorIdentity": ["B", "R"], "manaValue": 3, "layout": "normal"};
const STORED = [{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Enchant creature","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"triggered","trigger":{"event":"attacks","subject":"enchanted creature","control":"any"},"actions":[{"verb":"lose-life","object":"its controller","fromZone":null,"toZone":null,"amount":"3","optional":false}]},{"id":2,"abilityType":"triggered","trigger":{"event":"blocks","subject":"enchanted creature","control":"any"},"actions":[{"verb":"lose-life","object":"its controller","fromZone":null,"toZone":null,"amount":"3","optional":false}]},{"id":3,"abilityType":"activated","actions":[{"verb":"cant","object":"Enchanted creature can't not attack this turn if able","fromZone":null,"toZone":null,"amount":null,"optional":false}]}];

test("Nettling Curse: the stored answer is the grammar's abilities with duplicates, so the switch takes the grammar reading", () => {
  expect(grammarClauseRecords(SOURCE as never).complete).toBe(true);
  const stored = deriveRow({ doc: { oracleId: "93d575b3-0fff-4fc6-85c6-3a8a9d672d6f", name: SOURCE.name, canonical: STORED } as never, source: SOURCE, isToken: false });
  expect(stored.fromGrammar).toBe(true);
});

// #1391: the keyword-grant twin fold runs AFTER the switch, on the tags it picks. Sparkspitter (real stored data dumped from Mongo): its grammar reading reads the token's
// "trample, haste" as a keyword-grant pair. Unfolded the diff key is `abilities:2->5` (unlabelled), so the model reading stays; folded first it would be the labelled
// `abilities:2->4` ("grammar right") and the card would switch to a worse reading.
const SPARK = {"name":"Sparkspitter","oracleText":"{R}, {T}, Discard a card: Create a 3/1 red Elemental creature token named Spark Elemental. It has trample, haste, and \"At the beginning of the end step, sacrifice this token.\"","typeLine":"Creature \u2014 Elemental Spellshaper","keywords":[],"manaCost":"{2}{R}","colors":["R"],"colorIdentity":["R"],"manaValue":3,"power":"1","toughness":"3"};
const SPARK_STORED = [{"id":1,"abilityType":"activated","actions":[{"verb":"discard","object":"a card","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"create","object":"a 3/1 red Elemental creature token named Spark Elemental with trample, haste, and this ability","fromZone":null,"toZone":null,"amount":"1","optional":false}]},{"id":2,"abilityType":"triggered","trigger":{"event":"end-step","subject":"you","control":"you"},"actions":[{"verb":"sacrifice","object":"this token","fromZone":null,"toZone":null,"amount":null,"optional":false}]}];
test("Sparkspitter keeps its model reading: the switch keys UNFOLDED readings (#1391)", () => {
  const row = deriveRow({ doc: { oracleId: "0fbec99f-0e49-4211-a06e-edd783cf47da", name: SPARK.name, canonical: SPARK_STORED } as never, source: SPARK, isToken: false });
  expect(row.fromGrammar).toBe(false);
});

test("Colossus of Akros: deriveRow returns folded abilities (the unfolded derive has two keyword-grant twins)", () => {
  const source = { oracleText: "As long as this creature is monstrous, it has trample and can attack as though it didn't have defender.", keywords: [], typeLine: "Artifact Creature \u2014 Golem", name: "Colossus of Akros", manaCost: "{8}", colors: [], colorIdentity: [], manaValue: 8, layout: "normal" };
  const g = grammarClauseRecords(source as never);
  const unfolded = deriveCardTags(deriveInputOf(source as never, "x", source.name, g.records, undefined, g.readings), { foldGrantTwins: false });
  expect(unfolded.abilities.filter((a) => a.effect?.kind === "keyword-grant")).toHaveLength(2);
  const row = deriveRow({ doc: { oracleId: "x", name: source.name, canonical: g.records } as never, source, isToken: false });
  expect(row.tags.abilities.filter((a) => a.effect?.kind === "keyword-grant")).toHaveLength(1);
  expect(row.tags.abilities).toEqual(foldGrantTwins(unfolded.abilities));
});

// #1391 F2 review: "you and <player> each draw", through the pipeline's row (the model's stored answer, or the grammar's when the switch takes it). Oracle text and stored records dumped from Mongo 2026-10-28.
const act = (verb: string, object: string, amount: string | null = null) => ({ verb, object, amount, fromZone: null, toZone: null, optional: false });
const drawers = (source: { name: string; oracleText: string; typeLine: string; keywords: string[] }, canonical: unknown[], verb = "draw") => {
  const row = deriveRow({ doc: { oracleId: "x", name: source.name, canonical } as never, source: source as never, isToken: false });
  return row.tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject.control);
};
test("Diviner Spirit and Black Widow: the damaged player's draw is never `you` (F2 review)", () => {
  const diviner = { name: "Diviner Spirit", typeLine: "Creature \u2014 Spirit", keywords: [], oracleText: "Whenever this creature deals combat damage to a player, you and that player each draw that many cards." };
  expect(drawers(diviner, [{ id: 1, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this creature", control: "you" }, actions: [act("draw", "you", "that many"), act("draw", "that player", "that many")] }])).toEqual(["any", "any"]);
  const widow = { name: "Black Widow, Intel Expert", typeLine: "Legendary Creature \u2014 Human Spy Hero", keywords: ["First strike"], oracleText: "First strike\nWhenever Black Widow deals combat damage to an opponent, you and that player each draw two cards." };
  expect(drawers(widow, [{ id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this creature", control: "you" }, actions: [act("draw", "you", "2"), act("draw", "that player", "2")] }])).toEqual(["any", "any"]);
});
test("Cait, Cage Brawler: the defending player's draw and discard are theirs, not yours (F2 review)", () => {
  const cait = { name: "Cait, Cage Brawler", typeLine: "Legendary Creature \u2014 Human Warrior", keywords: [], oracleText: "During your turn, Cait has indestructible.\nWhenever Cait attacks, you and defending player each draw a card, then discard a card. Put two +1/+1 counters on Cait if you discarded the card with the greatest mana value among those cards or tied for greatest." };
  const stored = [{ id: 1, abilityType: "static", actions: [act("grant-ability", "indestructible")] }, { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [act("draw", "you"), act("draw", "defending player"), act("discard", "you"), act("discard", "defending player"), act("add-counter", "+1/+1", "2")] }];
  expect(drawers(cait, stored)).toEqual(["you", "opp"]);
  expect(drawers(cait, stored, "discard")).toEqual(["you", "opp"]);
});

// #1391 F3: one printed "search <whose> graveyard, hand, and library for X" is ONE search ability (the store, and the grammar's own records, write one search action per zone).
// Oracle text and stored records dumped from Mongo 2026-10-28.
const zoneSearch = (object: string, zone: string, toZone: string | null = null) => ({ verb: "search", object, fromZone: zone, toZone, amount: null, optional: false });
const searchesOf = (source: { name: string; oracleText: string; typeLine: string; keywords: string[] }, canonical: unknown[]) =>
  deriveRow({ doc: { oracleId: "x", name: source.name, canonical } as never, source: source as never, isToken: false }).tags.abilities.filter((a) => a.effect?.kind === "search");
test("Eradicate (grammar records): one search, carrying the library search", () => {
  const source = { name: "Eradicate", typeLine: "Sorcery", keywords: [], oracleText: "Exile target nonblack creature. Search its controller's graveyard, hand, and library for all cards with the same name as that creature and exile them. Then that player shuffles." };
  const g = grammarClauseRecords(source as never);
  const searches = searchesOf(source, g.records as never);
  expect(searches).toHaveLength(1);
  expect(searches[0]!.librarySearch).toBeDefined();
});
test("Extirpate (stored records): one search, not three", () => {
  const source = { name: "Extirpate", typeLine: "Instant", keywords: ["Split second"], oracleText: "Split second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nChoose target card in a graveyard other than a basic land card. Search its owner's graveyard, hand, and library for all cards with the same name as that card and exile them. Then that player shuffles." };
  const o = "all cards with the same name as target card";
  const stored = [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Split second" }] }, { id: 2, abilityType: "spell", actions: [zoneSearch(o, "graveyard"), zoneSearch(o, "hand"), zoneSearch(o, "library"), { verb: "exile", object: o, fromZone: null, toZone: "exile" }, { verb: "shuffle", object: "that player's library", fromZone: null, toZone: null }] }];
  expect(searchesOf(source, stored)).toHaveLength(1);
});
test("Kassandra, Eagle Bearer (stored records): one search, the library one, yours, onto the battlefield", () => {
  const source = { name: "Kassandra, Eagle Bearer", typeLine: "Legendary Creature \u2014 Human Assassin Warrior", keywords: ["Haste"], oracleText: "Haste\nWhen Kassandra enters, search your graveyard, hand, and library for a card named The Spear of Leonidas, put it onto the battlefield, then shuffle.\nWhenever a creature you control with a legendary Equipment attached to it deals combat damage to a player, draw a card." };
  const o = "a card named The Spear of Leonidas";
  const stored = [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Haste" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "Kassandra, Eagle Bearer", control: "you" }, actions: [zoneSearch(o, "graveyard"), zoneSearch(o, "hand"), zoneSearch(o, "library"), { verb: "put", object: o, fromZone: null, toZone: "battlefield" }, { verb: "shuffle", object: "your library", fromZone: null, toZone: null }] },
    { id: 3, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "a creature you control with a legendary Equipment attached to it", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] }];
  const searches = searchesOf(source, stored);
  expect(searches).toHaveLength(1);
  expect(searches[0]!.librarySearch).toBe("yours");
});
test("Increasing Ambition: two separately printed searches in one clause stay two", () => {
  const source = { name: "Increasing Ambition", typeLine: "Sorcery", keywords: ["Flashback"], oracleText: "Search your library for a card and put that card into your hand. If this spell was cast from a graveyard, instead search your library for two cards and put those cards into your hand. Then shuffle.\nFlashback {7}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)" };
  const stored = [{ id: 1, abilityType: "spell", actions: [zoneSearch("your library for a card", "library"), { verb: "put", object: "that card into your hand", fromZone: "library", toZone: "hand" }, zoneSearch("your library for two cards", "library"), { verb: "put", object: "those cards into your hand", fromZone: "library", toZone: "hand" }, { verb: "shuffle", object: "your library", fromZone: null, toZone: null }] }, { id: 2, abilityType: "none", actions: [{ verb: "none", object: "Flashback {7}{B}" }] }];
  expect(searchesOf(source, stored)).toHaveLength(2);
});


// #1391 F3 review: the zone-search collapse, like the grant-twin fold, applies to the tags the switch picks and never to the readings it compares (it flipped Finale of Devastation to a
// grammar reading whose enters emit claims the library only, and Chandra's Flame Wave to one that splits its damage). Real record dumped from Mongo 2026-10-28.
test("Finale of Devastation keeps its model reading, with one search (the switch compares uncollapsed readings)", () => {
  const source = { name: "Finale of Devastation", typeLine: "Sorcery", keywords: [], oracleText: "Search your library and/or graveyard for a creature card with mana value X or less and put it onto the battlefield. If you search your library this way, shuffle. If X is 10 or more, creatures you control get +X/+X and gain haste until end of turn." };
  const stored = [{ id: 1, abilityType: "spell", actions: [zoneSearch("your library and/or graveyard", null as never), { verb: "put", object: "a creature card with mana value X or less", fromZone: null, toZone: "battlefield" }, { verb: "shuffle", object: "your library", fromZone: null, toZone: null }, { verb: "modify-pt", object: "creatures you control", amount: "+X/+X" }, { verb: "grant-ability", object: "creatures you control" }] }];
  const row = deriveRow({ doc: { oracleId: "x", name: source.name, canonical: stored } as never, source: source as never, isToken: false });
  expect(row.fromGrammar).toBe(false);
  expect(row.tags.abilities.filter((a) => a.effect?.kind === "search")).toHaveLength(1);
});

// #1391 F4: an "instead" branch that repeats the base branch's ability exactly is one ability, folded AFTER the switch like the grant twins. Oracle text and stored records dumped from Mongo 2026-10-28.
const F4 = {"Grow from the Ashes":{"source":{"name":"Grow from the Ashes","typeLine":"Sorcery","keywords":["Kicker"],"oracleText":"Kicker {2} (You may pay an additional {2} as you cast this spell.)\nSearch your library for a basic land card, put it onto the battlefield, then shuffle. If this spell was kicked, instead search your library for two basic land cards, put them onto the battlefield, then shuffle."},"canonical":[{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Kicker {2}","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"spell","actions":[{"verb":"search","object":"your library for a basic land card","fromZone":"library","toZone":null,"amount":null,"optional":false},{"verb":"put","object":"a basic land card","fromZone":"library","toZone":"battlefield","amount":null,"optional":false},{"verb":"shuffle","object":"your library","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"search","object":"your library for two basic land cards","fromZone":"library","toZone":null,"amount":null,"optional":false},{"verb":"put","object":"two basic land cards","fromZone":"library","toZone":"battlefield","amount":null,"optional":false},{"verb":"shuffle","object":"your library","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]},"Primal Growth":{"source":{"name":"Primal Growth","typeLine":"Sorcery","keywords":["Kicker"],"oracleText":"Kicker—Sacrifice a creature. (You may sacrifice a creature in addition to any other costs as you cast this spell.)\nSearch your library for a basic land card, put that card onto the battlefield, then shuffle. If this spell was kicked, instead search your library for up to two basic land cards, put them onto the battlefield, then shuffle."},"canonical":[{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Kicker—Sacrifice a creature.","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"spell","actions":[{"verb":"search","object":"your library for a basic land card","fromZone":"library","toZone":null,"amount":null,"optional":false},{"verb":"put","object":"that card","fromZone":"library","toZone":"battlefield","amount":null,"optional":false},{"verb":"shuffle","object":"your library","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"search","object":"your library for up to two basic land cards","fromZone":"library","toZone":null,"amount":"up to two","optional":false},{"verb":"put","object":"them","fromZone":"library","toZone":"battlefield","amount":null,"optional":false},{"verb":"shuffle","object":"your library","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]},"Bane's Contingency":{"source":{"name":"Bane's Contingency","typeLine":"Instant","keywords":["Scry"],"oracleText":"Counter target spell. If that spell targets a commander you control, instead counter that spell, scry 2, then draw a card."},"canonical":[{"id":1,"abilityType":"spell","actions":[{"verb":"counter-spell","object":"target spell","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"scry","object":"2","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"draw","object":"a card","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]},"Academy Manufactor":{"source":{"name":"Academy Manufactor","typeLine":"Artifact Creature — Assembly-Worker","keywords":["Treasure","Food"],"oracleText":"If you would create a Clue, Food, or Treasure token, instead create one of each."},"canonical":[{"id":1,"abilityType":"static","actions":[{"verb":"create","object":"a Clue token","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"create","object":"a Food token","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"create","object":"a Treasure token","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]},"Wicked Slumber":{"source":{"name":"Wicked Slumber","typeLine":"Instant","keywords":["Convoke"],"oracleText":"Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\nTap up to two target creatures. Put a stun counter on either of them. Then put a stun counter on either of them. (If a permanent with a stun counter would become untapped, remove one from it instead.)"},"canonical":[{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Convoke","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"spell","actions":[{"verb":"tap","object":"up to two target creatures","optional":false,"fromZone":null,"toZone":null},{"verb":"add-counter","object":"stun","optional":false,"fromZone":null,"toZone":null},{"verb":"add-counter","object":"stun","optional":false,"fromZone":null,"toZone":null}]}]}} as Record<string, { source: { name: string; typeLine: string; keywords: string[]; oracleText: string }; canonical: unknown[] }>;
const f4Row = (name: string, path: "model" | "grammar") => deriveRow({ doc: { oracleId: "x", name, canonical: path === "model" ? F4[name]!.canonical : grammarClauseRecords(F4[name]!.source as never).records } as never, source: F4[name]!.source as never, isToken: false });
const withEmit = (row: ReturnType<typeof deriveRow>, verb: string) => row.tags.abilities.filter((a) => (a.emits ?? []).some((e) => e.verb === verb));
test("Grow from the Ashes (model) and Primal Growth (grammar): one shuffle, not one per branch", () => {
  expect(withEmit(f4Row("Grow from the Ashes", "model"), "shuffle")).toHaveLength(1);
  expect(withEmit(f4Row("Primal Growth", "grammar"), "shuffle")).toHaveLength(1);
});
test("Bane's Contingency: one counter-spell; Academy Manufactor: one token-doubling", () => {
  expect(withEmit(f4Row("Bane's Contingency", "model"), "counter-spell")).toHaveLength(1);
  expect(f4Row("Academy Manufactor", "model").tags.abilities.filter((a) => a.effect?.kind === "token-doubling")).toHaveLength(1);
});
test("Wicked Slumber (negative control): no 'instead' reaches its clause text, so the two stun counters stay two", () => {
  expect(f4Row("Wicked Slumber", "model").tags.abilities.filter((a) => a.effect?.kind === "counter-placement")).toHaveLength(2);
});
test("the switch decides on unfolded readings: fromGrammar is as at derive 405", () => {
  expect(["Grow from the Ashes", "Primal Growth", "Bane's Contingency", "Academy Manufactor"].map((n) => f4Row(n, "model").fromGrammar)).toEqual([false, true, true, false]);
});

// The fold strips parenthesised text itself (segment() already drops reminder text, so this is the only place it fires): an "instead" in parentheses is no alternative.
test("foldGrantTwins: an 'instead' only in parentheses folds nothing; outside them it folds the identical twin (#1391 F4)", () => {
  const twin = { kind: "on-cast", effect: { kind: "" }, emits: [{ verb: "shuffle", subject: { control: "you", token: null } }], clause: 1, repeats: "once" } as never;
  expect(foldGrantTwins([twin, twin], { 1: "Shuffle. Then shuffle. (If it would untap, remove one instead.)" })).toHaveLength(2);
  expect(foldGrantTwins([twin, twin], { 1: "Shuffle. If kicked, instead shuffle." })).toHaveLength(1);
});

// #1391 F5-F7 (oracle text and stored records dumped from Mongo 2026-10-28).
const F567 = {"Arachnus Web":{"source":{"name":"Arachnus Web","typeLine":"Enchantment — Aura","keywords":["Enchant"],"oracleText":"Enchant creature\nEnchanted creature can't attack or block, and its activated abilities can't be activated.\nAt the beginning of the end step, if enchanted creature's power is 4 or greater, destroy this Aura."},"canonical":[{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Enchant creature","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"static","actions":[{"verb":"cant","object":"attack","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"cant","object":"block","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"cant","object":"activated abilities be activated","fromZone":null,"toZone":null,"amount":null,"optional":false}]},{"id":3,"abilityType":"triggered","trigger":{"event":"end-step","subject":"you","control":"you"},"actions":[{"verb":"destroy","object":"this Aura","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]},"Faith's Fetters":{"source":{"name":"Faith's Fetters","typeLine":"Enchantment — Aura","keywords":["Enchant"],"oracleText":"Enchant permanent\nWhen this Aura enters, you gain 4 life.\nEnchanted permanent can't attack or block, and its activated abilities can't be activated unless they're mana abilities."},"canonical":[{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Enchant permanent","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"triggered","trigger":{"event":"enters","subject":"this","control":"you"},"actions":[{"verb":"gain-life","object":"you","fromZone":null,"toZone":null,"amount":"4","optional":false}]},{"id":3,"abilityType":"static","actions":[{"verb":"cant","object":"attack","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"cant","object":"block","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"cant","object":"activate activated abilities unless they're mana abilities","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]},"Juniper Order Ranger":{"source":{"name":"Juniper Order Ranger","typeLine":"Creature — Human Knight Ranger","keywords":[],"oracleText":"Whenever another creature you control enters, put a +1/+1 counter on that creature and a +1/+1 counter on this creature."},"canonical":[{"id":1,"abilityType":"triggered","trigger":{"event":"enters","subject":"another creature you control","control":"you"},"actions":[{"verb":"add-counter","object":"+1/+1","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"add-counter","object":"+1/+1","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]},"Sumala Sentry":{"source":{"name":"Sumala Sentry","typeLine":"Creature — Elf Archer","keywords":["Reach"],"oracleText":"Reach\nWhenever a face-down permanent you control is turned face up, put a +1/+1 counter on it and a +1/+1 counter on this creature."},"canonical":[{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Reach","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"triggered","trigger":{"event":"turned-face-up","subject":"a face-down permanent you control","control":"you"},"actions":[{"verb":"add-counter","object":"+1/+1","fromZone":null,"toZone":null,"amount":"1","optional":false},{"verb":"add-counter","object":"+1/+1","fromZone":null,"toZone":null,"amount":"1","optional":false}]}]},"Primal Clay":{"source":{"name":"Primal Clay","typeLine":"Artifact Creature — Shapeshifter","keywords":[],"oracleText":"As this creature enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact creature with flying, or a 1/6 Wall artifact creature with defender in addition to its other types. (A creature with defender can't attack.)"},"canonical":[{"id":1,"abilityType":"static","actions":[{"verb":"animate","object":"this creature becomes your choice of a 3/3 artifact creature, a 2/2 artifact creature with flying, or a 1/6 Wall artifact creature with defender in addition to its other types","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]},"Aquamorph Entity":{"source":{"name":"Aquamorph Entity","typeLine":"Creature — Shapeshifter","keywords":["Morph"],"oracleText":"As this creature enters or is turned face up, it becomes your choice of 5/1 or 1/5.\nMorph {2}{U} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)"},"canonical":[{"id":1,"abilityType":"static","actions":[{"verb":"animate","object":"this creature","fromZone":null,"toZone":null,"amount":null,"optional":false}]},{"id":2,"abilityType":"none","actions":[{"verb":"none","object":"Morph {2}{U}","fromZone":null,"toZone":null}]}]},"Molten Sentry":{"source":{"name":"Molten Sentry","typeLine":"Creature — Elemental","keywords":[],"oracleText":"As this creature enters, flip a coin. If the coin comes up heads, this creature enters as a 5/2 creature with haste. If it comes up tails, this creature enters as a 2/5 creature with defender."},"canonical":[{"id":1,"abilityType":"static","actions":[{"verb":"flip-coin","object":"a coin","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"animate","object":"this creature as a 5/2 creature with haste","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"animate","object":"this creature as a 2/5 creature with defender","fromZone":null,"toZone":null,"amount":null,"optional":false}]}]}} as Record<string, { source: { name: string; typeLine: string; keywords: string[]; oracleText: string }; canonical: unknown[] | null }>;
const f567 = (name: string, path: "model" | "grammar") => deriveRow({ doc: { oracleId: "x", name, canonical: path === "model" ? F567[name]!.canonical : grammarClauseRecords(F567[name]!.source as never).records } as never, source: F567[name]!.source as never, isToken: false });
const kinds = (row: ReturnType<typeof deriveRow>) => row.tags.abilities.map((a) => a.effect?.kind).filter((k) => k === "restriction" || k === "ability-loss").sort();

// F7: "can't attack or block, and its activated abilities can't be activated" is ONE restriction and ONE ability-loss.
test("Arachnus Web (stored attack / block / activated-abilities actions): one restriction, one ability-loss", () => {
  expect(kinds(f567("Arachnus Web", "model"))).toEqual(["ability-loss", "restriction"]);
});
test("Faith's Fetters (grammar): the 'unless they're mana abilities' rider is the ability-loss's alone, so the restriction derives", () => {
  expect(kinds(f567("Faith's Fetters", "grammar"))).toEqual(["ability-loss", "restriction"]);
});

// F5: "put a +1/+1 counter on that creature and a +1/+1 counter on this creature" is one placement on the trigger's creature and one on the card itself.
const counterEmits = (row: ReturnType<typeof deriveRow>) => row.tags.abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "counter-added").map((e) => e.subject.self === true));
test("Juniper Order Ranger (grammar) and Sumala Sentry (stored): one counter on the trigger's permanent, one on self", () => {
  expect(counterEmits(f567("Juniper Order Ranger", "grammar"))).toEqual([false, true]);
  expect(counterEmits(f567("Sumala Sentry", "model"))).toEqual([false, true]);
});

// F6: "it becomes your choice of A, B, or C" is one either/or animate; the grammar writes one animate action per alternative, folded as an "instead" twin is.
test("Primal Clay and Aquamorph Entity (grammar): one animate, not one per alternative; Molten Sentry's coin flip is one too (#1401 F)", () => {
  expect(f567("Primal Clay", "grammar").tags.abilities.filter((a) => a.effect?.kind === "animate")).toHaveLength(1);
  expect(f567("Aquamorph Entity", "grammar").tags.abilities.filter((a) => a.effect?.kind === "animate")).toHaveLength(1);
  expect(f567("Molten Sentry", "model").tags.abilities.filter((a) => a.effect?.kind === "animate")).toHaveLength(1);
});

// F7 review: two SEPARATE restrictions in one clause keep both (only a reading covering BOTH words makes a stored bare combat action redundant). Synthetic Auras: no corpus card has the shape.
describe("separate can't-attack / can't-block restrictions both survive (#1391 F7 review)", () => {
  const cant = (o: string) => ({ verb: "cant", object: o, fromZone: null, toZone: null, optional: false });
  const restricts = (row: ReturnType<typeof deriveRow>) => row.tags.abilities.filter((a) => a.effect?.kind === "restriction").flatMap((a) => a.restricts ?? []).sort();
  for (const sentence of ["Enchanted creature can't attack. Enchanted creature can't block.", "Enchanted creature can't attack, and it can't block."]) {
    test(sentence, () => {
      const source = { name: "Synthetic Aura", typeLine: "Enchantment — Aura", keywords: [] as string[], oracleText: `Enchant creature\n${sentence}` };
      const model = deriveRow({ doc: { oracleId: "x", name: source.name, canonical: [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] }, { id: 2, abilityType: "static", actions: [cant("attack"), cant("block")] }] } as never, source: source as never, isToken: false });
      expect(restricts(model)).toEqual(["attack", "block"]);
      const grammar = deriveRow({ doc: { oracleId: "x", name: source.name, canonical: grammarClauseRecords(source as never).records } as never, source: source as never, isToken: false });
      expect(restricts(grammar)).toEqual(["attack", "block"]);
    });
  }
});

// #1403: a stored amount that resolves a back-reference ("that much") reaches the grammar's reading too, and a trigger quantifier stored as an amount ("one or more") is no count. Real oracle text and
// stored records dumped from Mongo 2026-10-29. Without the carry these cards un-switched onto the stored answer (Cryptcaller lost `trigger.batched`).
describe("a stored amount rides on the grammar's back-reference (#1403)", () => {
  const CRYPT = { name: "Cryptcaller Chariot", typeLine: "Artifact — Vehicle", oracleText: "Menace\nWhenever you discard one or more cards, create that many tapped 2/2 black Zombie creature tokens.\nCrew 2", keywords: ["Crew", "Menace"] };
  const CRYPT_STORED = [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Menace", fromZone: null, toZone: null }] }, { id: 2, abilityType: "triggered", trigger: { event: "discarded", subject: "a card", control: "you" }, actions: [{ verb: "create", object: "tapped 2/2 black Zombie creature tokens", fromZone: null, toZone: null, amount: "one or more", optional: false }] }, { id: 3, abilityType: "none", actions: [{ verb: "none", object: "Crew 2", fromZone: null, toZone: null }] }];
  const DRAGON = { name: "Dragonspark Reactor", typeLine: "Artifact", oracleText: "Whenever this artifact or another artifact you control enters, put a charge counter on this artifact.\n{4}, Sacrifice this artifact: It deals damage equal to the number of charge counters on it to target player and that much damage to up to one target creature.", keywords: [] as string[] };
  const dmg = (n: string) => ({ verb: "deal-damage", object: n, fromZone: null, toZone: null, amount: "the number of charge counters on this artifact", optional: false });
  const DRAGON_STORED = [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this artifact or another artifact you control", control: "you" }, actions: [{ verb: "add-counter", object: "charge counter", fromZone: null, toZone: null, amount: null, optional: false }] }, { id: 2, abilityType: "activated", actions: [{ verb: "sacrifice", object: "this artifact", fromZone: null, toZone: null, amount: null, optional: false }, dmg("target player"), dmg("up to one target creature")] }];

  test("Cryptcaller Chariot stays on the grammar, keeps its batched trigger, and does not take 'one or more' as an amount", () => {
    const row = deriveRow({ doc: { oracleId: "2bdd0bcb", name: CRYPT.name, canonical: CRYPT_STORED } as never, source: CRYPT, isToken: false });
    expect(row.fromGrammar).toBe(true);
    expect(row.tags.abilities.some((a) => a.trigger?.batched === true)).toBe(true);
    expect(row.tags.abilities.map((a) => a.amount)).not.toContain("one or more");
  });

  test("Dragonspark Reactor stays on the grammar and gains the scaled 'that much'", () => {
    const row = deriveRow({ doc: { oracleId: "a8acb0b0", name: DRAGON.name, canonical: DRAGON_STORED } as never, source: DRAGON, isToken: false });
    expect(row.fromGrammar).toBe(true);
    const dmgs = row.tags.abilities.filter((a) => a.effect?.kind === "damage");
    expect(dmgs.length).toBeGreaterThan(1);
    expect(dmgs.every((a) => a.count?.scalesWith !== undefined)).toBe(true);
  });
});

// #1401: one printed object, one action, and the subject is the object THAT action names. Real oracle text dumped from Mongo 2026-10-30; both derive from the grammar.
describe("each printed object gets its own subject (#1401)", () => {
  const TURTLE = { name: "Dragon Turtle", typeLine: "Creature — Turtle Dragon", keywords: ["Flash"], oracleText: "Flash\nDrag Below — When this creature enters, tap it and up to one target creature an opponent controls. They don't untap during their controllers' next untap steps." };
  const grammarRow = (source: typeof TURTLE) => deriveRow({ doc: { oracleId: "x", name: source.name, canonical: grammarClauseRecords(source as never).records } as never, source: source as never, isToken: false });
  const emitsOf = (row: ReturnType<typeof deriveRow>, verb: string) => row.tags.abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === verb));
  const noDuplicateAbilities = (row: ReturnType<typeof deriveRow>) => { const j = row.tags.abilities.map((a) => JSON.stringify(a)); return new Set(j).size === j.length; };

  test("Dragon Turtle: 'tap it and up to one target creature an opponent controls' is a tap of the card and a tap of the opponent's target, not the target twice", () => {
    const records = grammarClauseRecords(TURTLE as never).records;
    expect(records[1]!.actions!.filter((a) => a.verb === "tap").map((a) => a.object)).toEqual(["this creature", "up to one target creature an opponent controls"]);
    const row = grammarRow(TURTLE);
    expect(row.fromGrammar).toBe(true);
    // The card's own tap is no `taps` event (no scope: tapVerbs), so only the opponent's target emits one, once.
    const taps = emitsOf(row, "taps");
    expect(taps).toHaveLength(1);
    expect(taps[0]!.subject).toMatchObject({ control: "opp", type: "creature", scope: "target" });
    expect(noDuplicateAbilities(row)).toBe(true);
  });

  // "it" here is the tapped target, NOT the card (in Dragon Turtle's text it is the card): the antecedent comes from the sentence.
  const WALL = { name: "Sanctuary Wall", typeLine: "Artifact Creature — Wall", keywords: ["Defender"], oracleText: "Defender\n{2}{W}, {T}: Tap target creature. You may put a stun counter on it. If you do, put a stun counter on this creature. (If a permanent with a stun counter would become untapped, remove one from it instead.)" };
  test("Sanctuary Wall: the first stun counter goes on the tapped target, the second on the card itself", () => {
    const row = grammarRow(WALL as never);
    expect(row.fromGrammar).toBe(true);
    const counters = emitsOf(row, "counter-added");
    expect(counters.map((e) => e.subject.self === true)).toEqual([false, true]);
    expect(emitsOf(row, "taps")).toHaveLength(1);
    expect(noDuplicateAbilities(row)).toBe(true);
  });

  // The cut is for a second phrase that names the card; a second phrase that is a pronoun takes its antecedent from the phrase before it (oracle text dumped from Mongo 2026-10-30).
  test("Elder Cathar: 'it' in 'put two +1/+1 counters on it instead' is the target, not the card", () => {
    const elder = { name: "Elder Cathar", typeLine: "Creature — Human Cleric", keywords: [], oracleText: "When this creature dies, put a +1/+1 counter on target creature you control. If that creature is a Human, put two +1/+1 counters on it instead." };
    expect(emitsOf(grammarRow(elder as never), "counter-added").map((e) => e.subject.self === true)).not.toContain(true);
  });
  test("Communal Brewing: 'put an ingredient counter on it' after 'on this enchantment' is still the card", () => {
    const brew = { name: "Communal Brewing", typeLine: "Enchantment", keywords: [], oracleText: "When this enchantment enters, any number of target opponents each draw a card. Put an ingredient counter on this enchantment, then put an ingredient counter on it for each card drawn this way.\nWhenever you cast a creature spell, that creature enters with X additional +1/+1 counters on it, where X is the number of ingredient counters on this enchantment." };
    expect(emitsOf(grammarRow(brew as never), "counter-added").map((e) => e.subject.self === true)).toContain(true);
  });
});

// #1401 part 3 (family B): a bought record that writes ONE printed action twice derives JSON-identical abilities; the fold counts the clause's printed VERB (oracle text and stored records dumped from Mongo 2026-10-30).
const B_ACT = (verb: string, object: string, extra: Record<string, unknown> = {}) => ({ verb, object, fromZone: null, toZone: null, amount: null, optional: false, ...extra });
const B_CARDS: Record<string, { oracleText: string; typeLine: string; keywords?: string[]; canonical: unknown[]; expect: Record<string, number> }> = {
  "Chimeric Coils": { oracleText: "{X}{1}: This artifact becomes an X/X Construct artifact creature. Sacrifice it at the beginning of the next end step.", typeLine: "Artifact",
    canonical: [{ id: 1, abilityType: "activated", actions: [B_ACT("sacrifice", "this"), B_ACT("animate", "this", { amount: "X/X" }), B_ACT("sacrifice", "this")] }], expect: { sacrifice: 1 } },
  "Ether": { oracleText: "{T}, Exile this artifact: Add {U}. When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.", typeLine: "Artifact",
    canonical: [{ id: 1, abilityType: "activated", actions: [B_ACT("exile", "this artifact"), B_ACT("add-mana", "{U}")] }, { id: 2, abilityType: "triggered", trigger: { event: "cast", subject: "an instant or sorcery spell", control: "you" }, actions: [B_ACT("copy", "that spell"), B_ACT("copy", "that spell", { optional: true })] }], expect: { copy: 1 } },
  "Thunderous Debut": { oracleText: "Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nLook at the top twenty cards of your library. You may reveal up to two creature cards from among them. If this spell was bargained, put the revealed cards onto the battlefield. Otherwise, put the revealed cards into your hand. Then shuffle.", typeLine: "Sorcery", keywords: ["Bargain"],
    canonical: [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Bargain" }] }, { id: 2, abilityType: "spell", actions: [B_ACT("shuffle", "your library"), B_ACT("reveal", "up to two creature cards from the top twenty cards of your library", { optional: true }), B_ACT("put", "the revealed cards", { fromZone: "library", toZone: "battlefield" }), B_ACT("put", "the revealed cards", { fromZone: "library", toZone: "hand" }), B_ACT("shuffle", "your library")] }], expect: { shuffle: 1 } },
  "Phyrexian Portal": { oracleText: "{3}: If your library has ten or more cards in it, target opponent looks at the top ten cards of your library and separates them into two face-down piles. Exile one of those piles. Search the other pile for a card, put it into your hand, then shuffle the rest of that pile into your library.", typeLine: "Artifact",
    canonical: [{ id: 1, abilityType: "activated", actions: [B_ACT("shuffle", "your library"), B_ACT("exile", "one pile", { fromZone: "library", toZone: "exile" }), B_ACT("search", "the other pile", { fromZone: "library" }), B_ACT("put", "a card", { fromZone: "library", toZone: "hand" }), B_ACT("shuffle", "the rest of that pile into your library")] }], expect: { shuffle: 1 } },
  // Correct repeats: the printed text names the verb as often as the record does.
  "This Is How It Ends": { oracleText: "Target creature's owner shuffles it into their library, then faces a villainous choice — They lose 5 life, or they shuffle another creature they own into their library.", typeLine: "Sorcery",
    canonical: [{ id: 1, abilityType: "spell", actions: [B_ACT("put", "target creature", { fromZone: "battlefield", toZone: "library" }), B_ACT("shuffle", "library"), B_ACT("face-a-villainous-choice", "target creature's owner"), B_ACT("lose-life", "target creature's owner", { amount: "5", optional: true }), B_ACT("put", "another creature they own", { fromZone: "battlefield", toZone: "library", optional: true }), B_ACT("shuffle", "library", { optional: true })] }], expect: { shuffle: 2 } },
  "Telling Time": { oracleText: "Look at the top three cards of your library. Put one of those cards into your hand, one on top of your library, and one on the bottom of your library.", typeLine: "Instant",
    canonical: [{ id: 1, abilityType: "spell", actions: [B_ACT("put", "one of the top three cards of your library", { fromZone: "library", toZone: "hand" }), B_ACT("put", "one of the top three cards of your library", { fromZone: "library", toZone: "library" }), B_ACT("put", "one of the top three cards of your library", { fromZone: "library", toZone: "library" })] }], expect: { put: 3 } },
  "Ransack": { oracleText: "Look at the top five cards of target player's library. Put any number of them on the bottom of that library in any order and the rest on top of the library in any order.", typeLine: "Sorcery",
    canonical: [{ id: 1, abilityType: "spell", actions: [B_ACT("put", "any number of the top five cards of target player's library", { fromZone: "library", toZone: "library", optional: true }), B_ACT("put", "the rest of the top five cards of target player's library", { fromZone: "library", toZone: "library" })] }], expect: { put: 2 } },
};
const bRow = (name: string) => { const c = B_CARDS[name]!; return deriveRow({ doc: { oracleId: "x", name, canonical: c.canonical } as never, source: { name, oracleText: c.oracleText, typeLine: c.typeLine, keywords: c.keywords ?? [] } as never, isToken: false }); };
describe("identical twins of one printed verb fold (#1401 family B)", () => {
  // The count of emits per verb the card keeps: a twin pair reads 2 before the fold.
  const emitCount = (name: string, verb: string) => bRow(name).tags.abilities.reduce((n, a) => n + (a.emits ?? []).filter((e) => e.verb === verb).length, 0);
  test.each([["Chimeric Coils", "sacrifice"], ["Ether", "copy"], ["Thunderous Debut", "shuffle"], ["Phyrexian Portal", "shuffle"]])("%s: one printed %s, one ability", (name, verb) => {
    expect(emitCount(name, verb)).toBe(B_CARDS[name]!.expect[verb]);
  });
  test("This Is How It Ends: two printed shuffles stay two", () => {
    expect(emitCount("This Is How It Ends", "shuffle")).toBe(2);
  });
  test.each([["Telling Time", 3], ["Ransack", 2]])("%s: a top-set repeat has no verb to count, so it stays (%i abilities)", (name, n) => {
    expect(bRow(name).tags.abilities).toHaveLength(n);
  });
});

// #1401 part 4 family A: one clause puts counters on the card AND on another object. All three are model rows: the stored add-counter object holds only the counter kind, so the
// recipient comes from the printed text. Oracle text and stored records dumped from Mongo 2026-10-30.
describe("a counter clause with two recipients reads each recipient (#1401 part 4)", () => {
  const ac = (object: string, amount: string | null = null) => ({ verb: "add-counter", object, amount, fromZone: null, toZone: null, optional: false });
  const row = (source: { name: string; oracleText: string; typeLine: string; keywords: string[] }, canonical: unknown[]) =>
    deriveRow({ doc: { oracleId: "x", name: source.name, canonical } as never, source: source as never, isToken: false });
  const added = (r: ReturnType<typeof row>) => r.tags.abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "counter-added"));
  const noDup = (r: ReturnType<typeof row>) => { const j = r.tags.abilities.map((a) => JSON.stringify(a)); return new Set(j).size === j.length; };

  test("Sinister Concierge: the first 'it' is the card just exiled, the second 'it' the target just exiled", () => {
    const src = { name: "Sinister Concierge", typeLine: "Creature — Human Wizard", keywords: [], oracleText: "When this creature dies, you may exile it and put three time counters on it. If you do, exile up to one target creature and put three time counters on it. Each card exiled this way that doesn't have suspend gains suspend. (For each card with suspend, its owner removes a time counter from it at the beginning of their upkeep. When the last is removed, they may cast it without paying its mana cost. Those creature spells have haste.)" };
    const r = row(src, [{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "you" }, actions: [{ ...ac("this creature"), verb: "exile", fromZone: "battlefield", toZone: "exile", optional: true }, ac("time", "3"), { ...ac("up to one target creature"), verb: "exile", fromZone: "battlefield", toZone: "exile" }, ac("time", "3"), { ...ac("suspend"), verb: "grant-ability" }] }]);
    expect(added(r).map((e) => e.subject.self === true)).toEqual([true, false]);
    expect(noDup(r)).toBe(true);
  });

  test("Arwen: the first +1/+1 and lifelink go on the other creature, the second pair on Arwen", () => {
    const src = { name: "Arwen, Mortal Queen", typeLine: "Legendary Creature — Elf Noble", keywords: [], oracleText: "Arwen enters with an indestructible counter on her.\n{1}, Remove an indestructible counter from Arwen: Another target creature gains indestructible until end of turn. Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a lifelink counter on Arwen." };
    const r = row(src, [{ id: 1, abilityType: "static", actions: [ac("indestructible counter")] }, { id: 2, abilityType: "activated", actions: [{ ...ac("indestructible counter"), verb: "remove-counter" }, { ...ac("indestructible"), verb: "grant-ability" }, ac("+1/+1 counter"), ac("lifelink counter"), ac("+1/+1 counter"), ac("lifelink counter")] }]);
    // Clause 1 ("enters with an indestructible counter on her") is not read as self ("her"): not this part's, so only clause 2's four are checked.
    expect(added(r).slice(1).map((e) => e.subject.self === true)).toEqual([false, false, true, true]);
    expect(noDup(r)).toBe(true);
  });

  test("Invasion of New Capenna: one counter on the equipped attacker, one on each OTHER creature you control", () => {
    const src = { name: "Invasion of New Capenna // Holy Frazzle-Cannon", typeLine: "Battle — Siege // Artifact — Equipment", keywords: ["Transform", "Equip"], oracleText: "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\nWhen this Siege enters, you may sacrifice an artifact or creature. When you do, exile target artifact or creature an opponent controls.\n//\nWhenever equipped creature attacks, put a +1/+1 counter on that creature and each other creature you control that shares a creature type with it.\nEquip {1}" };
    const r = row(src, [{ id: 4, abilityType: "triggered", trigger: { event: "attacks", subject: "equipped creature", control: "you" }, actions: [ac("+1/+1"), ac("+1/+1")] }]);
    const subs = added(r).map((e) => e.subject);
    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.self === true)).toEqual([false, false]);
    expect(subs[0]).not.toEqual(subs[1]);
    expect(subs[1]).toMatchObject({ other: true, scope: "each", type: "creature", control: "you" });
    expect(noDup(r)).toBe(true);
  });
});

// #1401 part 5 (family E): a "cant" whose "abilities" are the SOURCE of something done to the subject is not ability-loss. Oracle text and stored records dumped from Mongo 2026-10-30.
const F5 = {"Peace Talks": {"source": {"name": "Peace Talks", "typeLine": "Sorcery", "keywords": [], "oracleText": "This turn and next turn, creatures can't attack, and players and permanents can't be the targets of spells or activated abilities."}, "canonical": [{"id": 1, "abilityType": "spell", "actions": [{"verb": "cant", "object": "creatures can't attack", "optional": false, "fromZone": null, "toZone": null}, {"verb": "cant", "object": "players can't be the targets of spells or activated abilities", "optional": false, "fromZone": null, "toZone": null}, {"verb": "cant", "object": "permanents can't be the targets of spells or activated abilities", "optional": false, "fromZone": null, "toZone": null}]}]}, "Hold for Questioning": {"source": {"name": "Hold for Questioning", "typeLine": "Enchantment — Aura", "keywords": ["Investigate", "Enchant"], "oracleText": "Enchant creature or planeswalker\nWhen this Aura enters, tap enchanted permanent and investigate. (Create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")\nEnchanted permanent doesn't untap during its controller's untap step and its activated abilities can't be activated."}, "canonical": [{"id": 1, "abilityType": "none", "actions": [{"verb": "none", "object": "Enchant creature or planeswalker", "fromZone": null, "toZone": null}]}, {"id": 2, "abilityType": "triggered", "trigger": {"event": "enters", "subject": "this Aura", "control": "you"}, "actions": [{"verb": "tap", "object": "enchanted permanent", "fromZone": null, "toZone": null, "amount": null, "optional": false}, {"verb": "investigate", "object": "", "fromZone": null, "toZone": null, "amount": null, "optional": false}]}, {"id": 3, "abilityType": "static", "actions": [{"verb": "cant", "object": "enchanted permanent doesn't untap during its controller's untap step", "fromZone": null, "toZone": null, "amount": null, "optional": false}, {"verb": "cant", "object": "enchanted permanent's activated abilities can't be activated", "fromZone": null, "toZone": null, "amount": null, "optional": false}]}]}} as Record<string, { source: { name: string; typeLine: string; keywords: string[]; oracleText: string }; canonical: unknown[] }>;
const f5 = (name: string) => deriveRow({ doc: { oracleId: "x", name, canonical: F5[name]!.canonical } as never, source: F5[name]!.source as never, isToken: false });
const cantKinds = (name: string) => f5(name).tags.abilities.map((a) => a.effect?.kind).filter((k) => k === "restriction" || k === "ability-loss").sort();
test("Peace Talks: 'can't be the targets of spells or activated abilities' strips nobody's abilities; the attack restriction stays", () => {
  expect(cantKinds("Peace Talks")).toEqual(["restriction"]);
});
test("Hold for Questioning: 'doesn't untap' is not ability-loss; the activated-abilities limb is, once", () => {
  expect(cantKinds("Hold for Questioning")).toEqual(["ability-loss"]);
});

// #1377: the switch refuses a grammar reading that drops a number the stored one states, and keeps one that gains (oracle text and stored records dumped from Mongo 2026-10-31).
const rowOf = (source: { name: string }, canonical: unknown[]) => deriveRow({ doc: { oracleId: "x", name: source.name, canonical } as never, source: source as never, isToken: false });
const LIVING = {"name":"Living Lands","oracleText":"All Forests are 1/1 creatures that are still lands.","keywords":[],"typeLine":"Enchantment","manaCost":"{3}{G}","colors":["G"],"colorIdentity":["G"],"manaValue":4,"layout":"normal"};
const LIVING_STORED = [{"id":1,"abilityType":"static","actions":[{"verb":"animate","object":"All Forests","fromZone":null,"toZone":null,"amount":"1/1","optional":false}]}];
test("Living Lands keeps its stored reading: the grammar's animate drops the 1/1 (#1377)", () => {
  const row = rowOf(LIVING, LIVING_STORED);
  expect(row.fromGrammar).toBe(false);
  expect(row.tags.abilities.find((a) => a.effect?.kind === "animate")?.amount).toBe("1/1");
});
const NOCTURNUS = {"name":"Vampire Nocturnus","oracleText":"Play with the top card of your library revealed.\nAs long as the top card of your library is black, this creature and other Vampire creatures you control get +2/+1 and have flying.","keywords":[],"typeLine":"Creature \u2014 Vampire","manaCost":"{1}{B}{B}{B}","colors":["B"],"colorIdentity":["B"],"manaValue":4,"layout":"normal","power":"3","toughness":"3"};
const NOCTURNUS_STORED = [{"id":1,"abilityType":"static","actions":[{"verb":"none"}]},{"id":2,"abilityType":"static","actions":[{"verb":"modify-pt","object":"this creature and other Vampire creatures you control","fromZone":null,"toZone":null,"amount":"+2/+1","optional":false},{"verb":"grant-ability","object":"this creature and other Vampire creatures you control","fromZone":null,"toZone":null,"amount":"flying","optional":false}]}];
test("Vampire Nocturnus stays on the grammar: an unequal group and a prose amount (\"flying\"), so the amount guard never trips (#1377)", () => {
  const row = rowOf(NOCTURNUS, NOCTURNUS_STORED);
  expect(row.fromGrammar).toBe(true);
  expect(row.tags.abilities.some((a) => a.grants?.includes("flying"))).toBe(true);
});
const URCHINS = {"name":"Dusk Urchins","oracleText":"Whenever this creature attacks or blocks, put a -1/-1 counter on it.\nWhen this creature dies, draw a card for each -1/-1 counter on it.","keywords":[],"typeLine":"Creature \u2014 Ouphe","manaCost":"{2}{B}","colors":["B"],"colorIdentity":["B"],"manaValue":3,"layout":"normal","power":"4","toughness":"3"};
const URCHINS_STORED = [{"id":1,"abilityType":"triggered","trigger":{"event":"attacks","subject":"this creature","control":"you"},"actions":[{"verb":"add-counter","object":"-1/-1","fromZone":null,"toZone":null,"amount":"1","optional":false}]},{"id":2,"abilityType":"triggered","trigger":{"event":"dies","subject":"this creature","control":"you"},"actions":[{"verb":"draw","object":"a card for each -1/-1 counter on it","fromZone":null,"toZone":null,"amount":null,"optional":false}]},{"id":3,"abilityType":"triggered","trigger":{"event":"blocks","subject":"this creature","control":"you"},"actions":[{"verb":"add-counter","object":"-1/-1","fromZone":null,"toZone":null,"amount":"1","optional":false}]}];
test("Dusk Urchins: the diff is null, so the guard is never reached; the counter keeps amount 1 on either reading (#1377)", () => {
  const row = rowOf(URCHINS, URCHINS_STORED);
  expect(row.tags.abilities.filter((a) => a.effect?.kind === "counter-placement").map((a) => a.amount)).toEqual(["1", "1"]);
});

const ARCHGHOUL = {"name":"Archghoul of Thraben","oracleText":"Whenever this creature or another Zombie you control dies, look at the top card of your library. If it's a Zombie card, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.","keywords":[],"typeLine":"Creature \u2014 Zombie Cleric","manaCost":"{2}{B}","colors":["B"],"colorIdentity":["B"],"manaValue":3,"layout":"normal","power":"3","toughness":"2"};
const ARCHGHOUL_STORED = [{"id":1,"abilityType":"triggered","trigger":{"event":"dies","subject":"this creature or another Zombie you control","control":"you"},"actions":[{"verb":"put","object":"it","fromZone":"library","toZone":"hand","amount":null,"optional":true},{"verb":"put","object":"it","fromZone":"library","toZone":"graveyard","amount":null,"optional":true}]}];
test("Archghoul of Thraben stays on the grammar: the stored mill emit is typed Zombie, but the card that reaches the graveyard is the one NOT taken (#1377 review)", () => {
  const row = rowOf(ARCHGHOUL, ARCHGHOUL_STORED);
  expect(row.fromGrammar).toBe(true);
  const emits = row.tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "mill");
  expect(emits.length).toBeGreaterThan(0);
  expect(emits.every((e) => (e.subject as { subtype?: string }).subtype === undefined)).toBe(true);
});
