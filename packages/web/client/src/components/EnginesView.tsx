import { useMemo } from "react";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel, listNames } from "../lib/engine-model.js";
import { CardName, ReasonText } from "./card-drawer.js";
import { Badge, CardFace, ReadCards, RepeatKey } from "./engine-parts.js";

/** THE GRAPH TAB'S LANDING VIEW, SHRINKING INTO THE REPORT (2026-09-26). It was what the deck does,
 *  in groups of named cards (graph evaluation 2026-09-25); the owner's ruling was that a second
 *  report beside the first makes no sense, so its parts move into the report's chapters one step at
 *  a time. The themes and best pairs are in Game plan, the cards by their job in Roles; the cut list
 *  is still here.
 *
 *  THE CARDS LEAD, AND THEIR TEXT IS ONE TAP AWAY. A player knows a card by its face, and a page of
 *  printed rules text read as a wall (owner, 2026-09-26). But the text beside a claim is what turned
 *  the skeptic's distrust into checking -- with both cards to hand it caught engine errors on its
 *  own -- so every claim keeps its cards' text under "Read the cards", in the page and not behind
 *  a fetch. */
export function EnginesView({ report, graph }: {
  report: DeckReport; graph: CardGraph;
  /** No longer read here: the themes that tapped cards moved to the report's Game plan chapter.
   *  Kept so the shell's props do not change until the Overview's last part moves too. */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onOpenCard?: (id: string) => void;
}) {
  const m = useMemo(() => buildEngineModel(report, graph), [report, graph]);

  if (!m.totalLinks) {
    return <p className="text-(--muted) py-8">The engine found no cards in this deck that work with each other, so there is nothing to judge here yet.</p>;
  }
  return (
    <div className="flex flex-col gap-8 py-2">
      <div className="flex flex-col gap-3">
        {/* THE THEMES AND BEST PAIRS MOVED to the report's Game plan chapter (2026-09-26): the same
          * report twice made no sense. The cards by their job moved to Roles; the cut list follows. */}
        <p className="max-w-[70ch]">Your deck&rsquo;s themes and the pairs that work best together are in the report&rsquo;s <b>Game plan</b> chapter, and its cards by the job they do in <b>Roles</b>. Here: the cards doing the least.</p>
        <RepeatKey />
      </div>

      <section aria-labelledby="eng-cuts" className="flex flex-col gap-3">
        <h2 id="eng-cuts" className="text-lg font-semibold">Cards doing the least here</h2>
        <p className="text-sm text-(--muted) max-w-[70ch]">Cut candidates: the cards that keep working with the fewest others. Every link that repeats counts, including cards that double or copy triggers, and so does helping other cards in the background.</p>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,25rem),1fr))]">
          {m.cuts.map((c) => (
            <article key={c.card.id} className="flex items-start gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
              <CardFace card={c.card} className="w-24 sm:w-28" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div><h3 className="font-semibold text-base"><CardName name={c.card.name} /></h3><p>{c.why}</p></div>
              {c.keep && c.keepActs ? (
                <p className="text-(--muted)"><span className="eyebrow block">Best reason to keep it</span><Badge repeat={c.keep.repeat} /><ReasonText text={c.keep.text} /></p>
              ) : c.keep ? (
                // A FEEDER NAMES WHO USES IT. The line other cards get from it is true of any card
                // of its kind, so it is not "the best reason to keep" this one (round 7); and one
                // fixed sentence on four cards, saying its own abilities do nothing, read as a false
                // verdict beside text that plainly does something (round 8). What the engine knows
                // is which cards use it and that none of its links found uses its own abilities.
                <p className="text-(--muted)">
                  <span className="eyebrow block">Who uses it</span>
                  {names(c.fedBy.slice(0, 3))}{c.fedBy.length > 3 ? ` and ${c.fedBy.length - 3} other${c.fedBy.length === 4 ? "" : "s"}` : ""}.
                  {" "}None of the links found here use its own abilities.
                </p>
              ) : null}
              {c.twins.length ? (
                <p className="text-(--muted)">
                  <span className="eyebrow block">Used by exactly the same cards</span>
                  {/* "Whatever you decide about one goes for all of them" read as "cut all seven"
                    * (round 11). They stand in for each other; they are not a package. */}
                  {names(c.twins)} {c.twins.length === 1 ? "is" : "are"} used by the same cards as {c.card.name.split(" // ")[0]}, so here {c.twins.length === 1 ? "either can" : "any of them can"} stand in for another: cutting one leaves the rest doing the same job.
                </p>
              ) : null}
              <ReadCards cards={[c.card]} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

const names = (list: string[]) => listNames(list);
