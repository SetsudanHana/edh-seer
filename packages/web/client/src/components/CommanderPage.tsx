import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { themesOf, unmetDemands } from "@edh-seer/matcher/partners-core";
import { eventKeySentence } from "../lib/demand-sentence.js";
import { loadCardPage, type CardPageData } from "../lib/partners.js";
import { CardArt } from "./CardArt.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { NotFound } from "./NotFound.js";
import { PageFoot } from "./PageFoot.js";
import { PartnerList } from "./PartnerList.js";

/** WHAT A DECK LED BY THIS CARD WANTS.
 *
 *  IT HAS TO DIFFER IN SUBSTANCE FROM `/cards/:slug` (spec D5) or the two URLs are duplicate content
 *  competing with each other. Three differences, and each is a different question:
 *   - the partners are ranked over the cards this commander's deck could LEGALLY contain, which is
 *     a different list in a different order, not a filtered view of the card page's;
 *   - the archetype labels its own events point at;
 *   - the events it watches and does not cause itself -- what the other 99 cards have to bring.
 *
 *  THE GAP LIST LEADS, not the partner list, and that is the whole difference in reading order. A
 *  card page answers "who does this pair with"; this page answers "what does this deck still need",
 *  which is the question someone choosing a commander is actually holding. */
export function CommanderPage({ load }: { load?: (slug: string) => Promise<CardPageData | null> }) {
  const { slug = "" } = useParams();
  const [page, setPage] = useState<CardPageData | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (load ? load(slug) : loadCardPage(slug, "/static")).then((p) => { if (live) setPage(p); });
    return () => { live = false; };
  }, [slug, load]);

  if (page === undefined) return <p className="eyebrow text-(--muted)">reading the corpus</p>;
  if (page === null) return <NotFound slug={slug} kind="commander" />;

  const toCard = (
    <Link
      className="inline-flex items-center gap-2 rounded-(--radius) border border-(--separator) px-3 py-1.5 text-sm hover:border-(--accent) hover:text-(--accent)"
      to={`/cards/${slug}`}
    >
      What the engine reads on this card
      <span aria-hidden="true">→</span>
    </Link>
  );

  // THE CARD LEADS, AND NOW IT IS THE CARD. A page about a card that never showed the card was the
  // first thing anyone asked about it. Beside the heading on a wide viewport, above it on a phone --
  // `flex-wrap-reverse` does both without a media query.
  const header = (
    <header className="flex flex-col gap-3">
      <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.02em] flex flex-wrap items-center gap-x-4 gap-y-2">
        {page.name}
        {page.manaCost && (
          <span className="text-2xl sm:text-3xl"><ManaSymbols cost={page.manaCost} /></span>
        )}
      </h2>
      <p className="text-(--muted)">{page.typeLine}</p>
      <p>{toCard}</p>
    </header>
  );

  // THE URL IS GUESSABLE, so a reader will arrive here for Sol Ring. Saying what is wrong with the
  // question beats rendering an empty page that looks broken.
  if (!page.commander) {
    return (
      <article className="flex flex-col gap-8 max-w-[68ch]">
        <div className="max-w-[68ch]">{header}</div>
        <CardArt artCrop={page.artCrop} name={page.name} />
        <p className="text-(--muted) max-w-[65ch]">
          {page.name} cannot lead a deck. This page is for legendary creatures that can be a
          commander; the card itself has one.
        </p>
        <PageFoot />
      </article>
    );
  }

  const themes = themesOf(page.emits, page.demands);
  const gaps = unmetDemands(page.emits, page.demands);

  return (
    <article className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-x-10 lg:items-start max-w-7xl">
    <div className="flex flex-col gap-10 min-w-0">
      {header}

      {/* ONE LINE, NOT A PANEL. It was a ~1,000px surface holding two items and ~30px of content,
        * and both of them were kickers -- "ITS EVENTS POINT AT" stacked above "Tokens" -- which is
        * the one typographic rule this system names outright: a label pairs INLINE with its value or
        * it is the heading. A design review called it "one sentence of information wearing a
        * container". */}
      <div className="flex flex-col gap-2 max-w-[68ch]">
        <p>
          <span className="eyebrow text-(--muted)">its events point at </span>
          {themes.length === 0
            ? <span className="text-(--muted)">no archetype — its events are the broad ones every deck runs</span>
            : themes.join(" · ")}
        </p>
        <p>
          <span className="eyebrow text-(--muted)">the other 99 have to bring </span>
          {gaps.length === 0
            ? <span className="text-(--muted)">nothing — it answers every event it watches</span>
            : gaps.map(eventKeySentence).join(" · ")}
        </p>
      </div>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 max-w-[68ch]">
          <h3 className="text-2xl font-bold tracking-[-0.01em]">Partners inside its colour identity</h3>
          <p className="text-(--muted) max-w-[65ch]">
            Ranked over the cards a deck led by {page.name} could legally contain — not the whole
            corpus, which is what the card page ranks over.
          {" "}
            The fewer cards can cause an event, the higher the pairing ranks.</p>
        </div>
        <PartnerList
          rows={page.commanderPartners ?? []}
          pool={page.commanderPool ?? {}}
          rarity={page.commanderRarity ?? {}}
          empty="No partners inside this identity. Every card it could feed is fed by so many others that the pairing says nothing, or the engine refused each one on the merits."
        />
      </section>

      <PageFoot />
    </div>
    <aside className="order-first lg:order-last lg:sticky lg:top-6">
      <CardArt artCrop={page.artCrop} name={page.name} />
    </aside>
    </article>
  );
}
