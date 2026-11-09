import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import fixtures from "./fixtures/own-name.json" with { type: "json" };

/** #1570 PART 3: THE CARD'S OWN NAME IS NOT A CLASS. A card whose name is (or contains) a creature type had the name read as that type wherever a subject was parsed from the clause head: "Phelddagrif gains trample" granted trample to the class of
 *  Phelddagrifs, "Human Torch gains flying" to Humans, "Return Phelddagrif to its owner's hand" bounced one, "creatures you control named Templar Knight" were Knights. #1568 fixed the double / triple path. Source documents and stored `cardClauses.canonical`
 *  dumped from Mongo 2026-11-09. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] }>;
const tagsOf = (name: string): CardTags => deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags;

/** Every `{path, subject}` of the card's abilities that carries a subtype, wherever the subject sits. */
function subtypeSubjects(tags: CardTags): { path: string; subject: Record<string, unknown> }[] {
  const out: { path: string; subject: Record<string, unknown> }[] = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, path));
    else if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.subtype !== undefined) out.push({ path, subject: o });
      for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`);
    }
  };
  tags.abilities.forEach((a, i) => walk(a, `a${i}`));
  return out;
}
/** The subtypes of the card's CLASS subjects: a `self` subject is the card itself (its own leaves event is a Phelddagrif's), so it is left out. */
const subtypesOf = (name: string): string[] => subtypeSubjects(tagsOf(name)).filter((x) => x.subject.self !== true).flatMap((x) => [x.subject.subtype as string | string[]].flat());

test("a name read as a class is dropped from the grant recipients and the other subject paths (Phelddagrif, Human Torch, Elder Arthur Maxson, Moon Girl, Scion of the Ur-Dragon, Eye of Nidhogg, The War Doctor)", () => {
  expect(subtypesOf("Phelddagrif")).not.toContain("phelddagrif");
  expect(subtypesOf("Human Torch")).not.toContain("human");
  expect(subtypesOf("Elder Arthur Maxson")).not.toContain("elder");
  expect(subtypesOf("Moon Girl and Devil Dinosaur")).not.toContain("devil");
  expect(subtypesOf("Scion of the Ur-Dragon")).not.toContain("scion");
  expect(subtypesOf("Eye of Nidhogg")).not.toContain("eye");
  expect(subtypesOf("The War Doctor")).not.toContain("doctor");
});

test("a card NAMED for a card (cards named Myr Servitor, creatures named Templar Knight, permanents named Phoenix Fleet Airship, not named Burning-Rune Demon) is not a class of its type", () => {
  expect(subtypesOf("Myr Servitor")).not.toContain("myr");
  expect(subtypesOf("Templar Knight")).not.toContain("knight");
  expect(subtypesOf("Phoenix Fleet Airship")).not.toContain("phoenix");
  expect(subtypesOf("Burning-Rune Demon")).not.toContain("demon");
});

test("the REAL ones stay: Aurochs' 'each other attacking Aurochs', Coward // Killer's 'becomes a Coward', Lizard's 'becomes a green Lizard'", () => {
  expect(subtypesOf("Aurochs")).toContain("aurochs");
  expect(subtypesOf("Coward // Killer")).toContain("coward");
  expect(subtypesOf("Lizard, Connors's Curse")).toContain("lizard");
});

test("a SELF subject keeps the card's own subtype, a token it makes keeps the type of the token, a lord keeps the type it names", () => {
  expect(subtypeSubjects(tagsOf("Arden Angel")).some((x) => x.subject.self === true && [x.subject.subtype].flat().includes("angel"))).toBe(true);
  expect(subtypeSubjects(tagsOf("Serra Avatar")).some((x) => x.subject.self === true && [x.subject.subtype].flat().includes("avatar"))).toBe(true);
  expect(subtypeSubjects(tagsOf("Goblin Rabblemaster")).some((x) => x.subject.token === true && [x.subject.subtype].flat().includes("goblin"))).toBe(true);
  expect(subtypesOf("Elvish Archdruid")).toContain("elf");
  // Goblin Rabblemaster's "Other Goblin creatures you control attack each combat if able" is a lord over the type its name also holds
  expect(subtypeSubjects(tagsOf("Goblin Rabblemaster")).some((x) => x.subject.token !== true && x.subject.self !== true && [x.subject.subtype].flat().includes("goblin"))).toBe(true);
});
