import { expect, test } from "vitest";
import { clauseTexts, deriveCardTags } from "@edh-seer/tagger";
import type { ClauseRecord, CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasonsAcrossFaces } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./stack-exile-pairs.fixtures.json" with { type: "json" };

/** #1310: spells that cast a card from a graveyard and exile themselves (Invoke Calamity, Sins of the Past, Impulsivity), and every instant or sorcery whose last line is "Exile <this card>"
 *  (Rise of the Eldrazi), moved a spell off the STACK. Four consumer families judged against the printed text of each (CR 601.2a: a card cast moves from where it is to the stack):
 *   - "leaves your graveyard" (Fang, Murktide Regent): TRUE for a card cast from your graveyard, kept.
 *   - "other cards are put into exile from anywhere" (The War Doctor): TRUE, a spell exiled from the stack is a card put into exile, kept.
 *   - "enchanted permanent leaves the battlefield" (Reality Acid, Parallax Dementia): FALSE, a spell leaving the stack removes no host.
 *   - "whenever a creature / permanent is exiled" (Kaya's Ghostform, Hero of Bretagard): FALSE for a self exile of an instant or sorcery, which is no permanent.
 *  Fixtures: `cardTagsDerived` rows (DERIVE 453) and, for the model-read producers, the stored `cardClauses.canonical`, so the producer is derived by the code under test. */
type Fx = { card: DeckCard["card"]; tags: CardTags; clauses: ClauseRecord[] | null };
const FX = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
/** The row as stored (a consumer, or a producer read by grammar). */
const stored = (n: string): DeckCard => ({ card: FX[n]!.card, tags: FX[n]!.tags });
/** A model-read producer, derived again from its stored clauses. */
const derived = (n: string): DeckCard => {
  const f = FX[n]!;
  const tags = deriveCardTags({ oracleId: n, name: n, clauses: f.clauses!, clauseTexts: clauseTexts({ oracleText: f.card.oracleText, keywords: [], typeLine: f.card.typeLine }), characteristics: f.tags.characteristics }) as CardTags;
  return { card: f.card, tags };
};
const reasons = (p: DeckCard, c: string, prefix: RegExp) => pairReasonsAcrossFaces(p, stored(c), H).filter((r) => prefix.test(r.tag));
const hostLeaves = /^leaves:aura/;
const exiledAny = /^exiled:/;

test("a spell exiled from the stack is no Aura's host leaving: Impulsivity, Invoke Calamity and Sins of the Past feed neither Reality Acid nor Parallax Dementia", () => {
  for (const p of [stored("Impulsivity"), derived("Invoke Calamity"), derived("Sins of the Past")]) {
    for (const aura of ["Reality Acid", "Parallax Dementia"]) expect(reasons(p, aura, hostLeaves)).toEqual([]);
  }
});

test("Rise of the Eldrazi's 'Exile Rise of the Eldrazi' is an exile from the stack: it feeds no 'creature is exiled' or 'permanent is exiled' reader", () => {
  const rise = derived("Rise of the Eldrazi");
  const selfExile = rise.tags!.abilities!.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" && e.subject.self === true);
  expect(selfExile.length).toBeGreaterThan(0);
  expect(selfExile.every((e) => e.subject.fromZone === "stack")).toBe(true);
  expect(reasons(rise, "Kaya's Ghostform", exiledAny)).toEqual([]);
  expect(reasons(rise, "Hero of Bretagard", exiledAny)).toEqual([]);
});

test("kept: a card cast from your graveyard leaves it (CR 601.2a): Sins of the Past and Invoke Calamity still feed Murktide Regent and Fang", () => {
  for (const p of [derived("Sins of the Past"), derived("Invoke Calamity"), stored("Impulsivity")]) {
    expect(reasons(p, "Murktide Regent", /^leaves-graveyard:/).length).toBeGreaterThan(0);
    expect(reasons(p, "Fang, Fearless l'Cie", /^leaves-graveyard:/).length).toBeGreaterThan(0);
  }
});

test("kept: a spell exiled from the stack is a card put into exile from anywhere: Invoke Calamity, Impulsivity and Rise of the Eldrazi still feed The War Doctor", () => {
  for (const p of [derived("Invoke Calamity"), stored("Impulsivity"), derived("Rise of the Eldrazi")]) {
    expect(reasons(p, "The War Doctor", exiledAny).length).toBeGreaterThan(0);
  }
});
