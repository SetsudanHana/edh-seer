import { expect, test } from "vitest";
import { segment } from "./segment.js";

// Every card here is one the extraction experiment or the quality audit got wrong.

test("a single-line spell is one clause", () => {
  const c = segment("Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.");
  expect(c).toHaveLength(1);
  expect(c[0].kind).toBe("ability");
  expect(c[0].id).toBe(1);
});

test("keyword lines are marked, not dropped — a dropped clause is indistinguishable from a vanilla card", () => {
  const c = segment(
    "Flying, first strike, lifelink, protection from Demons and from Dragons",
    ["Flying", "First strike", "Lifelink", "Protection"],
  );
  expect(c).toHaveLength(1);
  expect(c[0].kind).toBe("keyword");
});

test("keywords plus real text split into separate clauses", () => {
  const c = segment("Flying, deathtouch\nWhen this creature dies, draw a card.", ["Flying", "Deathtouch"]);
  expect(c.map((x) => x.kind)).toEqual(["keyword", "ability"]);
});

test("Bitterblossom: the upkeep ability survives as one clause", () => {
  const c = segment("At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.");
  expect(c).toHaveLength(1);
  expect(c[0].text).toContain("beginning of your upkeep");
});

test("Kura: modal bullets become separate clauses linked to their parent", () => {
  const c = segment([
    "Flying, deathtouch",
    "When Kura dies, choose one —",
    "• Search your library for up to three land cards, reveal them, put them into your hand, then shuffle.",
    "• Create an X/X green Spirit creature token, where X is the number of lands you control.",
  ].join("\n"), ["Flying", "Deathtouch"]);
  const modes = c.filter((x) => x.kind === "mode");
  expect(modes).toHaveLength(2);
  // Both modes hang off the "choose one" clause — the model cannot merge or drop one.
  expect(new Set(modes.map((m) => m.parentId)).size).toBe(1);
  expect(modes[0].text).toContain("into your hand");
  expect(modes[1].text).toContain("Create an X/X green Spirit");
});

test("ability words are stripped to a marker so the clause text is the rule itself", () => {
  const c = segment("Landfall — Whenever a land you control enters, mill a card.");
  expect(c[0].marker).toBe("Landfall");
  expect(c[0].text).toBe("Whenever a land you control enters, mill a card.");
});

test("an activated cost is split off, not mistaken for an ability word", () => {
  const c = segment("{2}, {T}: Create a 0/0 colorless Construct artifact creature token.");
  expect(c[0].marker).toBeUndefined();
  expect(c[0].abilityType).toBe("activated");
  expect(c[0].cost).toBe("{2}, {T}");
  expect(c[0].text).toBe("Create a 0/0 colorless Construct artifact creature token.");
});

test("a sacrifice COST is captured, not left as prose the model may or may not record", () => {
  // Phyrexian Tower failed the known-wrong gate because the model sometimes put the sacrifice in
  // the cost string and sometimes in actions. An aristocrats deck needs to see it either way.
  const c = segment("{T}: Add {C}.\n{T}, Sacrifice a creature: Add {B}{B}.");
  expect(c[1].cost).toBe("{T}, Sacrifice a creature");
  expect(c[1].abilityType).toBe("activated");
});

test("abilityType is derived, not asked — the model disagreed with itself on it", () => {
  expect(segment("Counter target spell.", [], "Instant")[0].abilityType).toBe("spell");
  expect(segment("Exile target creature.", [], "Sorcery")[0].abilityType).toBe("spell");
  expect(segment("Whenever a land you control enters, mill a card.", [], "Creature")[0].abilityType).toBe("triggered");
  expect(segment("Creatures you control get +1/+1.", [], "Enchantment")[0].abilityType).toBe("static");
  expect(segment("At the beginning of your upkeep, draw a card.", [], "Artifact")[0].abilityType).toBe("triggered");
});

test("Urza's Saga: chapters are their own clauses, each carrying its numeral", () => {
  const c = segment([
    "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)",
    "I — This Saga gains \"{T}: Add {C}.\"",
    "II — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This creature gets +1/+1 for each artifact you control.'\"",
    "III — Search your library for an artifact card with mana value 1 or less, put it onto the battlefield, then shuffle.",
  ].join("\n"));
  const chapters = c.filter((x) => x.kind === "chapter");
  expect(chapters.map((x) => x.marker)).toEqual(["I", "II", "III"]);
  // The reminder-only first line still occupies a slot, so ids account for every printed line.
  expect(c[0].kind).toBe("reminder");
});

test("Innkeeper's Talent: level markers are their own clauses", () => {
  const c = segment([
    "(Gain the next level as a sorcery to add its ability.)",
    "At the beginning of combat on your turn, put a +1/+1 counter on target creature you control.",
    "{G}: Level 2",
    "Permanents you control with counters on them have ward {1}.",
  ].join("\n"));
  expect(c.map((x) => x.kind)).toEqual(["reminder", "ability", "level", "ability"]);
});

test("clause ids are contiguous from 1, so a missing record is detectable", () => {
  const c = segment("Flying\nWhenever this creature attacks, draw a card.\n{T}: Add {G}.", ["Flying"]);
  expect(c.map((x) => x.id)).toEqual([1, 2, 3]);
});

test("segmentation is deterministic — the property the model could not provide", () => {
  const text = "When Kura dies, choose one —\n• Search your library.\n• Create a token.";
  expect(segment(text)).toEqual(segment(text));
});

test("a run of adjacent mana symbols is still an activated cost", () => {
  // Izzet Locket was misfiled as a static ability because the cost regex allowed only one brace
  // group per comma-separated part, so its sacrifice was never split off.
  const c = segment("{U/R}{U/R}{U/R}{U/R}, {T}, Sacrifice this artifact: Draw two cards.");
  expect(c[0].abilityType).toBe("activated");
  expect(c[0].cost).toBe("{U/R}{U/R}{U/R}{U/R}, {T}, Sacrifice this artifact");
  expect(c[0].costActions).toEqual(["sacrifice"]);
});

test("cost actions are derived, and mana and tapping are never among them", () => {
  expect(segment("{T}, Sacrifice a creature: Add {B}{B}.")[0].costActions).toEqual(["sacrifice"]);
  expect(segment("{2}, Discard a card: Draw a card.")[0].costActions).toEqual(["discard"]);
  // Nothing triggers on paying mana or tapping the source, so neither becomes an action.
  expect(segment("{3}{R}: Create a 1/1 red Goblin creature token.")[0].costActions).toBeUndefined();
  expect(segment("{T}: Add {C}.")[0].costActions).toBeUndefined();
});

test("a trigger embedded after a sentence becomes its own clause", () => {
  // Lapis Orb: one run recorded the delayed trigger, the next ignored it.
  const c = segment("Add {U}. When you spend this mana to cast a Dragon creature spell, scry 2.");
  expect(c).toHaveLength(2);
  expect(c[0].text).toBe("Add {U}.");
  expect(c[1].abilityType).toBe("triggered");
  expect(c[1].text.startsWith("When you spend")).toBe(true);
});
