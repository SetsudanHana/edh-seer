import { useEffect, useMemo, useRef, useState } from "react";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel, type EngineCard, type EngineGroup, type EngineModel, type Link, type Repeat } from "../lib/engine-model.js";
import { CardName, ReasonText, useCardDrawer } from "./card-drawer.js";
import { ManaSymbols } from "./ManaSymbols.js";

/** THE GRAPH TAB'S LANDING VIEW: what the deck does, in groups of named cards (graph evaluation
 *  2026-09-25, four blind persona rounds). Every seat opened it first in rounds 3 and 4, and it is
 *  the only surface that answered the cut question at all. The whole-deck board and the one-card
 *  view stay one tap away.
 *
 *  THE CARD TEXT SITS BESIDE EVERY CLAIM, because that is what turned the skeptic's distrust into
 *  checking: with both cards printed next to a pairing, it caught engine errors on its own. */
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
  useEffect(() => {
    if (sel) panelRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [sel]);
  const pct = m.totalLinks ? Math.round((100 * m.coveredLinks) / m.totalLinks) : 0;
  const deckGroups = m.groups.filter((g) => !g.helper);
  const helpers = m.groups.filter((g) => g.helper);

  if (!m.totalLinks) {
    return <p className="text-(--muted) py-8">The engine found no cards in this deck that work with each other, so there is nothing to group yet.</p>;
  }
  return (
    <div className="flex flex-col gap-8 py-2">
      <div className="flex flex-col gap-3">
        <p className="max-w-[70ch]">
          Your deck mostly does <b>{deckGroups.length} things</b>, listed below. Between them they explain{" "}
          <b>{pct}%</b> of the ways your {m.deckCards} cards work together.
          {m.onceLinks ? <> <b>{m.onceLinks}</b> of those links work only once.</> : null}
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
              <article key={`${pair.a}|${pair.b}`} className="flex flex-col gap-2 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="flex shrink-0"><Art card={a} size={40} /><span className="-ml-3"><Art card={b} size={40} /></span></span>
                  <div>
                    <h3 className="font-semibold text-base"><CardName name={a.name} /> + <CardName name={b.name} /></h3>
                    <p className="text-(--muted)">{both ? "Each helps the other" : "One helps the other"}, {ways.length === 1 ? "in one way" : `in ${ways.length} ways`}: {ways.map((w) => w.toLowerCase()).join("; ")}.</p>
                  </div>
                </div>
                <Lines links={lines} />
                <div className="grid gap-2 sm:grid-cols-2"><CardText card={a} /><CardText card={b} /></div>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="eng-cuts" className="flex flex-col gap-3">
        <h2 id="eng-cuts" className="text-lg font-semibold">Cards doing the least here</h2>
        <p className="text-sm text-(--muted) max-w-[70ch]">Cut candidates: the cards that keep working with the fewest others. Every link that repeats counts, including cards that double or copy triggers, and so does helping other cards in the background.</p>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]">
          {m.cuts.map((c) => (
            <article key={c.card.id} className="flex flex-col gap-2 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
              <div className="flex items-center gap-3">
                <Art card={c.card} size={36} />
                <div><h3 className="font-semibold text-base"><CardName name={c.card.name} /></h3><p>{c.why}</p></div>
              </div>
              {c.keep ? (
                <p className="text-(--muted)"><span className="eyebrow block">Best reason to keep it</span><Badge repeat={c.keep.repeat} /><ReasonText text={c.keep.text} /></p>
              ) : null}
              <CardText card={c.card} />
            </article>
          ))}
        </div>
        {m.jobs.length ? (
          <div className="flex flex-col gap-2 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
            <h3 className="font-semibold text-base">Removal, extra mana and protection</h3>
            <p className="text-(--muted)">These cards are judged by their job, not by links, so compare them with each other. Each group runs from least to most connected; the number is how many other cards in this deck each one works with.</p>
            <ul className="flex flex-col gap-1.5">
              {m.jobs.map(([job, rows]) => (
                <li key={job}>
                  <b>{job} · {rows.length}</b>{" "}
                  <span className="text-(--muted)">{rows.map((r, i) => <span key={r.card.id}>{i ? ", " : ""}<CardName name={r.card.name} />{r.card.manaCost ? <> <ManaSymbols cost={r.card.manaCost} /></> : null} ({r.partners})</span>)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="eng-groups" className="flex flex-col gap-3">
        <h2 id="eng-groups" className="text-lg font-semibold">What your deck does</h2>
        <p className="text-sm text-(--muted)">Tap any card to light up the cards it works with.</p>
        {/* Clear of the sticky site and deck bars, which hid the panel's title (round 6). */}
        <div ref={panelRef} className="scroll-mt-40">{sel ? <SelectedPanel m={m} id={sel} onClear={() => onSelect(null)} onOpenCard={onOpenCard} /> : null}</div>
        {deckGroups.map((g) => <Group key={g.tag} g={g} m={m} sel={sel} onSelect={onSelect} />)}
      </section>

      {helpers.length ? (
        <section aria-labelledby="eng-helpers" className="flex flex-col gap-3">
          <h2 id="eng-helpers" className="text-lg font-semibold">Cards that make many others easier to use</h2>
          <p className="text-sm text-(--muted) max-w-[70ch]">They make other cards cheaper, give them types, or let you find or bring them back. Useful, but not a plan on their own.</p>
          {helpers.map((g) => <Group key={g.tag} g={g} m={m} sel={sel} onSelect={onSelect} />)}
        </section>
      ) : null}
    </div>
  );
}

const REPEAT_WORD: Record<Repeat, string> = { static: "always on", triggered: "every time", activated: "on demand", oneshot: "once" };
const REPEAT_MEANS: Record<Repeat, string> = { static: "while both are out", triggered: "each time it happens", activated: "when you pay for it", oneshot: "happens once" };

function Badge({ repeat }: { repeat: Repeat }) {
  return (
    <span className={`eyebrow mr-2 inline-block whitespace-nowrap rounded-[4px] border px-1.5 py-0.5 align-[1px] ${
      repeat === "oneshot" ? "border-dashed border-(--muted) text-(--muted)" : "border-(--separator) bg-(--surface-secondary) text-(--foreground)"
    }`}>{REPEAT_WORD[repeat]}</span>
  );
}

function RepeatKey() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-(--muted)">
      {(["static", "triggered", "activated", "oneshot"] as const).map((r) => <span key={r}><Badge repeat={r} />{REPEAT_MEANS[r]}</span>)}
    </p>
  );
}

function Lines({ links }: { links: readonly Link[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {links.map((l) => <li key={`${l.from}|${l.to}|${l.tag}|${l.text}`}><Badge repeat={l.repeat} /><ReasonText text={l.text} /></li>)}
    </ul>
  );
}

function Art({ card, size }: { card: EngineCard; size: number }) {
  return card.art
    ? <img src={card.art} alt="" loading="lazy" width={size} height={size} className="shrink-0 rounded-full object-cover border-2 border-(--background)" style={{ width: size, height: size }} />
    : <span aria-hidden="true" className="shrink-0 rounded-full bg-(--surface-secondary) border-2 border-(--background)" style={{ width: size, height: size }} />;
}

/** THE PRINTED CARD, in words, beside the claim about it. */
function CardText({ card }: { card: EngineCard }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-(--radius) border border-(--separator) bg-(--background) px-2.5 py-2 text-xs leading-relaxed">
      <span className="flex items-baseline justify-between gap-2">
        <b className="text-sm">{card.name}{card.isToken ? <span className="text-(--muted) font-normal"> (token)</span> : null}</b>
        {card.manaCost ? <ManaSymbols cost={card.manaCost} /> : null}
      </span>
      {card.typeLine ? <span className="text-(--muted)">{card.typeLine}</span> : null}
      {card.text ? <p className="whitespace-pre-line">{card.text}</p> : null}
    </div>
  );
}

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
  const listed = g.sameAs && !all ? g.sameAs.extra : g.members;
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
  const selName = sel ? m.cards.get(sel)?.name.split(" // ")[0] : undefined;
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
        {g.sameAs && !all ? (
          <p className="text-sm">
            Mostly the same cards as <b>{g.sameAs.name}</b>
            {g.sameAs.missing ? `, without ${g.sameAs.missing} of them` : ""}
            {members.length ? `, plus these ${members.length}:` : "."}
          </p>
        ) : null}
        {shown.length ? <div className="flex flex-wrap gap-1.5">{shown.map((c) => chip(c, false))}</div> : null}
        {rest.length ? (
          <p className="text-sm text-(--muted)">
            and {rest.length} more{sel && restLit ? `, ${restLit} of them lit by ${selName}` : ""}:{" "}
            {rest.map((c, i) => (
              <span key={c.id} className={on(c) ? "font-semibold text-(--foreground)" : sel ? "opacity-50" : ""}>
                {i ? ", " : ""}{c.name.split(" // ")[0]}{c.isToken ? " (token)" : ""}
              </span>
            ))}.
          </p>
        ) : null}
        {rest.length || g.sameAs ? (
          <p><button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-3 text-sm" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${n}`}</button></p>
        ) : null}
      </div>
      {g.example ? (
        <details open className="text-sm">
          <summary className="eyebrow text-(--muted)">For example</summary>
          <p className="my-2"><Badge repeat={g.example.repeat} /><ReasonText text={g.example.text} /></p>
          <div className="grid gap-2 sm:grid-cols-2"><CardText card={m.cards.get(g.example.from)!} /><CardText card={m.cards.get(g.example.to)!} /></div>
        </details>
      ) : null}
    </article>
  );
}

function SelectedPanel({ m, id, onClear, onOpenCard }: { m: EngineModel; id: string; onClear: () => void; onOpenCard?: (id: string) => void }) {
  const c = m.cards.get(id)!;
  const nb = m.partners.get(id);
  const groups = m.membership.get(id) ?? [];
  const lines = [...(nb?.values() ?? [])].flatMap((p) => p.links)
    .sort((a, b) => Number(a.repeat === "oneshot") - Number(b.repeat === "oneshot") || m.cards.get(b.to === id ? b.from : b.to)!.score - m.cards.get(a.to === id ? a.from : a.to)!.score)
    .slice(0, 5);
  return (
    <div className="mb-1 flex flex-col gap-2 rounded-(--radius) border border-(--foreground) bg-(--surface) p-3 text-sm" aria-live="polite">
      <div className="flex items-center gap-3">
        <Art card={c} size={44} />
        <div className="flex-1">
          <h3 className="font-semibold text-base"><CardName name={c.name} />{c.isToken ? <span className="text-(--muted) font-normal"> (token)</span> : null}</h3>
          <p className="text-(--muted)">
            Works with {nb?.size ?? 0} card{nb?.size === 1 ? "" : "s"}, lit below; everything else is faded.
            {groups.length ? <> Part of: {groups.map((g) => g.name.toLowerCase()).join("; ")}.</> : null}
          </p>
        </div>
      </div>
      <Lines links={lines} />
      <CardText card={c} />
      <div className="flex flex-wrap gap-3">
        {onOpenCard ? <button type="button" className="min-h-11 rounded-(--radius) border border-(--accent) px-4 text-sm text-(--accent)" onClick={() => onOpenCard(id)}>See it in the one-card view</button> : null}
        <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={onClear}>Clear selection</button>
      </div>
    </div>
  );
}
