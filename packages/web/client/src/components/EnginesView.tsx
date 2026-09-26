import type { CardGraph, DeckReport } from "../types.js";

/** THE GRAPH TAB'S LANDING VIEW, FOLDED INTO THE REPORT (2026-09-26). It was what the deck does,
 *  in groups of named cards (graph evaluation 2026-09-25); the owner's ruling was that a second
 *  report beside the first makes no sense, so its parts moved into the report's chapters one step
 *  at a time: the themes and best pairs to Game plan, the cards by their job to Roles, and the cards
 *  doing the least to How to improve, as one cut list with the report's own. What is left points
 *  there, until the Graph tab opens on the one-card view. */
export function EnginesView(_props: {
  /** No longer read here: every part moved to the report. Kept so the shell's props do not change
   *  until the Overview goes. */
  report: DeckReport; graph: CardGraph;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onOpenCard?: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="max-w-[70ch]">
        Everything this view showed is now in the report: your deck&rsquo;s themes and best pairs in <b>Game plan</b>,
        its cards by the job they do in <b>Roles</b>, and the cards doing the least in <b>How to improve it</b>.
        Use <b>One card</b> above to follow any card&rsquo;s links.
      </p>
    </div>
  );
}
