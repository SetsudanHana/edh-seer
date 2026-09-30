import { expect, test } from "vitest";
import type { Action, ClauseRecord } from "../canonicalize.js";
import { antecedentIsSelf, antecedentSource, antecedentText, exiledAcrossClauses } from "./references.js";

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
