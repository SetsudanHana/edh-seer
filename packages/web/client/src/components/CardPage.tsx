import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { loadCardPage, type CardPageData } from "../lib/partners.js";
import { AbilityTable } from "./AbilityTable.js";
import { CardShell } from "./CardShell.js";
import { ClausesRead } from "./ClausesRead.js";
import { NotFound } from "./NotFound.js";
import { PartnerList } from "./PartnerList.js";

/** ONE CARD: what the engine reads on it, and the cards it is most specifically connected to.
 *
 *  TWO SURFACES IN ONE PAGE. It is where a reader looks a card up when reporting a bad edge -- the
 *  reason sentences here are the same ones the deck report prints, so a wrong claim can be named
 *  and quoted from a URL -- and it is the first indexable content this site has beyond two pages.
 *
 *  THE CARD LEADS. The first cut gave the name, the events and the partners the same weight, so the
 *  eye landed nowhere and the page read as a dump of three lists. The name is now display-sized with
 *  its cost beside it, the derivation is one quiet panel, and the partner list -- the thing a reader
 *  came for -- is the body of the page.
 *
 *  `load` is injected so the test needs no fetch and no artifact on disk; production passes nothing
 *  and gets the real loader. */
export function CardPage({ load }: { load?: (slug: string) => Promise<CardPageData | null> }) {
  const { slug = "" } = useParams();
  const [page, setPage] = useState<CardPageData | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (load ? load(slug) : loadCardPage(slug, "/static")).then((p) => { if (live) setPage(p); });
    // A SLOW SHARD FOR THE CARD YOU LEFT MUST NOT OVERWRITE THE ONE YOU ARRIVED AT. Two clicks
    // through partner links race, and the loser is whichever shard happens to be larger.
    return () => { live = false; };
  }, [slug, load]);

  if (page === undefined) return <p className="eyebrow text-(--muted)">reading the corpus</p>;
  if (page === null) return <NotFound slug={slug} kind="card" />;

  // THE MEASURE IS PER SECTION, NOT PER PAGE. Prose gets a reading width so hairlines stop running
  // a third of the viewport past the text they belong to; the TABLE does not, because a table is
  // the one thing on this page that earns the extra width -- four columns squeezed into 68ch wrap
  // every cell. DESIGN.md's own rule: a wide viewport buys columns.
  return (
    <CardShell page={page} slug={slug} surface="card" peekLoad={load}>
      {/* The reading table on a phone sits here, above the partners, because the rail's stacked
        *  copy is hidden below `lg` (it is card-shaped metadata and the rail is the card's). */}
      {/* FOLDED ON A PHONE (UX review, 2026-09-17): open, this table put the partners 1,335px
        *  down a 390px screen. The heading is the summary, the chevron the same one the search
        *  page's "What it does" chip carries. */}
      <details className="lg:hidden group/reads flex flex-col gap-3">
        <summary className="cursor-pointer list-none flex items-center gap-2 w-fit">
          <h2 className="text-2xl font-bold tracking-[-0.01em]">How the engine reads this card</h2>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="transition-transform duration-150 ease-out group-open/reads:rotate-180 motion-reduce:transition-none">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="mt-3"><AbilityTable rows={page.abilities} /></div>
      </details>

      <ClausesRead clauses={page.clauses} />

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 max-w-[68ch]">
          <h2 className="text-2xl font-bold tracking-[-0.01em]">Partners</h2>
          <p className="text-(--muted) max-w-[65ch]">
            Ranked over every card the engine has read, by how rare the matched event is across the
            corpus: how precisely these two cards interact, not how good either one is. Every row is
            an edge the engine drew, in its own words. Pick a card to look at it here; open it from
            there.
          </p>
        </div>
        <PartnerList
          subject={page.name}
          rows={page.partners}
          pool={page.pool}
          rarity={page.rarity}
          empty="No partners. Every card this one could feed is fed by so many others that the pairing says nothing, or the engine refused each one on the merits."
        />
      </section>
    </CardShell>
  );
}
