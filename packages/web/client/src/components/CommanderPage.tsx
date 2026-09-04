import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { themesOf, unmetDemands } from "@edh-seer/matcher/partners-core";
import { eventKeySentence } from "../lib/demand-sentence.js";
import { loadCardPage, type CardPageData } from "../lib/partners.js";

/** WHAT A DECK LED BY THIS CARD WANTS.
 *
 *  IT HAS TO DIFFER IN SUBSTANCE FROM `/cards/:slug` (spec D5) or the two URLs are duplicate content
 *  competing with each other. Three differences, and each is a different question:
 *   - the partners are ranked over the cards this commander's deck could LEGALLY contain, which is
 *     a different list in a different order, not a filtered view of the card page's;
 *   - the archetype labels its own events point at, from `themesOf`;
 *   - the events it watches and does not cause itself -- what the other 99 cards have to bring.
 *
 *  Each page links to the other rather than repeating it. */
export function CommanderPage({ load }: { load?: (slug: string) => Promise<CardPageData | null> }) {
  const { slug = "" } = useParams();
  const [page, setPage] = useState<CardPageData | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (load ? load(slug) : loadCardPage(slug, "/static")).then((p) => { if (live) setPage(p); });
    return () => { live = false; };
  }, [slug, load]);

  if (page === undefined) return <p className="text-(--muted)">Reading the corpus…</p>;

  // SAME TWO CASES AS THE CARD PAGE, and the same refusal to guess which: a slug the artifact does
  // not hold is either a card that produced no events or a name that is wrong.
  if (page === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-3xl font-semibold">No page for “{slug}”</h2>
        <p className="text-(--muted)">
          Either that name is wrong, or the engine found nothing to say about the card. A commander
          page exists only for a legendary creature whose oracle text produces an event some other
          card can answer.
        </p>
        <p>
          <Link className="text-(--accent) hover:underline" to="/commanders">Search the commanders →</Link>
        </p>
      </section>
    );
  }

  const toCard = (
    <Link className="text-(--accent) hover:underline" to={`/cards/${slug}`}>
      What the engine reads on this card →
    </Link>
  );

  // THE URL IS GUESSABLE, so a reader will arrive here for Sol Ring. Saying what is wrong with the
  // question beats rendering an empty page that looks broken.
  if (!page.commander) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-3xl font-semibold">{page.name}</h2>
        <p className="text-(--muted)">
          {page.name} cannot lead a deck — this page is for legendary creatures that can be a
          commander. The card itself has a page.
        </p>
        <p>{toCard}</p>
      </section>
    );
  }

  const themes = themesOf(page.emits, page.demands);
  const gaps = unmetDemands(page.emits, page.demands);
  const rows = page.commanderPartners ?? [];
  const pool = page.commanderPool ?? {};
  const shownPerEvent = rows.reduce<Record<string, number>>((acc, p) => {
    acc[p.event] = (acc[p.event] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="text-3xl font-semibold">{page.name}</h2>
        <p className="text-(--muted)">
          {page.typeLine}{page.manaCost ? <> · <span className="font-mono">{page.manaCost}</span></> : null}
        </p>
        <p>{toCard}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">What its own events point at</h3>
        {/* EVERY LABEL THAT FITS, never one picked from several. A commander that makes tokens and
          * watches creatures die is both, and choosing between them would need a priority order
          * nothing here has measured. */}
        {themes.length === 0
          ? <p className="text-(--muted)">
              No archetype signature. Its events are the broad ones — drawing, damage, ramp — that
              every deck runs, so they name no strategy on their own.
            </p>
          : <ul className="flex flex-wrap gap-2">
              {themes.map((t) => <li key={t} className="rounded-md bg-(--surface-secondary) px-2 py-1">{t}</li>)}
            </ul>}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">What the other 99 cards have to bring</h3>
        {gaps.length === 0
          ? <p className="text-(--muted)">
              Nothing: it answers every event it watches, or it watches none at all.
            </p>
          : <>
              <p className="text-(--muted)">
                Events it triggers on and does not cause itself.
              </p>
              <ul className="flex flex-col gap-1">
                {gaps.map((d) => <li key={d}>{eventKeySentence(d)}</li>)}
              </ul>
            </>}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="eyebrow">Partners inside its colour identity</h3>
        <p className="text-(--muted)">
          Ranked over the cards a deck led by {page.name} could legally contain — not the whole
          corpus, which is what the card page ranks over.
        </p>
        {rows.length === 0
          ? <p className="text-(--muted)">
              No partners inside this identity. Every card it could feed is fed by so many others
              that the pairing says nothing, or the engine refused each one on the merits.
            </p>
          : <ol className="flex flex-col gap-3">
              {rows.map((p) => (
                <li key={`${p.event}:${p.slug}`} className="flex flex-col gap-1">
                  <p>
                    <Link className="text-(--accent) hover:underline" to={`/cards/${p.slug}`}>{p.name}</Link>{" "}
                    <span className="text-sm text-(--muted)">{eventKeySentence(p.event)}</span>
                  </p>
                  <p className="text-(--muted)">{p.reason}</p>
                </li>
              ))}
            </ol>}
        {Object.entries(shownPerEvent)
          .map(([event, shown]) => [event, (pool[event] ?? shown) - shown] as const)
          .filter(([, more]) => more > 0)
          .map(([event, more]) => (
            <p key={event} className="text-(--muted) text-sm">
              And {more.toLocaleString("en-US")} more cards in this identity trigger on{" "}
              {eventKeySentence(event)}, which this commander supplies. They rank identically, so
              the page shows a few.
            </p>
          ))}
      </section>
    </section>
  );
}
