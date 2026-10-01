import { expect, test } from "vitest";
import type { Action, ClauseRecord } from "../canonicalize.js";
import { antecedentIsSelf, antecedentSource, antecedentText, exiledAcrossClauses, revealedAntecedent, zoneAfterEvent } from "./references.js";

const acts = (...xs: [string, string][]) => xs.map(([verb, object]) => ({ verb, object }) as Action);

test("a fetch's 'that card' is the search, with the library preamble stripped", () => {
  const a = acts(["search", "your library for a Swamp or Mountain card"], ["put", "that card"]);
  expect(antecedentSource(a, 1, undefined)).toEqual({ to: "action", action: 0 });
  expect(antecedentText(a, { to: "action", action: 0 }, undefined, "")).toBe("a Swamp or Mountain card");
});

test("a zone and the card itself are walked past; with no earlier thing the trigger's subject is the referent", () => {
  const a = acts(["shuffle", "your library"], ["return", "that card"]);
  expect(antecedentSource(a, 1, "enchanted permanent")).toEqual({ to: "trigger" });
  // Kaya's Ghostform: the trigger's "enchanted permanent" is bounded by the Enchant line.
  expect(antecedentText(a, { to: "trigger" }, "enchanted permanent", "Enchant creature or planeswalker you control\nWhen enchanted permanent dies"))
    .toBe("enchanted creature or planeswalker you control");
  expect(antecedentSource(acts(["return", "it"]), 0, "it")).toEqual({ to: "none" });
});

test("'the copy' takes what the copy copied; with no copy before it, nothing", () => {
  const a = acts(["exile", "target instant card"], ["modify-pt", "creatures you control"], ["copy", "the exiled card"], ["cast", "the copy"]);
  expect(antecedentSource(a, 3, undefined)).toEqual({ to: "action", action: 0 });
  expect(antecedentSource(acts(["cast", "the copy"]), 0, "a spell")).toEqual({ to: "none" });
});

test("Necromancy: the nearest earlier thing is the card itself", () => {
  const a = acts(["cast", "this spell"], ["sacrifice", "it"]);
  expect(antecedentIsSelf(a, 1, "Necromancy")).toBe(true);
  expect(antecedentIsSelf(acts(["exile", "target creature"], ["return", "it"]), 1, "X")).toBe(false);
});

test("'the exiled card' in a later clause is what an earlier clause exiled (Isochron Scepter), unless its own clause exiled first", () => {
  const c = (id: number, actions: Action[]) => ({ id, abilityType: "activated", actions }) as ClauseRecord;
  let r = exiledAcrossClauses(c(1, acts(["exile", "an instant card with mana value 2 or less from your hand"])), undefined, "Isochron Scepter");
  expect(r.lastExiled).toBe("an instant card with mana value 2 or less from your hand");
  r = exiledAcrossClauses(c(2, acts(["copy", "the exiled card"])), r.lastExiled, "Isochron Scepter");
  expect(r.clause.actions?.[0]?.object).toBe("an instant card with mana value 2 or less from your hand");
  const own = exiledAcrossClauses(c(3, acts(["exile", "target creature"], ["copy", "the exiled card"])), "something earlier", "X");
  expect(own.clause.actions?.[1]?.object).toBe("the exiled card");
});

test("a trigger subject is a referent only when it names a thing: a player, a time or a chapter is not (#896 task 4)", () => {
  const it = acts(["cast", "it"]);
  for (const t of ["you", "the next end step", "chapter iii", "each player"]) expect(antecedentSource(it, 0, t, "Galvanoth")).toEqual({ to: "none" });
  for (const t of ["a creature an opponent controls", "a Goblin you control", "your commander", "a card", "Galvanoth"]) expect(antecedentSource(it, 0, t, "Galvanoth")).toEqual({ to: "trigger" });
});

test("where the triggering object is when the ability resolves", () => {
  expect(zoneAfterEvent("dies")).toBe("graveyard");
  expect(zoneAfterEvent("discarded")).toBe("graveyard");
  expect(zoneAfterEvent("exiled")).toBe("exile");
  expect(zoneAfterEvent("attacks")).toBeUndefined();
});

// #900: a pronoun after a reveal or a look means the revealed card, which the clause layer records no
// action for. Typed by the clause's own condition; with none stated, unresolved -- never the trigger.
test("a revealed or looked-at card is the antecedent, typed by its condition (#900)", () => {
  // Matter Reshaper, Coiling Oracle, Galvanoth -- each read from the printed text.
  expect(revealedAntecedent("reveal the top card of your library. You may put it onto the battlefield if it's a permanent card with mana value 3 or less"))
    .toBe("a permanent card with mana value 3 or less from your library");
  expect(revealedAntecedent("reveal the top card of your library. If it's a land card, put it onto the battlefield")).toBe("a land card from your library");
  expect(revealedAntecedent("look at the top card of your library. You may cast it without paying its mana cost if it's an instant or sorcery spell"))
    .toBe("an instant or sorcery card from your library");
  expect(revealedAntecedent("reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield")).toBe("a creature card from your library");
  expect(revealedAntecedent("draw a card")).toBeUndefined();
  // Rashmi: "a spell with lesser mana value" names no class.
  expect(revealedAntecedent("reveal the top card of your library. You may cast it without paying its mana cost if it's a spell with lesser mana value")).toBeUndefined();
  const put = [{ verb: "put", object: "it", toZone: "battlefield" }] as Action[];
  // The revealed card outranks the trigger's subject ("this creature" for Matter Reshaper)...
  expect(antecedentSource(put, 0, "this creature", "Matter Reshaper", "reveal the top card of your library. If it's a land card, put it onto the battlefield"))
    .toEqual({ to: "revealed", text: "a land card from your library" });
  // ...and a reveal that states no class leaves the pronoun unresolved, not the creature.
  expect(antecedentSource(put, 0, "this creature", "Matter Reshaper", "reveal the top card of your library. You may put it into your hand")).toEqual({ to: "none" });
  // An earlier action still comes first.
  const fetch = [{ verb: "search", object: "your library for a creature card" }, { verb: "put", object: "that card" }] as Action[];
  expect(antecedentSource(fetch, 1, undefined, undefined, "look at the top card of your library. search your library for a creature card, put that card")).toEqual({ to: "action", action: 0 });
});

