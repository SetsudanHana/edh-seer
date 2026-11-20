import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { parseTrigger } from "./trigger.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1679: trigger heads and objects the grammar blocked on. Every oracle text below is the corpus's own (Mongo `cards`, 2026-11-19).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });
const deriveOf = (c: ReturnType<typeof card>) => {
  const g = grammarClauseRecords(c);
  return { g, d: deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings)) };
};

test("'Whenever a creature blocks this creature' is this creature becoming blocked by a creature; 'that creature' is the blocker (Extraction Integrant)", () => {
  const { g, d } = deriveOf(card("Extraction Integrant", "Artifact Creature — Borg", "Artifact creatures you control have menace and \"Whenever a creature blocks this creature, that creature gets -1/-1 until end of turn.\""));
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const t = (d.abilities ?? []).find((a) => a.kind === "triggered")!;
  expect(t.trigger).toMatchObject({ verbs: ["becomes-blocked"], subject: { self: true, type: "creature" }, blocker: { control: "any", type: "creature" } });
  expect(t.effect).toMatchObject({ kind: "debuff", subject: { type: "creature" } });
  expect(t.amount).toBe("-1/-1");
  // it is the creature BLOCKED that has the ability, never a "blocks" trigger of its own
  expect(t.trigger!.verbs).not.toContain("blocks");
});

test("'Until end of turn, whenever a creature deals combat damage to you' reads, the trigger refused as narrowed, so the effect claims nothing (Right of Vengeance)", () => {
  const { g, d } = deriveOf(card("Right of Vengeance", "Instant", "Until end of turn, whenever a creature deals combat damage to you, destroy that creature and create a 2/1 red Klingon Warrior creature token with haste."));
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  // the recipient "you" has no trigger field, so no trigger is claimed and both effects are marked unclaimed: never "any creature that deals damage"
  expect(d.abilities!.every((a) => a.trigger === undefined && a.claimsNothing === "refused-trigger")).toBe(true);
  expect(d.unknownTriggers).toContain("narrowing:damage-dealt");
  const destroy = d.abilities!.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies")!;
  expect(destroy.subject).toMatchObject({ type: "creature" });
  const token = d.abilities!.find((a) => a.effect.kind === "token-generation")!;
  expect(token.effect.subject).toMatchObject({ control: "you", token: true, subtype: ["klingon", "warrior"], keyword: ["haste"] });
  // another narrowing on a temporary trigger still refuses the card
  const other = grammarClauseRecords(card("X", "Instant", "Until end of turn, whenever a creature deals combat damage to a creature, destroy that creature."));
  expect(other.complete).toBe(false);
});

test("'causes one or more cards to be exiled from an opponent's library' is an exile of an opponent's library cards, the cause refusing the trigger (The Madcap Jester)", () => {
  const { g, d } = deriveOf(card("The Madcap Jester", "Legendary Creature — Clown Wizard", "Whenever The Madcap Jester attacks, each opponent exiles the top card of their library.\nWhenever a spell or ability you control causes one or more cards to be exiled from an opponent's library, you may play those cards until the end of your next turn. Mana of any type can be spent to cast spells this way."));
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const r = parseTrigger("Whenever a spell or ability you control causes one or more cards to be exiled from an opponent's library", null);
  expect(r).toMatchObject({ event: "exiled", control: "opp", subject: { control: "opp", fromZone: "library" }, narrowing: "caused by a spell or ability you control" });
  // nothing checks "a spell or ability YOU control", so the trigger is refused rather than read as any exile of an opponent's library
  const second = d.abilities!.find((a) => a.clause === 2)!;
  expect(second.trigger).toBeUndefined();
  expect(d.unknownTriggers).toContain("narrowing:exiled");
  expect(second.emits!.map((e) => [e.verb, e.subject.owner, e.subject.fromZone])).toEqual([["cast", "opp", "exile"], ["land-play", "opp", "exile"]]);
  // only an opponent's library is read
  expect(parseTrigger("Whenever a spell or ability you control causes one or more cards to be exiled from a library", null)).toBeNull();
});

test("a chapter's 'Return ... at the beginning of the next end step' is the return's timing, a flicker (Balance of Terror)", () => {
  const bot = card("Balance of Terror", "Enchantment — Saga", "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Destroy up to one other target artifact or enchantment.\nII, III — Exile up to one other target permanent you control. Return that card to the battlefield under its owner's control at the beginning of the next end step.");
  const { g, d } = deriveOf(bot);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const flicker = d.abilities!.find((a) => a.effect.kind === "flicker")!;
  expect(flicker).toMatchObject({ clause: 3, delayedUntil: "next-end-step", effect: { subject: { control: "you", type: "permanent", scope: "target" } } });
  expect(flicker.emits).toMatchObject([{ verb: "enters", subject: { control: "you", fromZone: "exile" } }]);
  // the exile that precedes it is the permanent leaving, still yours
  expect(d.abilities!.flatMap((a) => a.emits ?? []).find((e) => e.verb === "exiled" && e.subject.type === "permanent")!.subject).toMatchObject({ control: "you", fromZone: "battlefield" });
  // any other delayed word in a chapter still refuses it
  const exileLater = card("X", "Enchantment — Saga", "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Exile target creature you control. Exile it at the beginning of the next end step.\nII — Draw a card.\nIII — Draw a card.");
  expect(grammarClauseRecords(exileLater).complete).toBe(false);
});

test("'assimilate up to one target creature card from that player's graveyard that was put there from the battlefield this turn' is a put from a graveyard, a +1/+1 counter and a Borg animate (Assimilate the Wounded)", () => {
  const atw = card("Assimilate the Wounded", "Instant", "For each opponent, assimilate up to one target creature card from that player's graveyard that was put there from the battlefield this turn. (Put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)");
  const { g, d } = deriveOf(atw);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  expect(g.records[0]!.actions!.map((a) => [a.verb, a.fromZone ?? null, a.toZone ?? null])).toEqual([["put", "graveyard", "battlefield"], ["add-counter", null, null], ["animate", null, null]]);
  // the "put there from the battlefield" tail is read off, so it is not mistaken for the origin: the card comes out of a graveyard
  const [recursion] = d.abilities!;
  expect(recursion!.effect.kind).toBe("graveyard-recursion");
  expect(recursion!.emits!.map((e) => [e.verb, e.subject.type, e.subject.fromZone])).toEqual([["enters", "creature", "graveyard"], ["leaves", "creature", "graveyard"]]);
  expect(d.abilities!.map((a) => a.effect.kind)).toEqual(["graveyard-recursion", "counter-placement", "animate"]);
  // "from their library" (The Weaver King) stays unread
  const weaver = grammarClauseRecords(card("The Weaver King", "Legendary Creature — Horror Wizard", "Shadow (This creature can block or be blocked by only creatures with shadow.)\nWhenever The Weaver King deals combat damage to a player, they mill that many cards. Then for each opponent, put a creature card from that player's graveyard that was put there from their library this turn onto the battlefield under your control."));
  expect(weaver.complete).toBe(false);
});

test("assimilating a PERMANENT takes it; the Borg it made is exiled and returned to its owner (The Best of Both Worlds)", () => {
  const bobw = card("The Best of Both Worlds", "Enchantment — Saga", "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Assimilate target nonartifact creature an opponent controls. (Gain control of it and put a +1/+1 counter on it. It's a Borg artifact creature and loses all other creature types.)\nII — Artifact creatures you control get +2/+2 until end of turn.\nIII — Exile the Borg assimilated with this Saga, then return it to the battlefield under its owner's control.");
  const { g, d } = deriveOf(bobw);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const chapterI = g.records.find((r) => r.id === 2)!.actions!;
  expect(chapterI.map((a) => a.verb)).toEqual(["gain-control", "add-counter", "animate"]);
  // a permanent is never "put onto the battlefield" from the battlefield
  expect(chapterI.map((a) => a.verb)).not.toContain("put");
  const steal = d.abilities!.flatMap((a) => a.emits ?? []).find((e) => e.verb === "gains-control")!;
  expect(steal.subject).toMatchObject({ control: "you", type: "creature", notType: ["artifact"], scope: "target" });
  expect(d.abilities!.find((a) => a.clause === 2 && a.targets)!.targets).toMatchObject([{ type: "creature", control: "opp" }]);
  // chapter III: the exile is of a Borg creature (never a "Saga"), and the return is a flicker
  const exile = d.abilities!.flatMap((a) => a.emits ?? []).find((e) => e.verb === "exiled")!;
  expect(exile.subject).toMatchObject({ type: "creature", subtype: "borg", fromZone: "battlefield" });
  expect(JSON.stringify(exile.subject)).not.toContain("saga");
  expect(d.abilities!.find((a) => a.effect.kind === "flicker" && a.clause === 4)!.emits).toMatchObject([{ verb: "enters", subject: { fromZone: "exile", subtype: "borg" } }]);
  // a card in a zone is still a put: Death Is Irrelevant
  const dir = grammarClauseRecords(card("Death Is Irrelevant", "Enchantment", "Artifact creatures you control have indestructible.\nAt the beginning of your end step, assimilate target creature card from a graveyard. (Put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)"));
  expect(dir.records.flatMap((r) => r.actions ?? []).map((a) => a.verb)).toContain("put");
});

// ROUND 2 (#1679): every assimilated card enters under YOUR control (the keyword's reminder: "Put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature"), so the creature that arrives, its counter and its Borg animate are yours,
// while the card LEAVES the zone it was in, whoever's: an opponent's graveyard, "that player's" after "For each opponent", any graveyard as printed.
const assimilated = (name: string, typeLine: string, oracleText: string) => {
  const { d } = deriveOf(card(name, typeLine, oracleText));
  const abilities = d.abilities!;
  const emitsOf = (verb: string) => abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb);
  return { abilities, emitsOf, effect: (kind: string) => abilities.filter((a) => a.effect.kind === kind) };
};
const REMINDER = "(Put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)";

test("Assimilate the Wounded: the creature enters under YOUR control, leaves THAT PLAYER'S (an opponent's) graveyard, and its counter and Borg animate are yours", () => {
  const a = assimilated("Assimilate the Wounded", "Instant", `For each opponent, assimilate up to one target creature card from that player's graveyard that was put there from the battlefield this turn. ${REMINDER}`);
  expect(a.emitsOf("enters")).toMatchObject([{ subject: { control: "you", type: "creature", fromZone: "graveyard", owner: "opp" } }]);
  expect(a.emitsOf("leaves")).toMatchObject([{ subject: { control: "opp", type: "creature", fromZone: "graveyard" } }]);
  expect(a.effect("graveyard-recursion")[0]!.effect.subject).toMatchObject({ control: "opp", type: "creature", fromZone: "graveyard" });
  expect(a.emitsOf("counter-added")).toMatchObject([{ subject: { control: "you", counter: "+1/+1" } }]);
  expect(a.effect("counter-placement")[0]!.effect.subject!.control).toBe("you");
  expect(a.effect("animate")[0]!.effect.subject).toMatchObject({ control: "you", subtype: "borg" });
});

test("Borg Queen, Perfection Manifest: a card from an opponent's graveyard enters under YOUR control (was opp), owned by the opponent; Death Is Irrelevant keeps any graveyard", () => {
  const bq = assimilated("Borg Queen, Perfection Manifest", "Legendary Artifact Creature — Borg Noble", `Artifact creatures you control get +2/+0.\nWhen Borg Queen enters, assimilate target creature card from an opponent's graveyard. ${REMINDER}`);
  expect(bq.emitsOf("enters")).toMatchObject([{ subject: { control: "you", fromZone: "graveyard", owner: "opp" } }]);
  expect(bq.emitsOf("leaves")).toMatchObject([{ subject: { control: "opp", fromZone: "graveyard" } }]);
  expect(bq.emitsOf("counter-added")[0]!.subject.control).toBe("you");
  expect(bq.effect("animate")[0]!.effect.subject!.control).toBe("you");
  const dir = assimilated("Death Is Irrelevant", "Enchantment", `Artifact creatures you control have indestructible.\nAt the beginning of your end step, assimilate target creature card from a graveyard. ${REMINDER}`);
  expect(dir.emitsOf("enters")).toMatchObject([{ subject: { control: "you", fromZone: "graveyard" } }]);
  expect(dir.emitsOf("enters")[0]!.subject.owner).toBeUndefined();
  expect(dir.emitsOf("leaves")).toMatchObject([{ subject: { control: "any", fromZone: "graveyard" } }]);
  expect(dir.emitsOf("counter-added")[0]!.subject.control).toBe("you");
});

test("The Borg Queen and Assimilation Assessor: the card taken out of exile enters under YOUR control", () => {
  const queen = assimilated("The Borg Queen", "Legendary Artifact Creature — Borg Noble", `Artifact creatures you control get +2/+2.\nWhenever The Borg Queen enters or attacks, target opponent exiles cards from the top of their library until they exile a creature card. Assimilate that card. They put the rest on the bottom in a random order. (To assimilate a card, put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)`);
  expect(queen.emitsOf("enters").map((e) => [e.subject.control, e.subject.fromZone])).toEqual([["you", "exile"], ["you", "exile"]]);
  // the exiled card is the OPPONENT'S (target opponent exiles cards from the top of THEIR library): owned by them, never a card of your deck
  expect(queen.emitsOf("enters").map((e) => e.subject.owner)).toEqual(["opp", "opp"]);
  expect(queen.emitsOf("counter-added").every((e) => e.subject.control === "you")).toBe(true);
  expect(queen.effect("animate").every((a) => a.effect.subject!.control === "you")).toBe(true);
  const aa = assimilated("Assimilation Assessor", "Artifact Creature — Borg", `When this creature enters, exile target opponent's graveyard.\nWhenever this creature attacks, assimilate a creature card exiled with it. ${REMINDER}`);
  expect(aa.emitsOf("enters")).toMatchObject([{ subject: { control: "you", fromZone: "exile", owner: "opp" } }]);
  // Borg Cube: the card exiled with it is whatever "up to one target creature" was, any player's: no owner
  const cube = assimilated("Borg Cube", "Artifact — Spacecraft", `Affinity for artifact creatures\nWhenever this Spacecraft enters or attacks, assimilate a creature card exiled with it. If you can't, exile up to one target creature. ${REMINDER}\nStation\n12+ | Artifact creatures you control have flying.`);
  expect(cube.emitsOf("enters").length).toBeGreaterThan(0);
  expect(cube.emitsOf("enters").every((e) => e.subject.owner === undefined && e.subject.control === "you")).toBe(true);
  expect(aa.emitsOf("counter-added")[0]!.subject.control).toBe("you");
});

test("The Best of Both Worlds: chapter I's counter and Borg animate are yours; chapter III's return stays under its owner's control", () => {
  const b = assimilated("The Best of Both Worlds", "Enchantment — Saga", `(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Assimilate target nonartifact creature an opponent controls. (Gain control of it and put a +1/+1 counter on it. It's a Borg artifact creature and loses all other creature types.)\nII — Artifact creatures you control get +2/+2 until end of turn.\nIII — Exile the Borg assimilated with this Saga, then return it to the battlefield under its owner's control.`);
  expect(b.emitsOf("counter-added")[0]!.subject.control).toBe("you");
  expect(b.effect("counter-placement")[0]!.effect.subject!.control).toBe("you");
  expect(b.effect("animate")[0]!.effect.subject!.control).toBe("you");
  expect(b.emitsOf("gains-control")[0]!.subject.control).toBe("you");
  const flicker = b.effect("flicker")[0]!;
  expect(flicker.emits).toMatchObject([{ verb: "enters", subject: { control: "any", fromZone: "exile" } }]);
});
