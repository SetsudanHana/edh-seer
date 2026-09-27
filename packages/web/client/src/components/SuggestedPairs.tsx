import { Link } from "react-router";
import type { SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { cardImageUrl } from "./card-node.js";
import { peekOnPlainClick, usePeek } from "./peek.js";
import { CardMenuButton } from "./card-menu.js";
import { useCardDrawer } from "./card-drawer.js";
import { openSuggestedCard } from "./SuggestionPanel.js";

/** A card's face at swap size, or its name in a frame where the art is unknown. */
function Face({ name, art, className }: { name: string; art?: string; className: string }) {
  const src = art ? cardImageUrl(art) : null;
  return src
    ? <img src={src} alt="" loading="lazy" decoding="async" width={488} height={680} className={`block aspect-[488/680] h-auto shrink-0 rounded-[4.5%/3.3%] shadow-md shadow-black/40 ${className}`} />
    // No art: an empty frame, since the name is printed beside it.
    : <span title={name} className={`block aspect-[488/680] shrink-0 rounded-[6%/4.4%] border border-(--separator) bg-(--surface-secondary) ${className}`} />;
}

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

/** THE CARD THAT COULD TAKE A CUT'S SLOT, on the cut's own card (baseline round 2026-09-26: "cuts
 *  and adds are not one plan"). A pair used to be its own list, under the findings for a cross-job
 *  swap and under the cuts for the rest, so a reader matched each add to its cut by name. Now the
 *  add sits on the cut it replaces, with the one claim a pair makes: the add connects to more of the
 *  deck than the cut (spec §3), and a cross-job swap moves two groups' counts. */
export function SwapLine({ p }: { p: SuggestedPair }) {
  const peek = usePeek();
  const drawer = useCardDrawer();
  return (
    <div className="relative flex items-start gap-3 border-t border-(--separator) pt-2 min-w-0" data-testid="swap">
      <Face name={p.add.name} art={p.add.art} className="w-12 sm:w-14" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span className="text-(--muted)">Swap it for</span>{" "}
          <Link
            to={`/cards/${p.add.slug}`}
            onClick={(ev) => { openSuggestedCard(drawer, (e) => peekOnPlainClick(peek, p.add.slug, e), p.add, ev, p.cut); }}
            className="font-semibold min-h-11 sm:min-h-0 inline-flex items-center hover:text-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) rounded-(--radius)"
          >
            {p.add.name}
          </Link>
        </p>
        {/* THE ADD'S OWN COUNT, NOT A FROM-TO. "connections 13 → 42" sat under a cut that said "keeps
          *  working with only 4 other cards": the 13 counts every link and the 4 only the repeating ones,
          *  so the pair read as the page disagreeing with itself (Party Time at 390px, 2026-09-27). */}
        <p className="text-xs text-(--muted)">
          works with <span className="tabular-nums">{p.add.connections.length}</span> of your cards
          {p.counts.length > 0 ? (
            <>
              {" · "}
              {p.counts.map((c, i) => (
                <span key={c.group}>{i > 0 ? ", " : ""}{c.group} <Move from={c.from} to={c.to} /></span>
              ))}
            </>
          ) : null}
        </p>
        {p.add.reasons[0] ? <p className="text-xs max-w-[65ch]">{p.add.reasons[0].text}</p> : null}
      </div>
      <CardMenuButton name={p.add.name} className="ml-auto" />
    </div>
  );
}
