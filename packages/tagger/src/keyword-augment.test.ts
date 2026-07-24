import { expect, test } from "vitest";
import { augmentKeywordAbilities } from "./keyword-augment.js";
import type { Ability } from "./schema.js";

const conniveDrawOnly: Ability[] = [
  {
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
    effect: { kind: "draw-card" },
    emits: [{ verb: "draw", subject: { control: "you", token: null } }],
  },
];

const CONNIVE_TEXT = "When this creature enters, it connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)";

test("connive card missing discard gets a synthetic discard-emitting ability", () => {
  const out = augmentKeywordAbilities(CONNIVE_TEXT, conniveDrawOnly);
  expect(out.length).toBe(conniveDrawOnly.length + 1);
  const added = out[out.length - 1];
  expect(added.kind).toBe("static");
  expect(added.effect.subject).toBeUndefined(); // no spurious static:<kind> theme tag
  expect(added.emits).toEqual([{ verb: "discard", subject: { control: "you", token: null } }]);
});

test("connive card that already emits discard is unchanged (idempotent)", () => {
  const withDiscard: Ability[] = [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
      effect: { kind: "draw-card" },
      emits: [
        { verb: "draw", subject: { control: "you", token: null } },
        { verb: "discard", subject: { control: "you", token: null } },
      ],
    },
  ];
  const out = augmentKeywordAbilities(CONNIVE_TEXT, withDiscard);
  expect(out).toEqual(withDiscard);
});

test("non-connive card is unchanged", () => {
  const out = augmentKeywordAbilities("When this creature enters, draw a card.", conniveDrawOnly);
  expect(out).toEqual(conniveDrawOnly);
});

test("running twice is stable (second call is a no-op)", () => {
  const once = augmentKeywordAbilities(CONNIVE_TEXT, conniveDrawOnly);
  const twice = augmentKeywordAbilities(CONNIVE_TEXT, once);
  expect(twice).toEqual(once);
});

test("does not mutate the input array or its ability objects", () => {
  const input: Ability[] = [
    {
      kind: "triggered",
      trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
      effect: { kind: "draw-card" },
      emits: [{ verb: "draw", subject: { control: "you", token: null } }],
    },
  ];
  const snapshot = JSON.parse(JSON.stringify(input));
  augmentKeywordAbilities(CONNIVE_TEXT, input);
  expect(input).toEqual(snapshot);
});
