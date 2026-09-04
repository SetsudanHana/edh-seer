import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { eventKeySentence } from "../lib/demand-sentence.js";
import { loadCardPage, type CardPageData } from "../lib/partners.js";
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

  // ONE READING MEASURE FOR THE WHOLE PAGE. The container is 1024px wide and the prose wrapped at
  // 65ch inside it, so every hairline and panel edge ran a third of the viewport past the text it
  // belonged to -- rules pointing at nothing. The measure belongs to the ARTICLE, not to each
  // paragraph.
  return (
    <article className="flex flex-col gap-10 max-w-[68ch]">
      <header className="flex flex-col gap-3">
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

      {/* THE DERIVATION, QUIET AND ON ONE PANEL. It is evidence rather than the argument: a reader
        * checking a claim wants it, a reader browsing does not, and giving it the same weight as
        * the partner list is what made the first version read as three equal lists. */}
      <section className="rounded-(--radius) border border-(--separator) bg-(--surface) p-5 grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow text-(--muted)">supplies</h3>
          {page.emits.length === 0
            ? <p className="text-(--muted)">Nothing. It triggers on events but supplies none.</p>
            : <ul className="flex flex-col gap-1">
                {page.emits.map((e) => <li key={e}>{eventKeySentence(e)}</li>)}
              </ul>}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow text-(--muted)">cares about</h3>
          {page.demands.length === 0
            ? <p className="text-(--muted)">Nothing. It supplies events but triggers on none.</p>
            : <ul className="flex flex-col gap-1">
                {page.demands.map((d) => <li key={d}>{eventKeySentence(d)}</li>)}
              </ul>}
        </div>
      </section>

      <section className="flex flex-col gap-5">
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

      <PageFoot />
    </article>
  );
}
