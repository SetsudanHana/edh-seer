import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { eventKeySentence } from "../lib/demand-sentence.js";
import { loadCardPage, type CardPageData } from "../lib/partners.js";

/** ONE CARD: what the engine reads on it, and the cards it is most specifically connected to.
 *
 *  TWO SURFACES IN ONE PAGE. It is where a reader looks a card up when reporting a bad edge -- the
 *  reason sentences here are the same ones the deck report prints, so a wrong claim can be named
 *  and quoted from a URL -- and it is the first indexable content this site has beyond two pages.
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

  if (page === undefined) return <p className="text-(--muted)">Reading the corpus…</p>;

  // TWO DIFFERENT THINGS LAND HERE AND THIS PAGE CANNOT TELL THEM APART, so it must not claim to.
  //
  // The artifact holds the 15,384 cards the engine could read. A slug missing from it is either a
  // real card that produced no events -- Sol Ring, whose mana ability is neither an emit nor a
  // trigger -- or a name that is simply wrong. Distinguishing them would need the whole 34,000-card
  // corpus in the browser, which is not a download this page is worth.
  //
  // The first cut said "This card has not been read by the engine", which asserts a card exists at
  // a URL that may name nothing, and then invited an issue about it -- owner-reported after reading
  // it on a typo. Naming BOTH possibilities is the honest sentence, and the search link is the one
  // that actually helps when the name is the problem.
  if (page === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-3xl font-semibold">No page for “{slug}”</h2>
        <p className="text-(--muted)">
          Either that name is wrong, or the engine read the card and found nothing to say about it:
          a page exists only where the oracle text produces an event some other card can answer. A
          card that just adds mana, or draws you a card, forms no edges and gets no page.
        </p>
        <p>
          <Link className="text-(--accent) hover:underline" to="/cards">Search the cards →</Link>
        </p>
        <p className="text-(--muted) text-sm">
          If you know this card and expected edges from it,{" "}
          <a className="text-(--accent) hover:underline" href="https://github.com/SetsudanHana/edh-seer/issues/new"
            target="_blank" rel="noopener noreferrer">open an issue</a>{" "}
          with the card name — a card read badly is a fixable bug rather than an opinion.
        </p>
      </section>
    );
  }

  // ROWS PER EVENT, so the "and N more" line attaches to the event it is about rather than to the
  // page. `PER_EVENT_CAP` caps each event separately, so one page can withhold on several.
  const shownPerEvent = page.partners.reduce<Record<string, number>>((acc, p) => {
    acc[p.event] = (acc[p.event] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        {/* AN `h2`, NOT AN `h1`: `index.html` carries the page's one `h1` on the static header and
          * `seo.test.ts` asserts it. Task 11 injects a card-specific heading outside `#root`, which
          * is what a crawler reads. */}
        <h2 className="text-3xl font-semibold">{page.name}</h2>
        <p className="text-(--muted)">
          {page.typeLine}{page.manaCost ? <> · <span className="font-mono">{page.manaCost}</span></> : null}
        </p>
        {page.commander && (
          <p><Link className="text-(--accent) hover:underline" to={`/commanders/${slug}`}>
            What a deck led by this card wants →
          </Link></p>
        )}
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">What it produces</h3>
        {page.emits.length === 0
          ? <p className="text-(--muted)">Nothing. This card triggers on events but supplies none.</p>
          : <ul className="flex flex-col gap-1">
              {page.emits.map((e) => <li key={e}>{eventKeySentence(e)}</li>)}
            </ul>}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">What it cares about</h3>
        {page.demands.length === 0
          ? <p className="text-(--muted)">Nothing. This card supplies events but does not trigger on any.</p>
          : <ul className="flex flex-col gap-1">
              {page.demands.map((d) => <li key={d}>{eventKeySentence(d)}</li>)}
            </ul>}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="eyebrow">Most specific partners</h3>
        <p className="text-(--muted)">
          Ranked by how rare the matched event is across the corpus — how precisely these two cards
          interact, not how good either one is. Every row is an edge the engine drew, in its own
          words.
        </p>
        {page.partners.length === 0
          ? <p className="text-(--muted)">
              No partners. Every card this one could feed is fed by so many others that the pairing
              says nothing, or the engine refused each one on the merits.
            </p>
          : <ol className="flex flex-col gap-3">
              {page.partners.map((p) => (
                <li key={`${p.event}:${p.slug}`} className="flex flex-col gap-1">
                  <p>
                    <Link className="text-(--accent) hover:underline" to={`/cards/${p.slug}`}>{p.name}</Link>{" "}
                    <span className="text-sm text-(--muted)">{eventKeySentence(p.event)}</span>
                  </p>
                  <p className="text-(--muted)">{p.reason}</p>
                </li>
              ))}
            </ol>}
        {/* WHAT THE CAP WITHHELD, SAID RATHER THAN PADDED. Twenty rows that all read "triggers when
          * a creature enters" are one fact printed twenty times. `pool` counts CANDIDATES -- cards
          * that demand the event -- not verified edges, so the sentence says "demand" and not
          * "pairs with": the engine was never asked about the ones past the cap. */}
        {Object.entries(shownPerEvent)
          .map(([event, shown]) => [event, (page.pool[event] ?? shown) - shown] as const)
          .filter(([, more]) => more > 0)
          .map(([event, more]) => (
            <p key={event} className="text-(--muted) text-sm">
              And {more.toLocaleString("en-US")} more cards trigger on {eventKeySentence(event)},
              which this card supplies. They rank identically, so the page shows a few rather than
              all of them.
            </p>
          ))}
      </section>
    </section>
  );
}
