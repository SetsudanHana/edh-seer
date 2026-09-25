import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { identityKeyOf, themesOf, unmetDemands } from "@edh-seer/matcher/partners-core";
import { identityLabel } from "../lib/color-identity.js";
import { eventKeyClause } from "../lib/demand-sentence.js";
import { loadCardPage, type CardPageData, type PartnerRow } from "../lib/partners.js";
import { CardArt } from "./CardArt.js";
import { CardShell } from "./CardShell.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { EngineReading } from "./EngineReading.js";
import { NotFound } from "./NotFound.js";
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

/** The identity as a mana-cost string, WUBRG, deduplicated. Empty for colourless, which has no pip
 *  of its own to draw -- the word "Colourless" is the whole answer there. */
const WUBRG = ["W", "U", "B", "R", "G"] as const;
function identityPips(identity: readonly string[]): string {
  const held = new Set(identity.map((c) => c.toUpperCase()));
  return WUBRG.filter((c) => held.has(c)).map((c) => `{${c}}`).join("");
}

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

  // THE URL IS GUESSABLE, so a reader will arrive here for Sol Ring. Saying what is wrong with the
  // question beats rendering an empty page that looks broken.
  if (!page.commander) {
    return (
      <CardShell page={page} slug={slug} surface="commander" peekLoad={load}>
        <p className="text-(--muted) max-w-[65ch]">
          {page.name} cannot lead a deck. This page is for cards that can be a commander; the card
          itself has one, under "As a card".
        </p>
      </CardShell>
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
    <CardShell
      page={page} slug={slug} surface="commander" peekLoad={load}
      // THE PAIR IS TWO CARDS, SO THE RAIL SHOWS TWO. A picked partner's card sits under the
      // commander's -- owner 2026-09-05: "you should see the card image next to the main commander
      // you chose".
      railExtra={pair ? <CardArt artCrop={pair.artCrop} backArtCrop={pair.backArtCrop} name={pair.name} /> : undefined}
    >

      {/* ONE LINE, NOT A PANEL. It was a ~1,000px surface holding two items and ~30px of content,
        * and both of them were kickers -- "ITS EVENTS POINT AT" stacked above "Tokens" -- which is
        * the one typographic rule this system names outright: a label pairs INLINE with its value or
        * it is the heading. A design review called it "one sentence of information wearing a
        * container". */}
      <div className="flex flex-col gap-2 max-w-[68ch]">
        <p>
          <span className="eyebrow text-(--muted)">colour identity </span>
          {identityLabel(identity)}
          {/* THE PIPS BESIDE THE NAME (owner, 2026-09-20). "Naya" is the nickname and a reader who
            * does not carry the nicknames has nothing to read; the symbols are the identity itself,
            * and they are the same drawings the card's own mana cost prints in the heading above.
            * WUBRG ORDER, not the order the faces happen to list, so two Naya commanders show the
            * same three pips in the same order. */}
          {identityPips(identity) && (
            <span className="ml-2 align-middle"><ManaSymbols cost={identityPips(identity)} /></span>
          )}
          {pair ? <span className="text-(--muted)">, with {pair.name}</span> : null}
          {colour ? <span className="text-(--muted)">, {COLOURS.find((c) => c.letter === colour)!.word} chosen</span> : null}
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
            gaps and no connections to rank. Either the card prints only keywords, or its text is one
            the engine cannot yet read. The card page shows which.
          </p>
        ) : (<>
        <p>
          <span className="eyebrow text-(--muted)">suggested theme </span>
          {themes.length === 0
            ? <span className="text-(--muted)">none: what it does, every deck does anyway</span>
            : themes.join(" · ")}
        </p>
        <p>
          <span className="eyebrow text-(--muted)">it cares about </span>
          {gaps.length === 0
            ? <span className="text-(--muted)">nothing. It answers every event it watches</span>
            : gaps.map((w) => eventKeyClause(w)).join(" · ")}
        </p>
        </>)}
      </div>

      {(licences.length > 0 || chooses) && (
        <section className="flex flex-col gap-4 max-w-[68ch]">
          <h2 className="text-2xl font-bold tracking-[-0.01em]">Pair with</h2>
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

      {/* THE SAME SECTION THE CARD PAGE RENDERS (roadmap AJ4). This call site is the one that was
        * missed when the clause block shipped, and 2,665 commander pages served it to Googlebot
        * alone until PR #395 -- one component, every page that reads a card.
        *
        * AND IT IS THE PHONE'S COPY ONLY, which the card page already knew and this one did not
        * (owner, 2026-09-20, on the deployed site: "we have now 2 copies of the same section").
        * `CardShell`'s rail renders the identical block above `lg`, so without this wrapper the
        * desktop commander page drew it twice -- once full width, once in the rail beside it.
        * Deleting the call outright was the other option and it is wrong: the rail is `hidden lg:`,
        * so the section would vanish from every phone. Folded, for the reason `CardPage` folds it:
        * open, it puts the partners over a thousand pixels down a 390px screen. */}
      <details className="lg:hidden group/reads flex flex-col gap-3">
        <summary className="cursor-pointer list-none flex items-center gap-2 w-fit">
          <h2 className="text-2xl font-bold tracking-[-0.01em]">How the engine reads this card</h2>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="transition-transform duration-150 ease-out group-open/reads:rotate-180 motion-reduce:transition-none">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="mt-3">
          <EngineReading clauses={page.clauses} abilities={page.abilities} rarity={ranked.rarity}
            grouped={new Set(ranked.partners.map((r) => r.event))} headless />
        </div>
      </details>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 max-w-[68ch]">
          <h2 className="text-2xl font-bold tracking-[-0.01em]">Works well with</h2>
          <p className="text-(--muted) max-w-[65ch]">
            Ranked over the cards a deck led by {page.name}{pair ? ` and ${pair.name}` : ""} could
            legally contain. The fewer cards can make a pairing, the higher it ranks. Pick a card to
            preview it here.
            {fallback ? " The pair's own list was not built; showing each card's own." : ""}
          </p>
        </div>
        <PartnerList
          subject={page.name}
          // THE SCOPE THE COUNTS WERE TAKEN AT (AJ5), handed to the link under them: `key` is the
          // identity this list was ranked under, colour choice and pairing included, so the search
          // it opens holds the cards this deck could actually contain.
          identity={key === "C" ? [] : [...key]}
          rows={ranked.partners}
          pool={ranked.pool}
          rarity={ranked.rarity}
          empty={unread
            ? "No pairings yet: we couldn't read this card's text, so there is nothing to rank them by."
            : "No standout pairings in these colours. Whatever this commander helps, hundreds of other cards help just as well, or none of the possible pairings held up."}
        />
      </section>

    </CardShell>
  );
}
