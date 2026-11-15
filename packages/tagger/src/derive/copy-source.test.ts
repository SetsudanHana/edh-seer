import { expect, test } from "vitest";
import { parse } from "../grammar/filter.js";
import { copySourceOf } from "./copy-source.js";

/** #1648: the source a triggered copier names, from its trigger's subject text. */
const of = (t: string | undefined) => copySourceOf(t, parse);

test("a plain source class is the grammar's abilityOf", () => {
  expect(of("an ability of an artifact")).toEqual({ control: "any", type: "artifact" });
  expect(of("a loyalty ability of a Chandra planeswalker")).toEqual({ control: "any", type: "planeswalker", subtype: "chandra" });
});
test("a host is a status on the host's noun", () => {
  expect(of("an ability of equipped creature")).toMatchObject({ type: "creature", status: ["equipped"] });
  expect(of("a loyalty ability of enchanted planeswalker")).toMatchObject({ type: "planeswalker", status: ["enchanted"] });
});
test("a trailing 'that isn't a mana ability' is the kind's, not the source's", () => {
  expect(of("an ability of an artifact or creature that isn't a mana ability")).toEqual({ control: "any", type: ["creature", "artifact"] });
});
test("no source stated: nothing (Rings of Brighthearth, Verrak, Ertha Jo)", () => {
  expect(of("an ability")).toBeUndefined();
  expect(of("an ability that isn't a mana ability")).toBeUndefined();
  expect(of("an ability that targets a creature or player")).toBeUndefined();
  expect(of(undefined)).toBeUndefined();
});
