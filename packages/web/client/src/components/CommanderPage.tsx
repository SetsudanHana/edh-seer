import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { identityKeyOf, themesOf, unmetDemands } from "@edh-seer/matcher/partners-core";
import { identityLabel } from "../lib/color-identity.js";
import { eventKeySentence } from "../lib/demand-sentence.js";
import { loadCardPage, type CardPageData, type PartnerRow } from "../lib/partners.js";
import { CardArt } from "./CardArt.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { NotFound } from "./NotFound.js";
import { PageFoot } from "./PageFoot.js";
import { PartnerList } from "./PartnerList.js";

type Ranked = { partners: PartnerRow[]; pool: Record<string, number>; rarity: Record<string, number> };

/** THE LIST ONE HALF OF A PAIR CARRIES AT AN IDENTITY: the precomputed variant when the identity is
 *  a widened one, its own list when the identity is its own, and nothing when the build did not
 *  make it -- which the caller says out loud rather than showing an empty page. */
const listAt = (h: CardPageData, key: string): Ranked | null =>
  h.commanderPartnersBy?.[key]
  ?? (identityKeyOf(h.identity) === key
    ? { partners: h.commanderPartners ?? [], pool: h.commanderPool ?? {}, rarity: h.commanderRarity ?? {} }
    : null);

/** TWO SINGLE-CARD RANKINGS MERGED, NOT A RANKING OF THE PAIR. A card both halves reach appears
 *  once with its better score; pool and rarity take the larger figure. CEILING: no page per pair,
 *  so nothing here asks the engine about the pair as one subject. */
const merge = (halves: Ranked[]): Ranked => {
  const bySlug = new Map<string, PartnerRow>();
  const pool: Record<string, number> = {};
  const rarity: Record<string, number> = {};
  for (const h of halves) {
    for (const r of h.partners) {
      const prev = bySlug.get(r.slug);
      if (!prev || r.score > prev.score) bySlug.set(r.slug, r);
    }
    for (const [k, v] of Object.entries(h.pool)) pool[k] = Math.max(pool[k] ?? 0, v);
    for (const [k, v] of Object.entries(h.rarity)) rarity[k] = Math.max(rarity[k] ?? 0, v);
  }
  return { partners: [...bySlug.values()].sort((a, b) => b.score - a.score), pool, rarity };
};

const COLOURS: { letter: string; word: string }[] = [
  { letter: "W", word: "white" }, { letter: "U", word: "blue" }, { letter: "B", word: "black" },
  { letter: "R", word: "red" }, { letter: "G", word: "green" },
];

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
 *  which is the question someone choosing a commander is actually holding.
 *
 *  A PAIR IS A LINK. A commander that may lead with another card (CR 702.124) or that picks its
 *  colour before the game (CR 903.4b) offers the choice, and the choice lives in the URL --
 *  `?with=<slug>`, `&color=<W|U|B|R|G>` -- so the identity and the list for that pair can be
 *  shared and the back button undoes a pick. The owner's Ninth Doctor deck kept Clara Oswald as the
 *  companion and three thirty-card colour packs beside a sixty-eight card Izzet core; that deck is
 *  `?with=clara-oswald&color=U`. */
export function CommanderPage({ load }: { load?: (slug: string) => Promise<CardPageData | null> }) {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const withSlug = params.get("with") ?? undefined;
  const colorParam = params.get("color") ?? undefined;
  const loader = load ?? ((s: string) => loadCardPage(s, "/static"));
  const [page, setPage] = useState<CardPageData | null | undefined>(undefined);
  const [pair, setPair] = useState<CardPageData | null>(null);
  useEffect(() => {
    let live = true;
    void loader(slug).then((p) => { if (live) setPage(p); });
    return () => { live = false; };
  }, [slug, load]);
  // THE PARTNER'S OWN RECORD, only when the URL names one this card may actually lead with. A slug
  // the record does not list is ignored rather than fetched: the page offers pairs, it does not
  // take orders for them.
  const licensed = page?.pairsWith?.some((p) => p.slug === withSlug) === true;
  useEffect(() => {
    let live = true;
    // Cleared first, so switching partners never shows the previous one's identity for a frame.
    setPair(null);
    if (!licensed || !withSlug) return;
    void loader(withSlug).then((p) => { if (live) setPair(p); });
    return () => { live = false; };
  }, [withSlug, licensed, load]);

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
          {page.name} cannot lead a deck. This page is for cards that can be a commander; the card
          itself has one.
        </p>
        <PageFoot />
      </article>
    );
  }

  const themes = themesOf(page.emits, page.demands);
  const gaps = unmetDemands(page.emits, page.demands);

  // THE ENGINE READ NOTHING ON THIS CARD. Every legal commander has a page; 509 of them carry no
  // derived ability, and the three sentences below are only true of a card that was read.
  const unread = page.abilities.length === 0;
  // THE IDENTITY THE DECK WOULD HAVE: the card's own, the chosen colour when EITHER half picks one
  // (Clara beside a Doctor is the Doctor's page too), and the picked partner's. The key is what the
  // build ranked under.
  const chooses = page.choosesColour === true || pair?.choosesColour === true;
  const colour = chooses && colorParam && COLOURS.some((c) => c.letter === colorParam) ? colorParam : undefined;
  const identity = [...page.identity, ...(colour ? [colour] : []), ...(pair?.identity ?? [])];
  const key = identityKeyOf(identity);
  const halves = [page, ...(pair ? [pair] : [])].map((h) => ({ h, list: listAt(h, key) }));
  const fallback = halves.some((x) => x.list === null);
  const ranked = merge(halves.map((x) => x.list ?? listAt(x.h, identityKeyOf(x.h.identity))!));

  const pairHref = (p: { slug: string }) => `/commanders/${slug}?with=${p.slug}${colour ? `&color=${colour}` : ""}`;
  const colourHref = (letter: string) => `/commanders/${slug}?${withSlug && licensed ? `with=${withSlug}&` : ""}color=${letter}`;
  const licences = [...new Set((page.pairsWith ?? []).map((p) => p.licence))];

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
          <span className="eyebrow text-(--muted)">colour identity </span>
          {identityLabel(identity)}
          {pair ? <span className="text-(--muted)"> — with {pair.name}</span> : null}
          {colour ? <span className="text-(--muted)"> — {COLOURS.find((c) => c.letter === colour)!.word} chosen</span> : null}
        </p>
        {page.pairingOnly ? (
          <p className="text-(--muted) max-w-[65ch]">
            A Background is a second commander: it leads only beside a card that prints "Choose a
            Background". Pick one below to see the pair.
          </p>
        ) : null}
        {unread ? (
          <p className="text-(--muted) max-w-[65ch]">
            The engine read nothing on this card: no ability it could derive, so no events, no
            gaps and no partners to rank. Either the card prints only keywords, or its text is one
            the engine cannot yet read — the card page shows which.
          </p>
        ) : (<>
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
        </>)}
      </div>

      {(licences.length > 0 || chooses) && (
        <section className="flex flex-col gap-4 max-w-[68ch]">
          <h3 className="text-2xl font-bold tracking-[-0.01em]">Pair with</h3>
          {chooses && (
            <div className="flex flex-col gap-2">
              <p id="pair-colour" className="eyebrow text-(--muted)">
                {page.choosesColour ? "its colour, chosen before the game" : `${pair!.name}'s colour, chosen before the game`}
              </p>
              <ul className="flex flex-wrap gap-2" aria-labelledby="pair-colour">
                {COLOURS.map((c) => (
                  <li key={c.letter}>
                    <Link
                      className="inline-flex rounded-(--radius) border border-(--separator) px-3 py-1.5 text-sm hover:border-(--accent) hover:text-(--accent) aria-[current=true]:border-(--accent) aria-[current=true]:text-(--accent)"
                      to={colourHref(c.letter)}
                      aria-current={colour === c.letter ? "true" : undefined}
                    >
                      {c.word}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {licences.map((licence, i) => (
            <div key={licence} className="flex flex-col gap-2">
              <p id={`pair-licence-${i}`} className="eyebrow text-(--muted)">{licence}</p>
              <ul className="flex flex-wrap gap-2" aria-labelledby={`pair-licence-${i}`}>
                {(page.pairsWith ?? []).filter((p) => p.licence === licence).map((p) => (
                  <li key={p.slug}>
                    <Link
                      className="inline-flex rounded-(--radius) border border-(--separator) px-3 py-1.5 text-sm hover:border-(--accent) hover:text-(--accent) aria-[current=true]:border-(--accent) aria-[current=true]:text-(--accent)"
                      to={pairHref(p)}
                      aria-current={withSlug === p.slug ? "true" : undefined}
                    >
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 max-w-[68ch]">
          <h3 className="text-2xl font-bold tracking-[-0.01em]">Partners inside its colour identity</h3>
          <p className="text-(--muted) max-w-[65ch]">
            Ranked over the cards a deck led by {page.name}{pair ? ` and ${pair.name}` : ""} could
            legally contain — not the whole corpus, which is what the card page ranks over.
          {" "}
            The fewer cards can cause an event, the higher the pairing ranks.
            {fallback ? " The pair's own list was not built; showing each card's own." : ""}
          </p>
        </div>
        <PartnerList
          rows={ranked.partners}
          pool={ranked.pool}
          rarity={ranked.rarity}
          empty={unread
            ? "No partners, because the engine read nothing on this card to rank them by."
            : "No partners inside this identity. Every card it could feed is fed by so many others that the pairing says nothing, or the engine refused each one on the merits."}
        />
      </section>

      <PageFoot />
    </div>
    <aside className="order-first lg:order-last lg:sticky lg:top-[calc(var(--site-header-h,0px)+1.5rem)]">
      <CardArt artCrop={page.artCrop} name={page.name} />
    </aside>
    </article>
  );
}
