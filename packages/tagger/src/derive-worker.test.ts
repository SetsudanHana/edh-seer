import { expect, test } from "vitest";
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
test("Wicked Slumber: 'instead' only in reminder text, so the two stun counters stay two", () => {
  expect(f4Row("Wicked Slumber", "model").tags.abilities.filter((a) => a.effect?.kind === "counter-placement")).toHaveLength(2);
});
test("the switch decides on unfolded readings: fromGrammar is as at derive 405", () => {
  expect(["Grow from the Ashes", "Primal Growth", "Bane's Contingency", "Academy Manufactor"].map((n) => f4Row(n, "model").fromGrammar)).toEqual([false, true, true, false]);
});
