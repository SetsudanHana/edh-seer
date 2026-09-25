import { renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { DeckSuggestions, SuggestedCard } from "@edh-seer/matcher/suggest-static";
import type { AnalyzeResponse, DeckReport } from "../types.js";
import type { Finding } from "./findings.js";
import { suggestionsFor, takesCards, useSuggestions } from "./suggestions.js";

const { suggestForDeck } = vi.hoisted(() => ({ suggestForDeck: vi.fn() }));
vi.mock("@edh-seer/matcher/suggest-static", () => ({ suggestForDeck }));

const card = (name: string): SuggestedCard => ({ name, slug: name.toLowerCase(), identity: ["R"], mv: 2, connections: [], reasons: [] });
const empty: DeckSuggestions = { build: {}, answers: {}, synergy: {}, plan: [], pairs: [], routes: [] };
const finding = (kind: Finding["kind"], figureLabel = ""): Finding => ({ kind, figureLabel } as unknown as Finding);

test("a build finding takes its group's cards, by the group name it prints", () => {
  const s = { ...empty, build: { Interaction: [card("Chaos Warp")] } };
  expect(suggestionsFor(finding("build", "Interaction"), s, {} as DeckReport)?.map((c) => c.name)).toEqual(["Chaos Warp"]);
});

test("an answers finding takes every short class's cards, each card once", () => {
  const s = { ...empty, answers: { enchantment: [card("Chaos Warp"), card("Abrade")], artifact: [card("Chaos Warp")], creature: [card("Lightning Bolt")] } };
  const report = { deckMath: { answers: [
    { class: "enchantment", count: 1, required: 5 },
    { class: "artifact", count: 2, required: 5 },
    { class: "creature", count: 9, required: 5 },
    { class: "graveyard", count: 0, required: 5 },
  ] } } as unknown as DeckReport;
  expect(suggestionsFor(finding("answers"), s, report)?.map((c) => c.name)).toEqual(["Chaos Warp", "Abrade"]);
  // A card on two class lists says both, not just the first it was found under (final review, AO4).
  const both = { ...s, answers: { enchantment: [{ ...card("Chaos Warp"), answers: ["enchantment"] }], artifact: [{ ...card("Chaos Warp"), answers: ["artifact"] }] } };
  expect(suggestionsFor(finding("answers"), both, report)?.[0]?.answers).toEqual(["enchantment", "artifact"]);
});

test("the synergy finding takes the cards for every unmet key, each card once", () => {
  const s = { ...empty, synergy: { "enters:any": [card("Impact Tremors")], "dies:any": [card("Blood Artist"), card("Impact Tremors")] } };
  expect(suggestionsFor(finding("synergy"), s, {} as DeckReport)?.map((c) => c.name)).toEqual(["Impact Tremors", "Blood Artist"]);
});

test("the mana findings take no cards: lands are out of scope", () => {
  for (const kind of ["colour", "lands", "fetch"] as const) {
    expect(takesCards(kind)).toBe(false);
    expect(suggestionsFor(finding(kind), { ...empty, build: { x: [card("A")] } }, {} as DeckReport)).toBeUndefined();
  }
  expect(["build", "answers", "synergy"].every((k) => takesCards(k as Finding["kind"]))).toBe(true);
});

/** A STALE RESULT NEVER LANDS (plan Review Focus 5): an edit re-runs the report, and the first run's
 *  suggestions arriving late must not overwrite the second's. */
test("a newer report's suggestions win even when the older ones resolve last", async () => {
  let resolveFirst!: (v: DeckSuggestions) => void;
  suggestForDeck
    .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
    .mockImplementationOnce(async () => ({ ...empty, plan: [card("Second")] }));
  const first = { report: { cards: [] }, commanderColorIdentity: ["R"] } as unknown as AnalyzeResponse;
  const second = { report: { cards: [] }, commanderColorIdentity: ["R"] } as unknown as AnalyzeResponse;
  const { result, rerender } = renderHook(({ data }) => useSuggestions(data), { initialProps: { data: first } });
  expect(result.current.state).toBe("loading");
  rerender({ data: second });
  await waitFor(() => expect(result.current.state).toBe("ready"));
  resolveFirst({ ...empty, plan: [card("First")] });
  await new Promise((r) => setTimeout(r, 0));
  expect(result.current.value?.plan.map((c) => c.name)).toEqual(["Second"]);
  expect(suggestForDeck).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: "/static", commanderColorIdentity: ["R"] }));
});

test("a failure is an error state, not a thrown render", async () => {
  suggestForDeck.mockImplementationOnce(async () => { throw new Error("offline"); });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const data = { report: { cards: [] }, commanderColorIdentity: [] } as unknown as AnalyzeResponse;
  const { result } = renderHook(() => useSuggestions(data));
  await waitFor(() => expect(result.current.state).toBe("error"));
  expect(result.current.value).toBeNull();
  warn.mockRestore();
});

/** NOT EVEN ONE FRAME (final review of AO4, Review Focus 5): the effect that resets to "loading" runs
 *  after paint, so the first render of a new report still showed the previous report's cards --
 *  including a card the reader had just added. Every render is recorded, so one stale frame fails. */
test("the first render of a new report never shows the previous report's cards", async () => {
  suggestForDeck
    .mockImplementationOnce(async () => ({ ...empty, plan: [card("Old")] }))
    .mockImplementationOnce(() => new Promise(() => {}));
  const first = { report: { cards: [] }, commanderColorIdentity: [] } as unknown as AnalyzeResponse;
  const second = { report: { cards: [] }, commanderColorIdentity: [] } as unknown as AnalyzeResponse;
  const seen: [AnalyzeResponse, string | undefined][] = [];
  const { result, rerender } = renderHook(({ data }) => {
    const s = useSuggestions(data);
    seen.push([data, s.value?.plan[0]?.name]);
    return s;
  }, { initialProps: { data: first } });
  await waitFor(() => expect(result.current.state).toBe("ready"));
  rerender({ data: second });
  expect(seen.filter(([d, name]) => d === second && name === "Old")).toEqual([]);
});
