import { useEffect, useRef, useState } from "react";
import type { RedundancyResult } from "@edh-seer/matcher/redundancy-static";
import { SimilarCards } from "./SimilarCards.js";
import type { FindRedundancy } from "../lib/redundancy.js";

/** Per report (the search function is one per report), per seed: a card the reader reopens is not searched again. A failure is not kept. */
const done = new WeakMap<FindRedundancy, Map<string, RedundancyResult>>();
const inflight = new WeakMap<FindRedundancy, Map<string, Promise<RedundancyResult>>>();
const mapOf = <V,>(w: WeakMap<FindRedundancy, Map<string, V>>, f: FindRedundancy): Map<string, V> => w.get(f) ?? w.set(f, new Map()).get(f)!;

function search(find: FindRedundancy, seed: string): Promise<RedundancyResult> {
  const running = mapOf(inflight, find);
  let p = running.get(seed);
  if (!p) {
    p = find(seed).then((r) => { mapOf(done, find).set(seed, r); return r; }).finally(() => running.delete(seed));
    running.set(seed, p);
  }
  return p;
}

/** One id per search function, so the section is keyed by the report it asks about. */
const ids = new WeakMap<FindRedundancy, number>();
let issued = 0;
export const findKey = (f: FindRedundancy): number => ids.get(f) ?? ids.set(f, ++issued).get(f)!;

type State = { kind: "idle" } | { kind: "loading" } | { kind: "error" } | { kind: "ready"; result: RedundancyResult };

/** FIND REDUNDANCY IN THIS DECK (#1342): the cards that do this card's job, the deck's own first. Asked for, never run on open --
 *  it fetches shards. `ask` is a counter the card menu bumps to start the search for the card it opened; keyed by card by the caller. */
export function RedundancySection({ seed, find, ask = 0 }: { seed: string; find: FindRedundancy; ask?: number }) {
  const cached = mapOf(done, find).get(seed);
  const [state, setState] = useState<State>(cached ? { kind: "ready", result: cached } : { kind: "idle" });
  const live = useRef(true);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const start = () => {
    setState({ kind: "loading" });
    search(find, seed).then(
      (result) => { if (live.current) { focusResults.current = true; setState({ kind: "ready", result }); } },
      (err: unknown) => { console.warn("[redundancy] failed", err); if (live.current) setState({ kind: "error" }); },
    );
  };
  // After a search lands, focus goes to the section heading: the button that held it is gone.
  const focusResults = useRef(false);
  useEffect(() => {
    if (state.kind !== "ready" || !focusResults.current) return;
    focusResults.current = false;
    box.current?.querySelector<HTMLElement>("#redundancy-title")?.focus({ preventScroll: true });
  }, [state.kind]);
  const handled = useRef(0);
  useEffect(() => {
    if (ask > 0 && ask !== handled.current) {
      handled.current = ask;
      box.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      if (!mapOf(done, find).has(seed)) start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  return (
    <div ref={box} data-testid="drawer-redundancy" className="flex flex-col gap-3 border-t border-(--separator) pt-2">
      {state.kind === "ready" ? (
        <SimilarCards
          items={state.result.hits} level={4} fold={5} deckView id="redundancy-title" title="Redundancy in this deck"
          titleClass="t-subsection" tierClass="eyebrow text-(--muted)"
          intro={<>Cards that do the same job as {seed} in this deck, best match first.</>}
          empty={state.result.stats?.comparable === false
            ? "This card has no effect the search can compare."
            : "No card in your colours does the same job as this one."}
        />
      ) : (
        <>
          <button type="button" className="btn-secondary self-stretch" onClick={start} aria-busy={state.kind === "loading"}>
            {state.kind === "loading" ? <><span aria-hidden="true" className="inline-block h-3 w-3 motion-safe:animate-spin rounded-full border-2 border-current border-t-transparent" /> Finding…</>
              : state.kind === "error" ? "Try again" : "Find redundancy in this deck"}
          </button>
          {state.kind === "error" ? <p role="status" className="text-sm text-(--muted)">Couldn't load the redundancy search. Check your connection and try again.</p> : null}
        </>
      )}
    </div>
  );
}
