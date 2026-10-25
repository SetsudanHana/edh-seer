import { useMemo } from "react";
import type { RedundancyResult } from "@edh-seer/matcher/redundancy-static";
import type { AnalyzeResponse } from "../types.js";

export type FindRedundancy = (seed: string) => Promise<RedundancyResult>;

// ONE LOAD PER PAGE, as `useSuggestions` does it, and a failed load is forgotten so the next ask tries the module again.
let engine: Promise<typeof import("@edh-seer/matcher/redundancy-static")> | undefined;

/** THE REDUNDANCY SEARCH FOR THIS REPORT (#1342), registered with the card drawer. Nothing is imported or fetched until
 *  a reader asks for a card: the module loads on the first ask, after the report has painted. The function is stable for
 *  one report, which is what keys the drawer's per-report cache. */
export function useRedundancy(data: AnalyzeResponse | undefined): FindRedundancy | undefined {
  return useMemo<FindRedundancy | undefined>(() => !data ? undefined : async (seed) => {
    engine ??= import("@edh-seer/matcher/redundancy-static").catch((err: unknown) => { engine = undefined; throw err; });
    const { redundancyFor } = await engine;
    return redundancyFor({ report: data.report, seed, commanderColorIdentity: data.commanderColorIdentity, baseUrl: "/static" });
  }, [data]);
}
