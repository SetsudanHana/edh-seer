import { expect, test } from "vitest";
import type { Ability } from "../schema.js";
import { selectionFromText } from "./selection-text.js";

/** #1579: an edict on everyone carries `edictAll` beside a bare permanent mass; that marker must not hide the pile (Whims of the Fates) from `selectionFromText`, or the sweep reads as every permanent and gains role:stax. */
test("Whims of the Fates: an edictAll permanent mass is still marked pile", () => {
  const subject = { control: "any" as const, token: null, type: "permanent", scope: "each" as const, edictAll: true as const };
  const abilities = [{ kind: "on-cast", effect: { kind: "" }, emits: [{ verb: "sacrifice", subject }], clause: 1 }] as unknown as Ability[];
  const out = selectionFromText(abilities, { 1: "Starting with you, each player separates all permanents they control into three piles. Then each player chooses one of their piles at random and sacrifices those permanents." }, "");
  expect(out[0]!.emits![0]!.subject.selection).toBe("pile");
});
