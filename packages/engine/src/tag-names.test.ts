import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { EFFECT_KINDS, VERB_VOCAB } from "@edh-seer/tagger/schema";
import { tagName } from "./theme-names.js";
import { describeTag } from "./tags.js";

/** #1170 PR 1: ONE NAME PER KEY. `tagName` is the only function that turns a tag into the words a
 *  deck is named by, the Plan's theme bars, the orbit disc and the card chips' fallback. */

/** The 972 keys the 71 calibration decks carried on 2026-11-24 (every reason tag, theme, axis and
 *  cohesion tag), recorded by the #1170 census. */
const DECK_KEYS: string[] = JSON.parse(readFileSync(new URL("./fixtures/calibration-tag-keys.json", import.meta.url), "utf8"));

/** Subjects every verb is tried with: no class, a card type, a negation, and a creature type. */
const SUBJECTS = ["any", "creature", "-creature", "wizard"];
const VOCAB_KEYS = [
  ...VERB_VOCAB.flatMap((v) => SUBJECTS.map((s) => `${v}:${s}`)),
  ...EFFECT_KINDS.map((k) => `static:${k}`),
];

/** A name a player cannot read: an identifier, a colon, a placeholder, a bare word "any". */
function rawShape(tag: string, name: string): string | null {
  if (name.length === 0) return "empty";
  if (name.includes(":")) return "colon";
  if (/\bany\b/i.test(name)) return "any";
  if (name.includes("__")) return "placeholder";
  if (/^[a-z]/.test(name)) return "lowercase start";
  // The tag's own words handed back: "Draw any", "Land condition swamp", "Static clone".
  const slug = (s: string) => s.toLowerCase().replace(/[:\-_ ]+/g, " ").trim();
  if (slug(name) === slug(tag)) return "the slug itself";
  return null;
}

test("every VERB_VOCAB verb x {any, creature, -creature, a tribe} and every static kind has a readable name", () => {
  const bad = VOCAB_KEYS.map((k) => [k, tagName(k), rawShape(k, tagName(k))] as const).filter(([, , why]) => why !== null);
  expect(bad.map(([k, n, why]) => `${k} -> ${JSON.stringify(n)} (${why})`)).toEqual([]);
});

test("every key the 71 calibration decks carry has a readable name", () => {
  const bad = DECK_KEYS.map((k) => [k, tagName(k), rawShape(k, tagName(k))] as const).filter(([, , why]) => why !== null);
  expect(bad.map(([k, n, why]) => `${k} -> ${JSON.stringify(n)} (${why})`)).toEqual([]);
});

/** Two distinct keys never share a name. The instant and sorcery keys are ONE key for the name (the
 *  #543 ruling), so they are folded before comparing. */
test("two distinct keys never share a name", () => {
  const fold = (k: string) => k.replace(/:(?:instant|sorcery)$/, ":instant-sorcery");
  const keys = [...new Set([...VOCAB_KEYS, ...DECK_KEYS].map(fold))];
  const byName = new Map<string, string[]>();
  for (const k of keys) byName.set(tagName(k), [...(byName.get(tagName(k)) ?? []), k]);
  const shared = [...byName].filter(([, ks]) => ks.length > 1).map(([n, ks]) => `${JSON.stringify(n)}: ${ks.join(" | ")}`);
  expect(shared).toEqual([]);
});

test("the owner's names, 2026-11-24", () => {
  expect(tagName("enters:creature")).toBe("Creature ETBs");
  expect(tagName("cast:spell")).toBe("Cast triggers");
  expect(tagName("cast:-creature")).toBe("Noncreature spells");
  expect(tagName("cast:instant-sorcery")).toBe("Spellslinger");
  expect(tagName("scales:cleric")).toBe("Cleric typal");
  expect(tagName("enters:cleric")).toBe("Cleric ETBs");
  expect(tagName("enters:time lord")).toBe("Time Lord ETBs");
  expect(tagName("enters:artifact")).toBe("Artifact ETBs");
  expect(tagName("cast:artifact")).toBe("Artifact spells");
  expect(tagName("scales:artifact")).toBe("Artifacts matter");
  expect(tagName("enters:vehicle")).toBe("Vehicles");
  expect(tagName("enters:equipment")).toBe("Equipment");
  expect(tagName("enters:aura")).toBe("Auras");
  expect(tagName("enters:saga")).toBe("Sagas");
  expect(tagName("enters:curse")).toBe("Curses");
  expect(tagName("counter-added:any")).toBe("Counters matter");
  expect(tagName("counter-added:creature")).toBe("+1/+1 counters");
  expect(tagName("draw:any")).toBe("Card draw");
  expect(tagName("discard:any")).toBe("Discard");
  expect(tagName("gain-life:any")).toBe("Lifegain");
  expect(tagName("combat-damage:creature")).toBe("Combat damage triggers");
  expect(tagName("dies:artifact")).toBe("Artifacts to the graveyard");
  expect(tagName("leaves-graveyard:creature")).toBe("Creatures leaving the graveyard");
  expect(tagName("static:clone")).toBe("Clones");
  expect(tagName("create-token:goblin")).toBe("Goblin tokens");
  expect(tagName("etb-refire")).toBe("Blink");
});

/** The instant and sorcery keys are one name (#543): "sorcerys" and "instants" were headlines. */
test("instant and sorcery keys are named as the one instant-sorcery key", () => {
  expect(tagName("cast:instant")).toBe("Spellslinger");
  expect(tagName("cast:sorcery")).toBe("Spellslinger");
  expect(tagName("graveyard-recursion:sorcery")).toBe(tagName("graveyard-recursion:instant-sorcery"));
  expect(tagName("recursion-target:instant")).toBe(tagName("recursion-target:instant-sorcery"));
});

/** `describeTag` keeps naming the mechanism in prose; it must at least spell the plural. */
test("describeTag never writes 'sorcerys'", () => {
  expect(describeTag("cast:sorcery")).toBe("sorceries");
  expect(describeTag("leaves:sorcery")).toBe("sorceries leaving");
});
