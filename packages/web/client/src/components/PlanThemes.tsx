import { useMemo, useState } from "react";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel, tokenLabel, type EngineCard, type EngineGroup, type EngineModel } from "../lib/engine-model.js";
import { ReasonText } from "./card-drawer.js";
import { Art, Badge } from "./engine-parts.js";
import { whichTheme, type MainTheme } from "../lib/main-theme.js";

/** WHAT THE DECK DOES, IN THE GAME PLAN CHAPTER (owner, 2026-09-26: "it does not make any sense to
 *  have 2 times the same report"): the deck's themes, the Graph tab's Overview brought here.
 *
 *  ONE ROW PER THEME (owner, 2026-09-27: "less is more", "rely more on data visualisation than the
 *  text"): its colour on the map, one bar and count, its key cards as art. Its cards and one
 *  example link open on a tap. The best pairs that followed are now the lead of "Cards that carry
 *  it" (`HighSynergyCards`), which named the same cards. */
export function PlanThemes({ report, graph, model, onOpenCard, main }: {
  report: DeckReport; graph: CardGraph;
  /** The deck's main theme (Glance and Scores name it), so the theme that IS it carries its name. */
  main?: MainTheme | null;
  /** The engine model, when the caller already built it to decide whether to show this at all. */
  model?: EngineModel;
  /** Opens a card's orbit over the report. */
  onOpenCard?: (id: string) => void;
}) {
  const m = useMemo(() => model ?? buildEngineModel(report, graph), [model, report, graph]);
  // The main theme leads, under its own name; after it, a group that mostly repeats another goes
  // after the ones that do not (Overview round 9: four Inalla groups in a row were the same Wizards).
  const leads = (g: EngineGroup) => { const w = main ? whichTheme(g, main) : null; return w?.theme === "main" && w.match === "same"; };
  const rank = (g: EngineGroup) => (leads(g) ? 0 : 1);
  const themes = m.groups.filter((g) => !g.helper).sort((x, y) => rank(x) - rank(y) || Number(!!x.sameAs) - Number(!!y.sameAs));
  const matched = main ? themes.some((g) => whichTheme(g, main)?.theme === "main") : true;
  const helpers = m.groups.filter((g) => g.helper);
  const [showHelpers, setShowHelpers] = useState(false);
  // THE BARS SHARE ONE SCALE: the biggest theme's card count.
  const size = (g: EngineGroup) => new Set([...g.hubs, ...g.members]).size;
  const top = Math.max(1, ...m.groups.map(size));
  if (!m.totalLinks) return null;
  return (
    <section aria-labelledby="plan-themes" className="flex flex-col gap-3 max-w-5xl">
      <h3 id="plan-themes" className="text-lg font-semibold">What your deck does</h3>
      {/* NO GROUP IS THE MAIN THEME: said, not left as two unrelated names on two chapters. */}
      {main && !matched ? (
        <p className="max-w-[70ch] text-sm">Your main theme is <b>{main.name}</b> ({main.count} of {main.nonland} nonland cards); by how the cards work together, the deck does these:</p>
      ) : null}
      {/* ONE ROW PER THEME (owner, 2026-09-27: "less is more", "rely more on data visualisation than
        *  the text"). Each theme was a card of images, chips and sentences, three of them 1,800px
        *  tall; now a bar and its key cards, and the rest on a tap. */}
      <ul className="flex flex-col" aria-label="Themes">
        {themes.map((g) => <Theme key={g.tag} g={g} m={m} onOpenCard={onOpenCard} main={main} top={top} />)}
      </ul>
      {helpers.length ? (
        <div className="flex flex-col gap-1">
          <button type="button" aria-expanded={showHelpers} className="self-start min-h-11 text-sm text-(--muted) hover:text-(--foreground)" onClick={() => setShowHelpers(!showHelpers)}>
            {showHelpers ? "Hide the helpers" : `Helpers · ${helpers.length}`}
          </button>
          {showHelpers ? (
            <ul className="flex flex-col" aria-label="Helpers">
              {helpers.map((g) => <Theme key={g.tag} g={g} m={m} onOpenCard={onOpenCard} top={top} />)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Key cards drawn in the closed row; the rest are counted. */
const ROW_ART = 5;
/** Cards named in an open row before "Show all". */
const MEMBER_CAP = 12;

const byWeight = (a: EngineCard, b: EngineCard) => Number(b.isCommander) - Number(a.isCommander) || b.score - a.score || (a.name < b.name ? -1 : 1);

/** One theme as a row: its colour (the map's), name, a bar for how many cards it links, and its key
 *  cards as art. Open, it lists its cards and one example link. */
function Theme({ g, m, onOpenCard, main, top }: { g: EngineGroup; m: EngineModel; onOpenCard?: (id: string) => void; main?: MainTheme | null; top: number }) {
  const which = main ? whichTheme(g, main) : null;
  // A named theme's own group takes the name Glance gives it, so the deck is called one thing.
  const name = which?.match === "same" ? which.name : g.name;
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const hubs = g.hubs.map((id) => m.cards.get(id)!).sort(byWeight);
  const hubSet = new Set(g.hubs);
  const members = g.members.filter((id) => !hubSet.has(id)).map((id) => m.cards.get(id)!)
    .sort((a, b) => Number(g.onceOnly.has(a.id)) - Number(g.onceOnly.has(b.id)) || byWeight(a, b));
  const cards = new Set([...g.hubs, ...g.members]).size;
  const cardsShown = all ? [...hubs, ...members] : [...hubs, ...members].slice(0, MEMBER_CAP);
  const tag = which ? (which.match === "same" ? (which.theme === "main" ? "main theme" : "second theme") : null) : null;
  return (
    <li className="border-b border-(--separator)">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="theme-row"
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 text-left hover:bg-(--surface-secondary) sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.hue }} />
          <h4 id={`theme-${g.tag}`} className="truncate text-sm font-semibold">{name}</h4>
          {tag ? <span className={`eyebrow shrink-0 ${which!.theme === "main" ? "text-(--accent)" : "text-(--muted)"}`}>{tag}</span> : null}
        </span>
        <span className="order-3 col-span-2 flex items-center gap-2 sm:order-none sm:col-span-1">
          <span aria-hidden="true" className="h-1.5 flex-1 rounded-full bg-(--surface-secondary)">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (cards / top) * 100)}%`, background: g.hue }} />
          </span>
          <span className="stat-num w-16 shrink-0 text-right text-xs text-(--muted)">{cards} cards</span>
        </span>
        <span className="flex items-center" aria-hidden="true">
          {hubs.slice(0, ROW_ART).map((c, i) => <span key={c.id} className={i ? "-ml-2" : ""}><Art card={c} size={28} /></span>)}
          {hubs.length > ROW_ART ? <span className="ml-1 text-xs text-(--muted)">+{hubs.length - ROW_ART}</span> : null}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 pb-3 pl-5">
          <div className="flex flex-wrap gap-1.5" aria-label={`${name}: its cards`}>
            {cardsShown.map((c) => (
              <button key={c.id} type="button" onClick={() => onOpenCard?.(c.id)} disabled={!onOpenCard}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-sm ${hubSet.has(c.id) ? "border-(--foreground)" : g.onceOnly.has(c.id) ? "border-dashed text-(--muted)" : "border-(--separator)"} enabled:hover:border-(--accent)`}>
                <Art card={c} size={24} />
                {c.name.split(" // ")[0]}{c.isToken ? <span className="font-normal text-(--muted)"> {tokenLabel(c)}</span> : null}
              </button>
            ))}
            {cards > MEMBER_CAP ? (
              <button type="button" className="min-h-9 rounded-full border border-(--separator) px-3 text-sm" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `Show all ${cards}`}
              </button>
            ) : null}
          </div>
          {g.example ? (
            <p className="text-sm text-(--muted)"><Badge repeat={g.example.repeat} perTurn={g.example.perTurn} /><ReasonText text={g.example.text} /></p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
