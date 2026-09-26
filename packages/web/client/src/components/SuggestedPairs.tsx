import { Link } from "react-router";
import type { SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { cardImageUrl } from "./card-node.js";
import { peekOnPlainClick, usePeek } from "./peek.js";

/** A card's face at swap size, or its name in a frame where the art is unknown. */
function Face({ name, art, className }: { name: string; art?: string; className: string }) {
  const src = art ? cardImageUrl(art) : null;
  return src
    ? <img src={src} alt="" loading="lazy" decoding="async" width={488} height={680} className={`block aspect-[488/680] h-auto shrink-0 rounded-[4.5%/3.3%] shadow-md shadow-black/40 ${className}`} />
    // No art: an empty frame, since the name is printed beside it.
    : <span title={name} className={`block aspect-[488/680] shrink-0 rounded-[6%/4.4%] border border-(--separator) bg-(--surface-secondary) ${className}`} />;
}

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

/** THE SWAP AS TWO CARDS (appeal review 2026-09-26): the most actionable line in the chapter read
 *  as a footnote while it was "Shared Animosity → Quest for the Goblin Lord" in grey text. */
function Row({ p, artOf }: { p: SuggestedPair; artOf?: (name: string) => string | undefined }) {
  const peek = usePeek();
  return (
    // `relative`: the sr-only spans need a positioned ancestor, or they resolve against the initial
    // containing block and can inflate the page's scroll width (ui.md, narrow-width defences).
    <li className="relative flex items-start gap-3 py-3 border-b border-(--separator) min-w-0 sm:gap-4">
      <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
        <Face name={p.cut} art={artOf?.(p.cut)} className="w-14 opacity-70 sm:w-20" />
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-(--accent) shrink-0">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        <Face name={p.add.name} art={p.add.art} className="w-14 sm:w-20" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex items-center gap-x-2 flex-wrap">
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
            className="font-semibold min-h-11 inline-flex items-center hover:text-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) rounded-(--radius)"
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
      </div>
    </li>
  );
}

/** A CUT AND THE CARD THAT TAKES ITS SLOT (spec §3). Cross-job pairs render under the findings'
 *  "where to find the slots", same-job and no-role pairs beside the cut list; nothing, not even a
 *  heading, when there are none -- a tight deck is never handed forced swaps. */
export function SuggestedPairs({ pairs, artOf }: {
  pairs: readonly SuggestedPair[];
  /** A deck card's art by name, for the card going out. */
  artOf?: (name: string) => string | undefined;
}) {
  if (pairs.length === 0) return null;
  return <ul className="flex flex-col border-t border-(--separator)">{pairs.map((p) => <Row key={`${p.cut}>${p.add.name}`} p={p} artOf={artOf} />)}</ul>;
}
