import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { parseActions, unreadPhrases } from "./action.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1676: a clause whose subject is ANOTHER player (an opponent, the owner of a target, each opponent secretly choosing), where the acting player must land on the emit. A silent wrong reading is worse than a missing
// one: an opponent's draw is never `control: you`, a punisher offer ("target opponent may have YOU draw") is the chooser's and the drawer's apart. Every oracle text below is the corpus's own (Mongo `cards`, 2026-11-19).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });

const TROI = card("Cmdr. Troi, Outgoing Empath", "Legendary Creature — Betazoid Human Advisor", "Vigilance\n{T}: Target opponent whose turn it is may cast a spell from their hand without paying its mana cost. If they do, you copy that spell. You may choose new targets for the copy. If they don't, you draw a card.", ["Vigilance"]);
const TELL = card("Tell Me What You See", "Enchantment", "When this enchantment enters, target opponent may have you draw a card. If they don't, they lose 4 life and you surveil 1.\nWhenever you face a dilemma, you may return this enchantment to its owner's hand. (You face a dilemma as you choose one or more modes for a spell or ability.)");
const KUROKI = card("Kuroki, Thief of Talents", "Legendary Creature — Spirit", "Menace\nAt the beginning of your end step, target opponent may draw four cards. If they do, look at that player's hand and you may cast a spell from their hand without paying its mana cost. If they don't, put two +1/+1 counters on Kuroki.", ["Menace"]);
const PEACE = card("Peace in Our Time", "Enchantment", "At the beginning of combat on each player's turn, that player may draw a card. If they do, they can't attack this turn and you put a peace counter on this enchantment.\nAt the beginning of your upkeep, if this enchantment has twelve or more peace counters on it, you win the game.");
const LORD = card("Tresserhorn's Lord, Returned", "Legendary Creature — Zombie Noble", "Trample, indestructible\nWhen Tresserhorn's Lord enters, sacrifice him unless you sacrifice three creatures, pay 3 life, and have target opponent draw three cards.\nWhenever you sacrifice a creature, draw a card.", ["Trample", "Indestructible"]);
const UNIFICATION = card("Unification", "Enchantment — Saga", "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — The owner of up to one target creature draws two cards, then shuffles that creature into their library.\nII — You may put a Spacecraft card from your hand or graveyard onto the battlefield.\nIII — You and target opponent each draw two cards.");
const BRAIDS = card("Braids's Frightful Return", "Enchantment — Saga", "Read ahead (Choose a chapter and start with that many lore counters. Add one after your draw step. Skipped chapters don't trigger. Sacrifice after III.)\nI — You may sacrifice a creature. If you do, each opponent discards a card.\nII — Return target creature card from your graveyard to your hand.\nIII — Target opponent may sacrifice a nonland, nontoken permanent of their choice. If they don't, they lose 2 life and you draw a card.", ["Read ahead"]);
const MELD = card("Vulcan Mind-Meld", "Sorcery", "Target opponent looks at the top card of your library, then exiles it face down. You look at the top two cards of their library, then exile them face down. For each card exiled this way, the player who exiled it may play it for as long as it remains exiled. Mana of any type can be spent to cast spells this way.");
const ITAZURA = card("Itazura, Lingering Wick", "Legendary Creature — Spirit", "At the beginning of your upkeep, exile the top three cards of your library. Each opponent secretly chooses a number 0 or greater. Then those numbers are revealed. Choose an opponent with the highest number. Itazura deals that much damage to them, then they may cast a spell from among those cards without paying its mana cost. You put a card from among them that wasn't cast this way into your hand.");

const tagsOf = (c: ReturnType<typeof card>) => {
  const g = grammarClauseRecords(c);
  return deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings));
};
const effects = (c: ReturnType<typeof card>) => tagsOf(c).abilities.map((a) => ({ kind: a.effect.kind, control: a.effect.subject?.control, scope: a.effect.subject?.scope }));

test("Cmdr. Troi: the opponent's free cast is theirs, the copy and the fallback draw are yours", () => {
  const g = grammarClauseRecords(TROI);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const [cast, copy, draw] = parseActions("Target opponent whose turn it is may cast a spell from their hand without paying its mana cost. If they do, you copy that spell. You may choose new targets for the copy. If they don't, you draw a card.", "activated");
  expect(cast).toMatchObject({ verb: "cast", optional: true, actor: { control: "opp", scope: "target" } });
  expect(copy).toMatchObject({ verb: "copy", actor: { control: "you" } });
  expect(draw).toMatchObject({ verb: "draw", actor: { control: "you" } });
  // the turn restriction only narrows the target; it is not a second actor
  expect(unreadPhrases("Target opponent whose turn it is may cast a spell from their hand without paying its mana cost.", "activated")).toEqual([]);
  // the draw is YOURS: no draw-card of the opponent's
  const draws = tagsOf(TROI).abilities.filter((a) => a.effect.kind === "draw-card");
  expect(draws.map((a) => a.effect.subject?.control)).toEqual(["you"]);
});

test("Tell Me What You See: the opponent CHOOSES, you DRAW; they (the same opponent) lose 4 life if they decline", () => {
  const g = grammarClauseRecords(TELL);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const acts = parseActions("Target opponent may have you draw a card. If they don't, they lose 4 life and you surveil 1.", "triggered");
  expect(acts.map((a) => a.verb)).toEqual(["draw", "lose-life", "surveil"]);
  expect(acts[0]).toMatchObject({ actor: { control: "you" }, optional: true });
  expect(acts[1]).toMatchObject({ actor: { control: "opp", scope: "target" }, text: "target opponent", condition: "if they don't" });
  expect(acts[2]).toMatchObject({ actor: { control: "you" }, condition: "if they don't" });
  const fx = effects(TELL);
  expect(fx).toContainEqual({ kind: "draw-card", control: "you", scope: undefined });
  expect(fx).toContainEqual({ kind: "player-life-loss", control: "opp", scope: "target" });
  // not claimed: an opponent's draw, or the life loss on you / anyone
  expect(fx).not.toContainEqual(expect.objectContaining({ kind: "draw-card", control: "opp" }));
  expect(fx.filter((f) => f.kind === "player-life-loss").every((f) => f.control === "opp")).toBe(true);
});

test("Kuroki: the opponent's optional draw is the opponent's; the look at 'that player's hand' joined by 'and' is no action; the counters are Kuroki's", () => {
  const g = grammarClauseRecords(KUROKI);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const acts = parseActions("Target opponent may draw four cards. If they do, look at that player's hand and you may cast a spell from their hand without paying its mana cost. If they don't, put two +1/+1 counters on ~.", "triggered");
  expect(acts.map((a) => a.verb)).toEqual(["draw", "cast", "add-counter"]);
  expect(acts[0]).toMatchObject({ actor: { control: "opp", scope: "target" }, optional: true, amount: "4" });
  expect(acts[1]).toMatchObject({ actor: { control: "you" }, optional: true, condition: "if they do", fromZone: "hand", text: "a spell from target opponent's hand" });
  // the card's own words name the cast's hand: the opponent's, not "their" with no owner
  expect(g.records.flatMap((r) => r.actions ?? []).find((a) => a.verb === "cast")?.object).toBe("a spell from target opponent's hand");
  // "that player" outside the hand's look and an "If they ..." sentence is NOT rewritten: a lone "look at that player's hand and you may cast" with no chosen opponent stays unread
  expect(unreadPhrases("If they do, look at that player's hand and you may cast a spell from their hand without paying its mana cost.", "triggered")).not.toEqual([]);
  const fx = effects(KUROKI);
  expect(fx).toContainEqual({ kind: "draw-card", control: "opp", scope: "target" });
  expect(fx).not.toContainEqual(expect.objectContaining({ kind: "draw-card", control: "you" }));
});

test("Peace in Our Time: 'that player' draws (anyone: it is each player's turn), and the counter is the card's own, named peace", () => {
  const g = grammarClauseRecords(PEACE);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const acts = parseActions("That player may draw a card. If they do, they can't attack this turn and you put a peace counter on this enchantment.", "triggered");
  expect(acts.map((a) => a.verb)).toEqual(["draw", "cant", "add-counter"]);
  expect(acts[0]).toMatchObject({ actor: { control: "any", scope: "that" }, optional: true });
  expect(acts[2]).toMatchObject({ counter: "peace", actor: { control: "you" }, object: { self: true } });
  const fx = effects(PEACE);
  // the draw is the turn player's, which may be you: never `opp`, never `you`
  expect(fx.filter((f) => f.kind === "draw-card").map((f) => f.control)).toEqual(["any"]);
});

test("Tresserhorn's Lord: 'have target opponent draw three cards' is the opponent's draw, inside the unless cost", () => {
  const g = grammarClauseRecords(LORD);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const acts = parseActions("Sacrifice him unless you sacrifice three creatures, pay 3 life, and have target opponent draw three cards.", "triggered");
  const draw = acts.find((a) => a.verb === "draw");
  expect(draw).toMatchObject({ amount: "3", actor: { control: "opp", scope: "target" } });
  const draws = tagsOf(LORD).abilities.filter((a) => a.effect.kind === "draw-card");
  // the opponent's three, and your own trigger draw (Whenever you sacrifice a creature, draw a card)
  expect(draws.map((a) => a.effect.subject?.control).sort()).toEqual(["opp", "you"]);
});

test("Unification: 'the owner of up to one target creature draws' is anyone's draw (the owner may be you), and the shuffle is theirs", () => {
  const g = grammarClauseRecords(UNIFICATION);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const acts = parseActions("The owner of up to one target creature draws two cards, then shuffles that creature into their library.", "chapter");
  expect(acts.map((a) => a.verb)).toEqual(["draw", "shuffle"]);
  expect(acts[0]).toMatchObject({ amount: "2", actor: { control: "any", scope: "that" } });
  const fx = effects(UNIFICATION).filter((f) => f.kind === "draw-card");
  // chapter I (the owner: anyone) and chapter III (you, and target opponent): never a lone `you`/`opp` for the owner's draw
  expect(fx.map((f) => f.control).sort()).toEqual(["any", "opp", "you"]);
});

test("Vulcan Mind-Meld: each exile is its own player's, the play is by whoever exiled the card, and nothing is claimed for you that the opponent does", () => {
  const g = grammarClauseRecords(MELD);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const acts = parseActions(MELD.oracleText, "spell");
  expect(acts.map((a) => a.verb)).toEqual(["exile", "exile", "play", "other"]);
  // the opponent exiles the top of YOUR library; you exile the top of THEIR library (the chosen opponent's)
  expect(acts[0]).toMatchObject({ actor: { control: "opp", scope: "target" }, text: "the top card of your library", fromZone: "library" });
  expect(acts[1]).toMatchObject({ actor: { control: "you" }, text: "the top two cards of target opponent's library", fromZone: "library" });
  // "the player who exiled it": either of the two, so any player, back-referenced; never `you` and never `opp`
  expect(acts[2]).toMatchObject({ actor: { control: "any", scope: "that", text: "the player who exiled it" }, optional: true });
  // the any-type mana rider is the store's unclaimed `other`, not stripped
  expect(acts[3]).toMatchObject({ verb: "other", phrase: "mana of any type can be spent to cast spells this way" });
  // the rider is read only straight after a cast or play
  expect(unreadPhrases("Mana of any type can be spent to cast spells this way.", "spell")).not.toEqual([]);
  // "their library" is the chosen opponent's only once one was chosen: bare, it stays unread
  expect(unreadPhrases("You look at the top two cards of their library, then exile them face down.", "spell")).not.toEqual([]);
  // nothing is claimed as a derived effect of yours: the exiles and the play are unclaimed (kind "")
  expect(tagsOf(MELD).abilities.map((a) => a.effect.kind)).toEqual(["", ""]);
});

test("Itazura: the secret numbers are an unclaimed choice of each opponent; the damage and the free cast are the chosen opponent's, never any player's", () => {
  const g = grammarClauseRecords(ITAZURA);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const acts = parseActions("Exile the top three cards of your library. Each opponent secretly chooses a number 0 or greater. Then those numbers are revealed. Choose an opponent with the highest number. ~ deals that much damage to them, then they may cast a spell from among those cards without paying its mana cost. You put a card from among them that wasn't cast this way into your hand.", "triggered");
  expect(acts.map((a) => a.verb)).toEqual(["exile", "other", "deal-damage", "cast", "put"]);
  expect(acts[1]).toMatchObject({ actor: { control: "opp", scope: "each" }, phrase: "each opponent secretly chooses a number 0 or greater" });
  expect(acts[2]).toMatchObject({ object: { control: "opp" }, amount: "that much" });
  expect(acts[3]).toMatchObject({ actor: { control: "opp", scope: "that", text: "that opponent" }, optional: true });
  expect(acts[4]).toMatchObject({ actor: { control: "you" }, toZone: "hand" });
  // the damage is an opponent's, not yours or any player's
  const dmg = tagsOf(ITAZURA).abilities.filter((a) => a.effect.kind === "damage");
  expect(dmg.map((a) => a.effect.subject?.control)).toEqual(["opp"]);
  // the pronouns are the chosen opponent's only behind the pick: with no pick, "they may cast" keeps its any / that reading
  expect(parseActions("~ deals that much damage to them, then they may cast a spell from among those cards.", "triggered")[1]).toMatchObject({ actor: { control: "any", scope: "that" } });
  // the numbers must be picked in order: a pick with no choice before it is unread
  expect(unreadPhrases("Choose an opponent with the highest number.", "triggered")).not.toEqual([]);
});

test("what the new readings must NOT claim: the cast out of the opponent's hand is not a card of your deck, the paid sacrifice is yours and no wipe", () => {
  // Kuroki: you cast a card of THEIR hand (owner opp, from the hand), so it meets no deck-mate's own "when you cast this spell"
  const cast = tagsOf(KUROKI).abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "cast"));
  expect(cast.map((e) => e.subject)).toEqual([expect.objectContaining({ control: "you", owner: "opp", fromZone: "hand" })]);
  // Troi: the OPPONENT casts out of their own hand
  const troiCast = tagsOf(TROI).abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "cast"));
  expect(troiCast.map((e) => e.subject)).toEqual([expect.objectContaining({ control: "opp", fromZone: "hand" })]);
  // Tresserhorn's Lord: "unless YOU sacrifice three creatures" is yours (CR 701.21a), though the sentence names an opponent (the drawer): never `any`, which read as a board wipe
  const sacs = tagsOf(LORD).abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "sacrifice" || e.verb === "dies"));
  expect(sacs.length).toBe(4);
  expect(sacs.every((e) => e.subject.control === "you")).toBe(true);
});

test("'If they don't, they lose 2 life' after 'Target opponent may sacrifice ...' is the target opponent's loss, not any player's (Braids's Frightful Return, already derived, moves)", () => {
  const acts = parseActions("Target opponent may sacrifice a nonland, nontoken permanent of their choice. If they don't, they lose 2 life and you draw a card.", "chapter");
  expect(acts.map((a) => a.verb)).toEqual(["sacrifice", "lose-life", "draw"]);
  expect(acts[1]).toMatchObject({ actor: { control: "opp", scope: "target" }, text: "target opponent", condition: "if they don't" });
  expect(acts[2]).toMatchObject({ actor: { control: "you" } });
  const loss = tagsOf(BRAIDS).abilities.filter((a) => a.effect.kind === "player-life-loss");
  expect(loss.map((a) => a.effect.subject?.control)).toEqual(["opp"]);
  // "they" stays any / that where the first sentence's player is no target opponent
  expect(parseActions("That player may draw a card. If they do, they lose 2 life.", "triggered")[1]).toMatchObject({ actor: { control: "any", scope: "that" } });
  expect(parseActions("Each opponent may draw a card. If they do, they lose 2 life.", "triggered")[1]).toMatchObject({ actor: { control: "any", scope: "that" } });
});

test("a punisher's offer is read for every printed chooser the grammar names, and only for 'you' made to act", () => {
  expect(parseActions("Defending player may have you draw a card.", "triggered")[0]).toMatchObject({ verb: "draw", optional: true, actor: { control: "you" } });
  expect(parseActions("Any opponent may have you put that card into your hand.", "triggered")[0]).toMatchObject({ actor: { control: "you" }, optional: true });
  // not "target opponent may have target player draw": no 'you', so the offer shape is not taken (the old 'you may have' shape does not apply either)
  expect(unreadPhrases("Target opponent may have target player draw a card.", "triggered")).not.toEqual([]);
});
