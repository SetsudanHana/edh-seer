import { Link } from "react-router";
import type { SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { peekOnPlainClick, usePeek } from "./peek.js";

/** "13 to 12" set as "13 → 12", read as "13 to 12": the arrow is drawn, the word is spoken. */
function Move({ from, to }: { from: number; to: number }) {
  return (
    <span className="tabular-nums whitespace-nowrap">
      {from}
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block mx-1 align-[-1px]">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
      <span className="sr-only"> to </span>
      {to}
    </span>
  );
}

function Row({ p }: { p: SuggestedPair }) {
  const peek = usePeek();
  return (
    // `relative`: the sr-only spans need a positioned ancestor, or they resolve against the initial
    // containing block and can inflate the page's scroll width (ui.md, narrow-width defences).
    <li className="relative flex flex-col gap-1 py-3 border-b border-(--separator) min-w-0">
      <p className="flex items-center gap-x-2 flex-wrap min-h-11">
        <span className="sr-only">Replace </span>
        <span className="text-(--muted)">{p.cut}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-(--accent) shrink-0">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        <span className="sr-only"> with </span>
        <Link
          to={`/cards/${p.add.slug}`}
          onClick={(ev) => { peekOnPlainClick(peek, p.add.slug, ev); }}
          className="font-semibold hover:text-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) rounded-(--radius)"
        >
          {p.add.name}
        </Link>
      </p>
      <p className="text-sm text-(--muted)">
        {/* WHAT THE SWAP CHANGES, the only claim a pair makes: the add connects to more of the deck
          *  than the cut (spec §3), and a cross-job swap moves two groups' counts. */}
        connections <Move from={p.cutConnections} to={p.add.connections.length} />
        {p.counts.length > 0 ? (
          <>
            {" · "}
            {p.counts.map((c, i) => (
              <span key={c.group}>{i > 0 ? ", " : ""}{c.group} <Move from={c.from} to={c.to} /></span>
            ))}
          </>
        ) : null}
      </p>
      {p.add.reasons[0] ? <p className="text-sm max-w-[70ch]">{p.add.reasons[0].text}</p> : null}
    </li>
  );
}

/** A CUT AND THE CARD THAT TAKES ITS SLOT (spec §3). Cross-job pairs render under the findings'
 *  "where to find the slots", same-job and no-role pairs beside the cut list; nothing, not even a
 *  heading, when there are none -- a tight deck is never handed forced swaps. */
export function SuggestedPairs({ pairs }: { pairs: readonly SuggestedPair[] }) {
  if (pairs.length === 0) return null;
  return <ul className="flex flex-col border-t border-(--separator)">{pairs.map((p) => <Row key={`${p.cut}>${p.add.name}`} p={p} />)}</ul>;
}
