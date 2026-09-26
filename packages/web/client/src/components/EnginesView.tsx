import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel, listNames, type EngineCard, type EngineGroup, type EngineModel, type Link } from "../lib/engine-model.js";
import { CardName, ReasonText, useCardDrawer } from "./card-drawer.js";
import { Art, Badge, CardFace, Lines, ReadCards, RepeatKey, useNarrow } from "./engine-parts.js";

/** THE GRAPH TAB'S LANDING VIEW: what the deck does, in groups of named cards (graph evaluation
 *  2026-09-25, four blind persona rounds). Every seat opened it first in rounds 3 and 4, and it is
 *  the only surface that answered the cut question at all. The whole-deck board and the one-card
 *  view stay one tap away.
 *
 *  THE CARDS LEAD, AND THEIR TEXT IS ONE TAP AWAY. A player knows a card by its face, and a page of
 *  printed rules text read as a wall (owner, 2026-09-26). But the text beside a claim is what turned
 *  the skeptic's distrust into checking -- with both cards to hand it caught engine errors on its
 *  own -- so every claim keeps its cards' text under "Read the cards", in the page and not behind
 *  a fetch. */
export function EnginesView({ report, graph, selected, onSelect, onOpenCard }: {
  report: DeckReport; graph: CardGraph;
  /** The card whose partners are lit, from the URL. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Opens the one-card view on a card. */
  onOpenCard?: (id: string) => void;
}) {
  const m = useMemo(() => buildEngineModel(report, graph), [report, graph]);
  const panelRef = useRef<HTMLDivElement>(null);
  const sel = selected && m.cards.has(selected) ? selected : null;
  const narrow = useNarrow();
  // On a phone the panel is a sheet over the bottom of the screen, so the reader stays by the chip
  // they tapped; scrolling up to the panel lost their place several screens away (round 10).
  useEffect(() => {
    if (sel && window.matchMedia?.("(min-width: 640px)").matches) panelRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [sel]);
  const pct = m.totalLinks ? Math.round((100 * m.coveredLinks) / m.totalLinks) : 0;
  // A group that mostly repeats another goes after the ones that do not, so the few shown first
  // are the deck's different things (round 9: four Inalla groups in a row were the same Wizards).
  const deckGroups = m.groups.filter((g) => !g.helper).sort((x, y) => Number(!!x.sameAs) - Number(!!y.sameAs));
  const helpers = m.groups.filter((g) => g.helper);
  const [allGroups, setAllGroups] = useState(false);
  const [showHelpers, setShowHelpers] = useState(false);
  const shownGroups = allGroups ? deckGroups : deckGroups.slice(0, GROUP_CAP);
  const moreGroups = deckGroups.slice(GROUP_CAP);
  // Counted from the groups on screen: with some folded, a total over all of them could not be
  // added up from the page (round 10).
  const shownOnce = [...shownGroups, ...(showHelpers ? helpers : [])].reduce((t, g) => t + g.once, 0);

  if (!m.totalLinks) {
    return <p className="text-(--muted) py-8">The engine found no cards in this deck that work with each other, so there is nothing to group yet.</p>;
  }
  return (
    <div className="flex flex-col gap-8 py-2">
      <div className="flex flex-col gap-3">
        <p className="max-w-[70ch]">
          {/* "6 things, listed below" over three shown read as a miscount (round 12). */}
          Your deck mostly does <b>{deckGroups.length} things</b>{moreGroups.length ? <>; the {shownGroups.length === deckGroups.length ? "" : `${shownGroups.length} biggest `}are below</> : ", listed below"}. Between them they explain{" "}
          <b>{pct}%</b> of the ways your {m.deckCards} cards work together.
          {m.onceLinks ? (
            <>
              {" "}<b>{m.onceLinks}</b> of those links work only once
              {/* The groups showed 14 of 103 and the skeptic could not find the rest (round 8); "and
                * only 257 of them are in the groups below" then read as a second, unexplained count
                * to three seats (round 9). */}
              {/* Most one-time links are between cards in no group, so a count of the few shown
                * explained nothing (round 11); say where the rest are. */}
              {shownOnce < m.onceLinks / 2 ? ", most of them between cards outside the groups below" : shownOnce < m.onceLinks ? `; the groups below include ${shownOnce} of them` : ""}.
            </>
          ) : null}
        </p>
        <RepeatKey />
      </div>

      <section aria-labelledby="eng-pairs" className="flex flex-col gap-3">
        <h2 id="eng-pairs" className="text-lg font-semibold">The pairs that work best together</h2>
        <p className="text-sm text-(--muted) max-w-[70ch]">Ranked by how many different ways they help each other, whether it goes both ways and keeps happening, and how central both cards are.</p>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
          {m.strongest.map(({ pair, ways, both, lines }) => {
            const a = m.cards.get(pair.a)!, b = m.cards.get(pair.b)!;
            return (
              <article key={`${pair.a}|${pair.b}`} className="flex flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
                <div className="flex items-start gap-4">
                  <span className="flex shrink-0 pt-1 pl-1">
                    <CardFace card={a} className="w-20 sm:w-28 -rotate-3" />
                    <CardFace card={b} className="w-20 sm:w-28 -ml-6 sm:-ml-8 mt-3 rotate-3" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 className="font-semibold text-base"><CardName name={a.name} /> + <CardName name={b.name} /></h3>
                    <p className="text-(--muted)">{both ? "Each helps the other" : "One helps the other"}, {ways.length === 1 ? "in one way" : `in ${ways.length} ways`}: {ways.map((w) => w.toLowerCase()).join("; ")}.</p>
                  </div>
                </div>
                <Lines links={lines} />
                <ReadCards cards={[a, b]} />
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="eng-cuts" className="flex flex-col gap-3">
        <h2 id="eng-cuts" className="text-lg font-semibold">Cards doing the least here</h2>
        <p className="text-sm text-(--muted) max-w-[70ch]">Cut candidates: the cards that keep working with the fewest others. Every link that repeats counts, including cards that double or copy triggers, and so does helping other cards in the background.</p>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,25rem),1fr))]">
          {m.cuts.map((c) => (
            <article key={c.card.id} className="flex items-start gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
              <CardFace card={c.card} className="w-24 sm:w-28" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div><h3 className="font-semibold text-base"><CardName name={c.card.name} /></h3><p>{c.why}</p></div>
              {c.keep && c.keepActs ? (
                <p className="text-(--muted)"><span className="eyebrow block">Best reason to keep it</span><Badge repeat={c.keep.repeat} /><ReasonText text={c.keep.text} /></p>
              ) : c.keep ? (
                // A FEEDER NAMES WHO USES IT. The line other cards get from it is true of any card
                // of its kind, so it is not "the best reason to keep" this one (round 7); and one
                // fixed sentence on four cards, saying its own abilities do nothing, read as a false
                // verdict beside text that plainly does something (round 8). What the engine knows
                // is which cards use it and that none of its links found uses its own abilities.
                <p className="text-(--muted)">
                  <span className="eyebrow block">Who uses it</span>
                  {names(c.fedBy.slice(0, 3))}{c.fedBy.length > 3 ? ` and ${c.fedBy.length - 3} other${c.fedBy.length === 4 ? "" : "s"}` : ""}.
                  {" "}None of the links found here use its own abilities.
                </p>
              ) : null}
              {c.twins.length ? (
                <p className="text-(--muted)">
                  <span className="eyebrow block">Used by exactly the same cards</span>
                  {/* "Whatever you decide about one goes for all of them" read as "cut all seven"
                    * (round 11). They stand in for each other; they are not a package. */}
                  {names(c.twins)} {c.twins.length === 1 ? "is" : "are"} used by the same cards as {c.card.name.split(" // ")[0]}, so here {c.twins.length === 1 ? "either can" : "any of them can"} stand in for another: cutting one leaves the rest doing the same job.
                </p>
              ) : null}
              <ReadCards cards={[c.card]} />
              </div>
            </article>
          ))}
        </div>
        {m.jobs.length ? (
          // SHELVES OF CARDS, NOT A PARAGRAPH (owner, 2026-09-26, on a Rani deck: a line per job of
          // names, mana symbols and bracketed numbers read as a wall). Each job is a row of the
          // cards themselves, least connected first, with the count under each.
          <div className="flex flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold text-base">Cards judged by their job</h3>
              <p className="text-(--muted)">Removal, ramp and the like are compared with their own kind, not by links. Each row starts with the card that works with the fewest others; the number under a card is how many it works with.</p>
            </div>
            <ul className="flex flex-col gap-3">
              {m.jobs.map(([job, rows]) => (
                <li key={job} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
                  <span className="shrink-0 sm:w-36 sm:pt-2">
                    <b className="block">{job}</b>
                    <span className="text-(--muted)">{rows.length} card{rows.length === 1 ? "" : "s"}</span>
                  </span>
                  <ul className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 snap-x" aria-label={job}>
                    {rows.map((r) => (
                      <li key={r.card.id} className="flex w-[76px] shrink-0 snap-start flex-col items-center gap-0.5 sm:w-[84px]">
                        <CardFace card={r.card} className="w-full" />
                        <span className="text-xs text-(--muted)" title={`Works with ${r.partners} other card${r.partners === 1 ? "" : "s"}`}>{r.partners}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="eng-groups" className="flex flex-col gap-3">
        <h2 id="eng-groups" className="text-lg font-semibold">What your deck does</h2>
        <p className="text-sm text-(--muted)">Tap any card to see the cards it works with. A card with a dashed outline works with its group only once.</p>
        {/* Clear of the sticky site and deck bars, which hid the panel's title (round 6). */}
        <div ref={panelRef} className="scroll-mt-40">
          {sel ? (narrow
            // Into the body: an ancestor of the report pins `fixed` to itself, and the sheet
            // landed at the bottom of the tab instead of the screen (round 11 capture).
            ? createPortal(<SelectedPanel m={m} id={sel} onClear={() => onSelect(null)} onOpenCard={onOpenCard} />, document.body)
            : <SelectedPanel m={m} id={sel} onClear={() => onSelect(null)} onOpenCard={onOpenCard} />) : null}
        </div>
        {shownGroups.map((g) => <Group key={g.tag} g={g} m={m} sel={sel} onSelect={onSelect} />)}
        {moreGroups.length ? (
          <p>
            <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={() => setAllGroups(!allGroups)}>
              {allGroups ? "Show fewer" : `Show ${moreGroups.length} more: ${listNames(moreGroups.map((g) => g.name.toLowerCase()), 4)}`}
            </button>
          </p>
        ) : null}
      </section>

      {helpers.length ? (
        <section aria-labelledby="eng-helpers" className="flex flex-col gap-3">
          <h2 id="eng-helpers" className="text-lg font-semibold">Cards that make many others easier to use</h2>
          <p className="text-sm text-(--muted) max-w-[70ch]">They make other cards cheaper, give them types, or let you find or bring them back. Useful, but not a plan on their own.</p>
          {/* Folded by default: every seat stopped scrolling above them (round 9). */}
          {showHelpers ? helpers.map((g) => <Group key={g.tag} g={g} m={m} sel={sel} onSelect={onSelect} />) : null}
          <p>
            <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={() => setShowHelpers(!showHelpers)}>
              {showHelpers ? "Hide these" : `Show them: ${listNames(helpers.map((g) => g.name.toLowerCase()), 4)}`}
            </button>
          </p>
        </section>
      ) : null}
      {/* Room to scroll the last group out from under the phone sheet. */}
      {sel ? <div aria-hidden="true" className="h-[40vh] sm:hidden" /> : null}
    </div>
  );
}

/** How many of the deck's groups show before "Show N more": the six ran to ten phone screens,
 *  and every seat stopped reading partway through them (round 9). */
const GROUP_CAP = 3;

const names = (list: string[]) => listNames(list);

/** A group shows this many member chips until asked for all of them: at 390px a group of 54
 *  was a wall of chips three screens tall (live round). The rest are named in a line. A selection
 *  moves the cards it lights to the front and says how many of the rest it lights: drawing every lit
 *  chip opened every group in full for a card with 54 partners, so nothing looked faded (round 6). */
const CHIP_CAP = 12;

function Group({ g, m, sel, onSelect }: { g: EngineGroup; m: EngineModel; sel: string | null; onSelect: (id: string | null) => void }) {
  const [all, setAll] = useState(false);
  const { tokens } = useCardDrawer();
  const partners = sel ? m.partners.get(sel) : undefined;
  // A lit token lights the card that makes it: the panel names "Wizard (token from Transpose)",
  // and Transpose sat faded (round 6).
  const lit = partners ? new Set([...partners.keys(), ...[...partners.keys()].flatMap((id) => {
    const t = m.cards.get(id);
    const maker = t?.isToken ? tokens.get(t.name) : undefined;
    return maker ? [maker] : [];
  })]) : undefined;
  const rank = (a: EngineCard, b: EngineCard) => Number(b.isCommander) - Number(a.isCommander) || b.score - a.score || (a.name < b.name ? -1 : 1);
  const hubs = g.hubs.map((id) => m.cards.get(id)!).sort(rank);
  const on = (c: EngineCard) => c.id === sel || !!lit?.has(c.id);
  const selName = sel ? m.cards.get(sel)?.name.split(" // ")[0] : undefined;
  // A TAP SHOWS ONLY WHAT IT LIGHTS: fading the rest changed nothing visible for a card with 36
  // partners among 44 (round 10). "Show all" brings the whole group back, faded.
  const filtering = !!sel && !all;
  const litIds = g.members.filter((id) => { const c = m.cards.get(id); return !!c && on(c); });
  // The tapped card is shown but not counted: "4 of these 36 work with Kindred Discovery" included
  // Kindred Discovery (round 11).
  const selIn = !!sel && g.members.includes(sel);
  const litOthers = litIds.length - (selIn ? 1 : 0);
  const listed = filtering ? litIds : g.sameAs && !all ? g.sameAs.extra : g.members;
  const members = listed.map((id) => m.cards.get(id)!)
    .sort((a, b) => Number(on(b)) - Number(on(a)) || Number(g.onceOnly.has(a.id)) - Number(g.onceOnly.has(b.id)) || rank(a, b));
  const chip = (c: EngineCard, strong: boolean) => {
    const self = sel === c.id, partner = !self && !!lit?.has(c.id);
    return (
      <button
        key={c.id}
        type="button"
        aria-pressed={self}
        onClick={() => onSelect(self ? null : c.id)}
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-sm transition-opacity ${
          strong ? "font-semibold" : ""
        } ${g.onceOnly.has(c.id) && !strong ? "border-dashed text-(--muted)" : ""} ${
          self ? "bg-(--surface-tertiary) outline-2 outline-(--foreground)" : partner ? "bg-(--surface-tertiary) border-(--foreground)" : sel ? "opacity-30" : ""
        }`}
        style={strong ? { borderColor: g.hue } : undefined}
      >
        <Art card={c} size={22} />
        {c.name.split(" // ")[0]}{c.isToken ? <span className="text-(--muted) font-normal"> (token)</span> : null}
      </button>
    );
  };
  const shown = all ? members : members.slice(0, CHIP_CAP);
  const rest = members.slice(shown.length);
  const restLit = rest.filter(on).length;
  const hubWord = g.helper
    ? (hubs.length === 1 ? "This card…" : `These ${hubs.length} cards…`)
    : (hubs.length === 1 ? "This card does something extra…" : `These ${hubs.length} cards do something extra…`);
  const n = g.members.length;
  const memberWord = g.helper ? `…help${hubs.length === 1 ? "s" : ""} these ${n}` : `…whenever one of these ${n} is involved`;
  return (
    <article className="flex flex-col gap-3 rounded-(--radius) border border-(--separator) border-l-4 bg-(--surface) p-4" style={{ borderLeftColor: g.hue }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold">{g.name}</h3>
        <span className="text-sm text-(--muted)">{g.repeating} pair{g.repeating === 1 ? "" : "s"} work every time{g.once ? ` · ${g.once} only once` : ""}</span>
      </div>
      <div className="flex flex-col gap-1.5"><span className="eyebrow text-(--muted)">{hubWord}</span><div className="flex flex-wrap gap-1.5">{hubs.map((c) => chip(c, true))}</div></div>
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow text-(--muted)">{memberWord}</span>
        {filtering ? (
          <p className="text-sm">{litOthers ? `${litOthers} of ${selIn ? `the other ${n - 1}` : `these ${n}`} work with ${selName}:` : `None of ${selIn ? `the other ${n - 1}` : `these ${n}`} work with ${selName}.`}</p>
        ) : null}
        {g.sameAs && !all && !filtering ? (
          <p className="text-sm">
            Mostly the same cards as <b>{g.sameAs.name}</b>
            {g.sameAs.missing.length ? `, without ${g.sameAs.missing.length} of them (${names(g.sameAs.missing.map((id) => { const c = m.cards.get(id); return c ? c.name + (c.isToken ? " (token)" : "") : id; }))})` : ""}
            {members.length ? `, plus these ${members.length}:` : "."}
          </p>
        ) : null}
        {shown.length ? <div className="flex flex-wrap gap-1.5">{shown.map((c) => chip(c, false))}</div> : null}
        {rest.length ? (
          <p className="text-sm text-(--muted)">
            and {rest.length} more{sel && !filtering && restLit ? `, ${restLit} of them lit by ${selName}` : ""}:{" "}
            {rest.map((c, i) => (
              <span key={c.id} className={filtering ? "text-(--foreground)" : on(c) ? "font-semibold text-(--foreground) underline decoration-2 underline-offset-2" : sel ? "opacity-40" : ""}>
                {i ? ", " : ""}{c.name.split(" // ")[0]}{c.isToken ? " (token)" : ""}
              </span>
            ))}.
          </p>
        ) : null}
        {rest.length || g.sameAs || (filtering && litIds.length < n) ? (
          <p><button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-3 text-sm" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${n}`}</button></p>
        ) : null}
      </div>
      {g.example ? (
        <details open className="text-sm">
          <summary className="eyebrow text-(--muted)">For example</summary>
          <div className="my-2 flex items-start gap-3">
            <span className="flex shrink-0">
              <CardFace card={m.cards.get(g.example.from)!} className="w-16 sm:w-20" />
              <CardFace card={m.cards.get(g.example.to)!} className="w-16 sm:w-20 -ml-4 mt-2" />
            </span>
            <p><Badge repeat={g.example.repeat} /><ReasonText text={g.example.text} /></p>
          </div>
          <ReadCards cards={[m.cards.get(g.example.from)!, m.cards.get(g.example.to)!]} />
        </details>
      ) : null}
    </article>
  );
}

function SelectedPanel({ m, id, onClear, onOpenCard }: { m: EngineModel; id: string; onClear: () => void; onOpenCard?: (id: string) => void }) {
  const c = m.cards.get(id)!;
  const nb = m.partners.get(id);
  const groups = m.membership.get(id) ?? [];
  const partnerOf = (l: Link) => (l.to === id ? l.from : l.to);
  const ranked = [...(nb?.values() ?? [])].flatMap((p) => p.links)
    .sort((a, b) => Number(a.repeat === "oneshot") - Number(b.repeat === "oneshot") || m.cards.get(partnerOf(b))!.score - m.cards.get(partnerOf(a))!.score);
  // ONE LINE PER PARTNER FIRST: "Works with 54 cards" over five lines that were all Rumor Gatherer
  // read as a contradiction (round 11). A second line for a partner only fills a short list.
  const seen = new Set<string>();
  const firsts = ranked.filter((l) => !seen.has(partnerOf(l)) && seen.add(partnerOf(l)));
  const lines = [...firsts, ...ranked.filter((l) => !firsts.includes(l))].slice(0, 5);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex max-h-[40vh] flex-col gap-2 overflow-y-auto rounded-t-(--radius) border border-(--foreground) bg-(--surface) p-3 text-sm shadow-[0_-8px_24px_rgb(0_0_0/0.5)] sm:static sm:z-auto sm:mb-1 sm:max-h-none sm:overflow-visible sm:rounded-(--radius) sm:shadow-none" aria-live="polite">
      {/* On a phone the way out stays in reach at the top of the sheet: the buttons at its foot
        * sat below the edge of the screen (round 11). */}
      <div className="sticky -top-3 z-10 -mx-3 -mt-3 flex items-start gap-3 bg-(--surface) px-3 pt-3 pb-1 sm:static sm:m-0 sm:p-0">
        <CardFace card={c} className="w-20 sm:w-24" />
        <div className="flex-1">
          <h3 className="font-semibold text-base"><CardName name={c.name} />{c.isToken ? <span className="text-(--muted) font-normal"> (token)</span> : null}</h3>
          <p className="text-(--muted)">
            Works with {nb?.size ?? 0} card{nb?.size === 1 ? "" : "s"}; each group below now shows only those.
            {groups.length ? <> Part of: {groups.map((g) => g.name.toLowerCase()).join("; ")}.</> : null}
          </p>
        </div>
        <button type="button" aria-label="Close" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-(--radius) border border-(--separator) text-lg sm:hidden" onClick={onClear}>✕</button>
      </div>
      <Lines links={lines} />
      <ReadCards cards={[c]} />
      <div className="flex flex-wrap gap-3">
        {onOpenCard ? <button type="button" className="min-h-11 rounded-(--radius) border border-(--accent) px-4 text-sm text-(--accent)" onClick={() => onOpenCard(id)}>See it in the one-card view</button> : null}
        <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={onClear}>Clear selection</button>
      </div>
    </div>
  );
}
