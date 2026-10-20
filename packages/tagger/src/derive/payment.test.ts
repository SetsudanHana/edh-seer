import { expect, test } from "vitest";
import { paymentOf } from "./payment.js";
import { deriveAbilities } from "./derive.js";

// The #806 list, each read off its live `Ability.cost`.
test("mana, tapping and untapping itself", () => {
  expect(paymentOf("{1}{B}")).toEqual({ mana: "{1}{B}" });
  expect(paymentOf("{T}")).toEqual({ tap: true });
  expect(paymentOf("{2}, {T}")).toEqual({ mana: "{2}", tap: true });
  expect(paymentOf("{Q}")).toEqual({ untap: true });
  expect(paymentOf("{X}{X}, {T}")).toEqual({ mana: "{X}{X}", tap: true });
});

test("sacrifice: itself, or a class of your own permanents with a count", () => {
  expect(paymentOf("{T}, Sacrifice this artifact", "Mind Stone")).toEqual({ tap: true, sacrifice: [{ amount: "1", subject: { self: true } }] });
  expect(paymentOf("Sacrifice a creature")).toEqual({ sacrifice: [{ amount: "1", subject: { control: "you", token: null, type: "creature" } }] });
  expect(paymentOf("Sacrifice another creature")?.sacrifice?.[0]?.subject).toMatchObject({ control: "you", other: true, type: "creature" });
  expect(paymentOf("Sacrifice two artifacts")?.sacrifice).toEqual([{ amount: "2", subject: { control: "you", token: null, type: "artifact" } }]);
  expect(paymentOf("Sacrifice Squee", "Squee, Goblin Nabob")?.sacrifice?.[0]?.subject).toEqual({ self: true });
});

test("life, loyalty, counters, tapping another, discard, exile", () => {
  expect(paymentOf("Pay 1 life, Sacrifice another creature")).toMatchObject({ life: "1", sacrifice: [{ amount: "1" }] });
  expect(paymentOf("{5}, Pay 50 life")).toEqual({ mana: "{5}", life: "50" });
  expect(paymentOf("−2")).toEqual({ loyalty: "-2" });
  expect(paymentOf("+1")).toEqual({ loyalty: "+1" });
  expect(paymentOf("0")).toEqual({ loyalty: "0" });
  expect(paymentOf("Remove a +1/+1 counter from this creature")).toEqual({ removeCounter: [{ amount: "1", counter: "+1/+1", subject: { self: true } }] });
  expect(paymentOf("Remove X storage counters from this land")).toEqual({ removeCounter: [{ amount: "X", counter: "storage", subject: { self: true } }] });
  expect(paymentOf("Tap an untapped legendary creature you control")).toEqual({ tapOther: [{ amount: "1", subject: { control: "you", token: null, legendary: true, type: "creature" } }] });
  expect(paymentOf("{1}, Discard a card")).toEqual({ mana: "{1}", discard: [{ amount: "1", subject: { control: "you", token: null } }] });
  expect(paymentOf("Discard your hand")).toEqual({ discard: [{ amount: "all", subject: { control: "you", token: null } }] });
  expect(paymentOf("Exile a creature card from your graveyard")?.exile?.[0]).toMatchObject({ amount: "1", subject: { type: "creature", zone: "graveyard" } });
  expect(paymentOf("{2}{B}, Exile this card from your graveyard")).toEqual({ mana: "{2}{B}", exile: [{ amount: "1", subject: { self: true, zone: "graveyard" } }] });
});

test("a list inside one part takes the verb it continues", () => {
  expect(paymentOf("{T}, Sacrifice a white creature, a blue creature, and a black creature")?.sacrifice?.map((o) => (o.subject as { colors?: string[] }).colors))
    .toEqual([["W"], ["U"], ["B"]]);
});

test("a part it cannot read is kept verbatim, never dropped", () => {
  expect(paymentOf("{1}, Collect evidence 3")).toEqual({ mana: "{1}", other: ["Collect evidence 3"] });
  expect(paymentOf("")).toBeUndefined();
});

test("derive stamps it beside the raw cost", () => {
  const skel = deriveAbilities([{ id: 1, abilityType: "activated", actions: [{ verb: "return", object: "this card", fromZone: "graveyard", toZone: "battlefield" }] }],
    "Reassembling Skeleton", { 1: "Return this card from your graveyard to the battlefield tapped." }, { 1: "{1}{B}" }).abilities[0]!;
  expect(skel.cost).toBe("{1}{B}");
  expect(skel.payment).toEqual({ mana: "{1}{B}" });
});

// ReDoS guards (CodeQL js/polynomial-redos): pin today's reads, and a pathological input stays linear.
test("remove-counter cost: amount and kind", () => {
  const rc = (c: string) => paymentOf(c, "Foo")?.removeCounter?.[0];
  expect(rc("Remove a counter from this creature")).toMatchObject({ amount: "1" });
  expect(rc("Remove a counter from this creature")?.counter).toBeUndefined();
  expect(rc("Remove two counters from this creature")).toMatchObject({ amount: "2" });
  expect(rc("Remove two counters from this creature")?.counter).toBeUndefined();
  expect(rc("Remove a +1/+1 counter from this creature")).toMatchObject({ amount: "1", counter: "+1/+1" });
  expect(rc("Remove an oil counter from this creature")).toMatchObject({ amount: "1", counter: "oil" });
  expect(rc("Remove X charge counters from this creature")).toMatchObject({ amount: "X", counter: "charge" });
  expect(rc("Remove three -1/-1 counters from a creature you control")).toMatchObject({ amount: "3", counter: "-1/-1" });
});
test("cost parsing stays fast on pathological input", () => {
  const t0 = performance.now();
  paymentOf("Sacrifice a b" + " ".repeat(50_000) + "x", "Foo");
  expect(performance.now() - t0).toBeLessThan(100);
  const t1 = performance.now();
  paymentOf("Remove " + "a counter from ".repeat(5_000) + "x", "Foo");
  paymentOf("Remove " + "a ".repeat(50_000), "Foo");
  expect(performance.now() - t1).toBeLessThan(100);
});
