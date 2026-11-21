import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./twin-fold-1720.fixtures.json" with { type: "json" };

/** #1720: A TEXTLESS OVERFLOW TWIN THAT SAYS NO MORE THAN ITS COVER IS ONE READING OF ONE PRINTED SENTENCE, not a second trigger. "Whenever X enters or attacks, ..." leaves a second record with no text of its own; #1699 folded it
 *  only when it was no richer than the covering clause. Two more shapes are the same sentence read twice: (1) a drain ("each opponent loses 2 life. You gain 2 life") made for the FIRST event only, so the second event's drain lived on the
 *  twin alone; (2) a twin that is more specific only in WHOSE (Search for Dagger and Quandrix Apprentice search `you`, the cover said `any`).
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 571; the stored clauses do not move with a derive bump); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const abilities = (name: string) => rowOf(name).tags.abilities;
/** The abilities one printed sentence reads TWICE: the same face, event, effect and emitted verbs more than once, whatever record each came from (a gated / differently-scoped half is a different key only when its trigger differs, so it is shown). */
const readTwice = (name: string): string[] => {
  const seen = new Map<string, number>();
  for (const a of abilities(name)) {
    const k = [a.face ?? "", JSON.stringify(a.trigger), a.effect.kind, (a.emits ?? []).map((e) => e.verb).join("+")].join(" | ");
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${n}x ${k}`);
};

describe("a drain is read for each event its sentence names", () => {
  test.each([
    "Shroudstomper", "Archon of Cruelty", "Professor Onyx", "Blind Hunter", "Witherbloom Apprentice", "Sludge Strider", "Graveyard Trespasser // Graveyard Glutton",
  ])("%s: no ability is read twice", (name) => expect(readTwice(name)).toEqual([]));
  test("Shroudstomper: 'enters or attacks, each opponent loses 2 life. You gain 2 life' drains on both events", () => {
    expect(abilities("Shroudstomper").filter((a) => a.effect.kind === "drain").map((a) => a.trigger?.verbs)).toEqual([["enters"], ["attacks"]]);
  });
  test("Professor Onyx: 'cast or copy' drains on both events", () => {
    expect(abilities("Professor Onyx").filter((a) => a.effect.kind === "drain").map((a) => a.trigger?.verbs)).toEqual([["cast"], ["copy"]]);
  });
});

describe("where the twin stays, the per-event drain does not read its event a second time (#1720 review)", () => {
  // Both twins differ from the cover in another field (Fell Beast: an X amount; Psychomancer: the self half) and stay, carrying their own drain: the cover's per-event copy would double it.
  test.each(["Fell Beast of Mordor", "Psychomancer"])("%s: each event drains once", (name) => {
    const verbs = abilities(name).filter((a) => a.effect.kind === "drain").map((a) => JSON.stringify(a.trigger));
    expect(verbs.length).toBeGreaterThan(0);
    expect(verbs.length).toBe(new Set(verbs).size);
  });
});

describe("a twin more specific only in whose is merged onto its cover, not kept beside it", () => {
  test("Search for Dagger: searches YOUR library on both events, one ability each", () => {
    const s = abilities("Search for Dagger").filter((a) => a.effect.kind === "search");
    expect(s.map((a) => [a.trigger?.verbs, a.effect.subject?.control])).toEqual([[["enters"], "you"], [["attacks"], "you"]]);
  });
  test("Quandrix Apprentice: 'cast or copy' searches YOUR library on both events", () => {
    const s = abilities("Quandrix Apprentice").filter((a) => a.effect.kind === "search");
    expect(s.map((a) => [a.trigger?.verbs, a.effect.subject?.control])).toEqual([[["cast"], "you"], [["copy"], "you"]]);
  });
});

describe("a 'one or more' belongs to the limb it is printed in", () => {
  test("Kratos: 'attack with one or more Gods' is batched; 'whenever a God dies' fires per God and is read once", () => {
    const t = abilities("Kratos, Stoic Father").filter((a) => a.kind === "triggered" && a.effect.kind === "counter-placement" && a.trigger?.verbs?.[0] !== "end-step");
    expect(t.map((a) => [a.trigger?.verbs, a.trigger?.batched])).toEqual([[["attacks"], true], [["dies"], undefined]]);
  });
  test("The War Doctor: both 'whenever one or more ...' limbs are batched", () => {
    const t = abilities("The War Doctor").filter((a) => a.effect.kind === "counter-placement");
    expect(t.length).toBeGreaterThan(1);
    for (const a of t) expect(a.trigger?.batched).toBe(true);
  });
});

describe("a trigger-only twin of an event the cover already reads with its effect is the same ability", () => {
  test.each(["God-Eternal Kefnet", "God-Eternal Bontu", "Ilharg, the Raze-Boar", "Ashnod's Intervention"])("%s: 'dies or is put into exile' is one ability per event", (name) => {
    expect(abilities(name).filter((a) => a.trigger?.verbs?.[0] === "exiled").map((a) => a.clause)).toHaveLength(1);
  });
});

describe("controls: a twin that carries something of its own stays", () => {
  test("Sigarda's Vanguard: the enters and the attacks half are each their own ability (no cover has the attack event)", () => {
    expect(abilities("Sigarda's Vanguard").filter((a) => a.kind === "triggered").map((a) => a.trigger?.verbs)).toEqual([["enters"], ["attacks"]]);
  });
  test("Elder Gargaroth: the attack header and the block header both stay", () => {
    const heads = abilities("Elder Gargaroth").filter((a) => (a.emits ?? []).some((e) => e.verb === "face-a-dilemma")).map((a) => a.trigger?.verbs);
    expect(heads).toEqual([["attacks"], ["blocks"]]);
  });
  test("Obsessive Pursuit: the attack counter and its X-gated lifelink are the card's own second sentence", () => {
    expect(abilities("Obsessive Pursuit").filter((a) => a.trigger?.verbs?.[0] === "attacks").map((a) => a.effect.kind).sort()).toContain("keyword-grant");
  });
  test("Spitting Slug: the gated Otherwise half stays", () => expect(abilities("Spitting Slug").some((a) => a.gate !== undefined)).toBe(true));
  test("Haazda Vigilante: still folded by #1699", () => expect(readTwice("Haazda Vigilante")).toEqual([]));
});
