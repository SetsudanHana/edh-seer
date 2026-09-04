import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { loadCardPage, type CardPageData } from "../lib/partners.js";
import { AbilityTable } from "./AbilityTable.js";
import { CardArt } from "./CardArt.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { NotFound } from "./NotFound.js";
import { PageFoot } from "./PageFoot.js";
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
    <article className="flex flex-col gap-10">
      {/* THE CARD LEADS, AND NOW IT IS THE CARD. A page about a card that never showed the card was
        * the first thing anyone asked about it. Beside the heading on a wide viewport, above it on a
        * phone -- `flex-wrap` does both without a media query. */}
      <div className="flex flex-wrap-reverse items-end gap-x-6 gap-y-4 max-w-[68ch]">
      <header className="flex flex-col gap-3 flex-1 min-w-[16rem]">
        <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.02em] flex flex-wrap items-center gap-x-4 gap-y-2">
          {page.name}
          {page.manaCost && (
            <span className="text-2xl sm:text-3xl"><ManaSymbols cost={page.manaCost} /></span>
          )}
        </h2>
        <p className="text-(--muted)">{page.typeLine}</p>
        {page.commander && (
          <p>
            <Link
              className="inline-flex items-center gap-2 rounded-(--radius) border border-(--separator) px-3 py-1.5 text-sm hover:border-(--accent) hover:text-(--accent)"
              to={`/commanders/${slug}`}
            >
              What a deck led by this card wants
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        )}
      </header>
      <CardArt artCrop={page.artCrop} name={page.name} />
      </div>

      {/* HOW THE ENGINE READ THE CARD, ability by ability. The union of a card's events -- the panel
        * below -- cannot say WHICH ability produced which claim, and that is the question a reader
        * has when a row looks wrong. This publishes our derivation, never the card's own text: the
        * words are on the image above, where the artist is credited too. */}
      <section className="flex flex-col gap-3 max-w-4xl">
        <h3 className="text-2xl font-bold tracking-[-0.01em]">How the engine reads this card</h3>
        <AbilityTable rows={page.abilities} />
      </section>

      <section className="flex flex-col gap-5 max-w-[68ch]">
        <div className="flex flex-col gap-2">
          <h3 className="text-2xl font-bold tracking-[-0.01em]">Most specific partners</h3>
          <p className="text-(--muted) max-w-[65ch]">
            Ranked by how rare the matched event is across the corpus — how precisely these two cards
            interact, not how good either one is. Every row is an edge the engine drew, in its own
            words.
          </p>
        </div>
        <PartnerList
          rows={page.partners}
          pool={page.pool}
          empty="No partners. Every card this one could feed is fed by so many others that the pairing says nothing, or the engine refused each one on the merits."
        />
      </section>

      <div className="max-w-[68ch]"><PageFoot /></div>
    </article>
  );
}
