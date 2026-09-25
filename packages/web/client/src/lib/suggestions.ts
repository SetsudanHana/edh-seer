import { useEffect, useState } from "react";
import type { DeckSuggestions, SuggestedCard } from "@edh-seer/matcher/suggest-static";
import type { AnalyzeResponse, DeckReport } from "../types.js";
import type { Finding, FindingKind } from "./findings.js";

/** THE FINDINGS A CARD CAN FIX (spec §3). The mana kinds keep their sentence and get no cards: land
 *  count and colour sources are `land-count.ts`'s question, and suggesting fetches is another one. */
const CARD_KINDS: ReadonlySet<FindingKind> = new Set<FindingKind>(["build", "answers", "synergy"]);
export const takesCards = (kind: FindingKind): boolean => CARD_KINDS.has(kind);

const byName = (lists: readonly (readonly SuggestedCard[] | undefined)[]): SuggestedCard[] => {
  const seen = new Set<string>();
  return lists.flatMap((l) => l ?? []).filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
};

/** A FINDING'S OWN CARDS. `build` is keyed by the group name the finding prints as its figure label
 *  (`findings.ts` sets `figureLabel: p.name`); `answers` is every class the deck is short on, read
 *  the way `suggest-static` read it; `synergy` is one finding over every unmet key. */
export function suggestionsFor(f: Finding, s: DeckSuggestions | null, report: DeckReport): readonly SuggestedCard[] | undefined {
  if (!s || !takesCards(f.kind)) return undefined;
  if (f.kind === "build") return s.build[f.figureLabel] ?? [];
  if (f.kind === "answers") {
    const short = (report.deckMath?.answers ?? []).filter((a) => a.class !== "graveyard" && a.count < a.required);
    return byName(short.map((a) => s.answers[a.class]));
  }
  return byName(Object.values(s.synergy));
}

export interface SuggestionsState { state: "loading" | "ready" | "error"; value: DeckSuggestions | null }

// ONE LOAD PER PAGE. Every edit re-runs the hook, and each run importing afresh raced its own
// in-flight import (two concurrent loads of one module under test returned the unmocked copy).
let engine: Promise<typeof import("@edh-seer/matcher/suggest-static")> | undefined;

/** THE CARDS, COMPUTED AFTER THE REPORT HAS PAINTED and never blocking it (spec §3). The module is a
 *  dynamic import so the report's first paint does not wait on the suggestion code either. An edit
 *  re-runs the report; the `cancelled` flag drops the older run's answer if it arrives last. */
export function useSuggestions(data: AnalyzeResponse): SuggestionsState {
  const [out, setOut] = useState<SuggestionsState>({ state: "loading", value: null });
  useEffect(() => {
    let cancelled = false;
    setOut({ state: "loading", value: null });
    (async () => {
      // A FAILED LOAD IS FORGOTTEN, so the next report tries again: a deploy that rotates the hashed
      // chunk under an open tab would otherwise fail every later report until a reload.
      engine ??= import("@edh-seer/matcher/suggest-static").catch((err: unknown) => { engine = undefined; throw err; });
      const { suggestForDeck } = await engine;
      return suggestForDeck({ report: data.report, commanderColorIdentity: data.commanderColorIdentity, baseUrl: "/static" });
    })().then(
      (value) => { if (!cancelled) setOut({ state: "ready", value }); },
      (err: unknown) => {
        // A SUGGESTION RUN THAT FAILS LEAVES THE REPORT AS IT WAS: the findings still say what is
        // wrong, and a missing list is not a wrong one.
        console.warn("[suggest] failed", err);
        if (!cancelled) setOut({ state: "error", value: null });
      },
    );
    return () => { cancelled = true; };
  }, [data]);
  return out;
}
